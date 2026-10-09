/**
 * Room & session management. Transport-agnostic: it talks to clients only
 * through the {@link RoomTransport} interface, which the Socket.IO layer
 * implements. The game engine itself knows nothing about rooms or sockets.
 */
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { ServerToClientEvents, JoinResult } from '@shared/events';
import type { PublicPlayer, RoomSettings, RoomView, Seat, SeatStatus } from '@shared/types';
import { DEFAULT_RULESET_ID, getRuleset, RULESETS } from '../config/rulesConfig';
import { secureRandomInt, type RandomIntFn } from '../game/deck';
import {
  applyAction,
  createGame,
  getAutoAction,
  resolveTrick,
  seatToAct,
  startMatch,
} from '../game/engine';
import { buildPlayerView } from '../game/playerView';
import type { EngineEvent, GameAction } from '../game/state';
import { RoomError, type PlayerSession, type Room } from './Room';
import { InMemoryRoomStore, type RoomStore } from './RoomStore';

export interface RoomTransport {
  send<E extends keyof ServerToClientEvents>(
    socketId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void;
  /** Detach a socket that has been superseded (e.g. same player opened another tab). */
  evict(socketId: string, reason: string): void;
}

export interface RoomManagerOptions {
  store?: RoomStore;
  rng?: RandomIntFn;
  /** How long a disconnected player keeps their seat before it is vacated. */
  reconnectGraceMs?: number;
  /** Rooms with nobody connected are deleted after this long. */
  roomIdleTtlMs?: number;
  /** Delay before a vacated seat is auto-played. */
  vacantSeatDelayMs?: number;
  /** Override for the trick display time (tests use a small value). */
  trickDisplayMs?: number;
  /** Auto-advance from the round-end screen after this long (when a turn timer is on). */
  roundEndAutoAdvanceMs?: number;
  now?: () => number;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const MAX_RECENT_ACTIONS = 64;
export const TURN_TIME_OPTIONS = [0, 20, 30, 45, 60, 90] as const;

export const DEFAULT_SETTINGS: RoomSettings = {
  rulesetId: DEFAULT_RULESET_ID,
  reverseTrumpEnabled: true,
  allowSpectators: false,
  turnTimeLimitSec: 45,
};

/** Control, zero-width and bidi-override characters stripped from nicknames. */
const UNSAFE_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]', 'g');

export function sanitizeNickname(raw: string): string {
  const cleaned = raw.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return cleaned || 'Player';
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export class RoomManager {
  readonly store: RoomStore;
  private readonly rng: RandomIntFn;
  private readonly opts: Required<Omit<RoomManagerOptions, 'store' | 'rng' | 'trickDisplayMs'>> & {
    trickDisplayMs?: number;
  };
  /** socketId → membership */
  private sockets = new Map<string, { code: string; playerId: string }>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly transport: RoomTransport,
    options: RoomManagerOptions = {},
  ) {
    this.store = options.store ?? new InMemoryRoomStore();
    this.rng = options.rng ?? secureRandomInt;
    this.opts = {
      reconnectGraceMs: options.reconnectGraceMs ?? 120_000,
      roomIdleTtlMs: options.roomIdleTtlMs ?? 10 * 60_000,
      vacantSeatDelayMs: options.vacantSeatDelayMs ?? 1_200,
      roundEndAutoAdvanceMs: options.roundEndAutoAdvanceMs ?? 25_000,
      trickDisplayMs: options.trickDisplayMs,
      now: options.now ?? Date.now,
    };
  }

  // ── lifecycle ────────────────────────────────────────────────────────

  startSweeper(intervalMs = 60_000): void {
    this.sweeper = setInterval(() => this.sweep(), intervalMs);
    this.sweeper.unref();
  }

  /** Delete rooms nobody has been connected to for longer than the idle TTL. */
  sweep(): number {
    const now = this.opts.now();
    let removed = 0;
    for (const room of [...this.store.values()]) {
      const anyoneConnected = [...room.players.values()].some((p) => p.connected);
      if (!anyoneConnected && now - room.lastActivity > this.opts.roomIdleTtlMs) {
        this.destroyRoom(room, 'Room closed due to inactivity.');
        removed++;
      }
    }
    return removed;
  }

  shutdown(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const room of [...this.store.values()]) this.clearTimers(room);
  }

  private destroyRoom(room: Room, reason: string): void {
    this.clearTimers(room);
    for (const p of room.players.values()) {
      if (p.socketId) {
        this.transport.send(p.socketId, 'room:closed', { reason });
        this.sockets.delete(p.socketId);
      }
    }
    this.store.delete(room.code);
  }

  private clearTimers(room: Room): void {
    if (room.timers.turn) clearTimeout(room.timers.turn);
    if (room.timers.trick) clearTimeout(room.timers.trick);
    for (const t of room.timers.grace.values()) clearTimeout(t);
    room.timers.turn = null;
    room.timers.trick = null;
    room.timers.grace.clear();
    room.turnDeadline = null;
  }

  // ── room membership ──────────────────────────────────────────────────

  private generateCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.store.has(code)) return code;
    }
    throw new RoomError('INTERNAL_ERROR', 'Could not allocate a room code.');
  }

  private normalizeSettings(input: Partial<RoomSettings>, base: RoomSettings): RoomSettings {
    const s = { ...base, ...input };
    if (!RULESETS[s.rulesetId]) s.rulesetId = DEFAULT_RULESET_ID;
    if (!getRuleset(s.rulesetId).reverseTrumpSupported) s.reverseTrumpEnabled = false;
    if (!(TURN_TIME_OPTIONS as readonly number[]).includes(s.turnTimeLimitSec)) s.turnTimeLimitSec = base.turnTimeLimitSec;
    return s;
  }

  createRoom(socketId: string, nickname: string, settings: Partial<RoomSettings> = {}): JoinResult {
    this.detachSocket(socketId);
    const code = this.generateCode();
    const normalized = this.normalizeSettings(settings, DEFAULT_SETTINGS);
    const room: Room = {
      code,
      createdAt: this.opts.now(),
      lastActivity: this.opts.now(),
      hostId: '',
      settings: normalized,
      rules: getRuleset(normalized.rulesetId),
      status: 'lobby',
      seats: [null, null, null, null],
      players: new Map(),
      game: null,
      timers: { turn: null, trick: null, grace: new Map() },
      turnDeadline: null,
      turnTimeLimitMs: null,
    };
    this.store.set(room);
    const { player, token } = this.addPlayer(room, socketId, nickname, 0);
    room.hostId = player.playerId;
    this.transport.send(socketId, 'room:created', this.roomView(room, player.playerId));
    this.broadcastRoom(room);
    return { room: this.roomView(room, player.playerId), playerId: player.playerId, sessionToken: token };
  }

  private addPlayer(room: Room, socketId: string, nickname: string, seat: Seat | null) {
    const token = randomBytes(24).toString('base64url');
    const player: PlayerSession = {
      playerId: randomUUID(),
      tokenHash: hashToken(token),
      nickname: sanitizeNickname(nickname),
      seat,
      socketId,
      connected: true,
      ready: false,
      disconnectedAt: null,
      vacated: false,
      recentActionIds: [],
    };
    room.players.set(player.playerId, player);
    if (seat !== null) room.seats[seat] = player.playerId;
    this.sockets.set(socketId, { code: room.code, playerId: player.playerId });
    return { player, token };
  }

  joinRoom(
    socketId: string,
    p: { roomCode: string; nickname: string; sessionToken?: string; asSpectator?: boolean },
  ): JoinResult {
    const room = this.store.get(p.roomCode.toUpperCase());
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'No room with that code exists.');

    // Reconnection with an existing session token → same seat, never a duplicate.
    if (p.sessionToken) {
      const hash = hashToken(p.sessionToken);
      const existing = [...room.players.values()].find((pl) => pl.tokenHash === hash);
      if (existing) return this.reconnect(room, existing, socketId, p.sessionToken);
    }

    this.detachSocket(socketId);
    room.lastActivity = this.opts.now();

    if (p.asSpectator) {
      if (!room.settings.allowSpectators) throw new RoomError('SPECTATORS_DISABLED', 'Spectators are not allowed in this room.');
      const { player, token } = this.addPlayer(room, socketId, p.nickname, null);
      this.broadcastRoom(room);
      this.sendGameState(room, player);
      return { room: this.roomView(room, player.playerId), playerId: player.playerId, sessionToken: token };
    }

    let seat: Seat | null = null;
    if (room.status === 'lobby') {
      const idx = room.seats.findIndex((s) => s === null);
      if (idx < 0) throw new RoomError('ROOM_FULL', 'This room already has four players.');
      seat = idx as Seat;
    } else {
      // Mid-match: a newcomer may only take over a vacated seat.
      const idx = room.seats.findIndex((pid) => pid !== null && room.players.get(pid)?.vacated);
      if (idx < 0) throw new RoomError('MATCH_IN_PROGRESS', 'A match is already in progress in this room.');
      seat = idx as Seat;
      const old = room.players.get(room.seats[idx]!)!;
      room.players.delete(old.playerId);
      this.clearGrace(room, old.playerId);
    }

    const { player, token } = this.addPlayer(room, socketId, p.nickname, seat);
    if (room.game) {
      room.game.names[seat] = player.nickname;
      player.ready = true;
      this.transport.send(socketId, 'game:started', { round: room.game.round });
    }
    this.broadcastRoom(room);
    if (room.game) {
      this.broadcastGame(room);
      this.scheduleTurn(room);
    }
    return { room: this.roomView(room, player.playerId), playerId: player.playerId, sessionToken: token };
  }

  private reconnect(room: Room, player: PlayerSession, socketId: string, token: string): JoinResult {
    if (player.socketId && player.socketId !== socketId) {
      this.sockets.delete(player.socketId);
      this.transport.evict(player.socketId, 'You joined this room from another tab or device.');
    }
    if (this.sockets.get(socketId)?.playerId !== player.playerId) this.detachSocket(socketId);
    const wasConnected = player.connected;
    player.socketId = socketId;
    player.connected = true;
    player.disconnectedAt = null;
    player.vacated = false;
    this.clearGrace(room, player.playerId);
    this.sockets.set(socketId, { code: room.code, playerId: player.playerId });
    room.lastActivity = this.opts.now();

    if (!wasConnected && player.seat !== null) {
      this.broadcastEvent(room, 'player:reconnected', { seat: player.seat, nickname: player.nickname });
    }
    this.broadcastRoom(room);
    if (room.game) {
      this.transport.send(socketId, 'game:started', { round: room.game.round });
      this.sendGameState(room, player);
      this.scheduleTurn(room);
    }
    return { room: this.roomView(room, player.playerId), playerId: player.playerId, sessionToken: token };
  }

  /** Remove a socket's association with whatever room it was in (no seat change). */
  private detachSocket(socketId: string): void {
    const m = this.sockets.get(socketId);
    if (!m) return;
    this.sockets.delete(socketId);
    const room = this.store.get(m.code);
    const player = room?.players.get(m.playerId);
    if (room && player && player.socketId === socketId) this.removePlayer(room, player);
  }

  leaveRoom(socketId: string): void {
    const { room, player } = this.context(socketId);
    this.sockets.delete(socketId);
    this.removePlayer(room, player);
  }

  /** Permanently remove a player (explicit leave or expired grace). */
  private removePlayer(room: Room, player: PlayerSession): void {
    this.clearGrace(room, player.playerId);
    room.lastActivity = this.opts.now();
    if (room.status === 'inGame' && player.seat !== null) {
      // Keep the seat for the match; the server plays it until someone takes over.
      player.vacated = true;
      player.connected = false;
      player.socketId = null;
      player.tokenHash = `left:${randomUUID()}`;
    } else {
      if (player.seat !== null) room.seats[player.seat] = null;
      room.players.delete(player.playerId);
    }
    this.ensureHost(room);
    if (![...room.players.values()].some((p) => p.connected)) {
      // Nobody left: keep briefly for reconnects; the sweeper deletes it later.
      this.clearTurnTimer(room);
    }
    this.broadcastRoom(room);
    if (room.game) {
      this.broadcastGame(room);
      this.scheduleTurn(room);
    }
  }

  private ensureHost(room: Room): void {
    const host = room.players.get(room.hostId);
    if (host && host.seat !== null && !host.vacated) return;
    const next = room.seats
      .map((pid) => (pid ? room.players.get(pid) : undefined))
      .find((p) => p && p.connected && !p.vacated);
    if (next) room.hostId = next.playerId;
  }

  handleDisconnect(socketId: string): void {
    const m = this.sockets.get(socketId);
    if (!m) return;
    this.sockets.delete(socketId);
    const room = this.store.get(m.code);
    const player = room?.players.get(m.playerId);
    if (!room || !player || player.socketId !== socketId) return;

    if (player.seat === null) {
      room.players.delete(player.playerId);
      this.broadcastRoom(room);
      return;
    }
    player.connected = false;
    player.socketId = null;
    player.disconnectedAt = this.opts.now();
    room.lastActivity = this.opts.now();
    this.broadcastEvent(room, 'player:disconnected', { seat: player.seat, nickname: player.nickname });
    const timer = setTimeout(() => {
      room.timers.grace.delete(player.playerId);
      if (!player.connected && room.players.get(player.playerId) === player) this.removePlayer(room, player);
    }, this.opts.reconnectGraceMs);
    timer.unref();
    room.timers.grace.set(player.playerId, timer);
    this.ensureHost(room);
    this.broadcastRoom(room);
  }

  private clearGrace(room: Room, playerId: string): void {
    const t = room.timers.grace.get(playerId);
    if (t) clearTimeout(t);
    room.timers.grace.delete(playerId);
  }

  // ── lobby actions ────────────────────────────────────────────────────

  setReady(socketId: string, ready: boolean): void {
    const { room, player } = this.context(socketId);
    if (room.status !== 'lobby') throw new RoomError('WRONG_PHASE', 'The match has already started.');
    if (player.seat === null) throw new RoomError('NOT_IN_ROOM', 'Spectators cannot ready up.');
    player.ready = ready;
    this.touch(room);
    this.broadcastRoom(room);
  }

  switchSeat(socketId: string, seat: Seat): void {
    const { room, player } = this.context(socketId);
    if (room.status !== 'lobby') throw new RoomError('WRONG_PHASE', 'Seats are locked during a match.');
    if (player.seat === null) throw new RoomError('NOT_IN_ROOM', 'Spectators cannot take a seat.');
    if (room.seats[seat] !== null) throw new RoomError('SEAT_TAKEN', 'That seat is already taken.');
    room.seats[player.seat] = null;
    room.seats[seat] = player.playerId;
    player.seat = seat;
    player.ready = false;
    this.touch(room);
    this.broadcastRoom(room);
  }

  updateSettings(socketId: string, settings: Partial<RoomSettings>): void {
    const { room, player } = this.context(socketId);
    this.requireHost(room, player);
    if (room.status !== 'lobby') throw new RoomError('SETTINGS_LOCKED', 'Rules cannot change once a match has started.');
    room.settings = this.normalizeSettings(settings, room.settings);
    room.rules = getRuleset(room.settings.rulesetId);
    for (const p of room.players.values()) p.ready = false;
    if (!room.settings.allowSpectators) {
      for (const p of [...room.players.values()]) {
        if (p.seat === null) {
          room.players.delete(p.playerId);
          if (p.socketId) {
            this.sockets.delete(p.socketId);
            this.transport.send(p.socketId, 'room:closed', { reason: 'The host disabled spectators.' });
          }
        }
      }
    }
    this.touch(room);
    this.broadcastRoom(room);
  }

  startGame(socketId: string): void {
    const { room, player } = this.context(socketId);
    this.requireHost(room, player);
    if (room.status !== 'lobby') throw new RoomError('WRONG_PHASE', 'The match has already started.');
    const seated = room.seats.map((pid) => (pid ? room.players.get(pid) : undefined));
    if (seated.some((p) => !p)) throw new RoomError('NOT_READY', 'Four players are needed to start.');
    if (seated.some((p) => !p!.connected || !p!.ready)) {
      throw new RoomError('NOT_READY', 'All four players must be connected and ready.');
    }
    const names = seated.map((p) => p!.nickname) as [string, string, string, string];
    room.game = createGame({ rules: room.rules, reverseTrumpAllowed: room.settings.reverseTrumpEnabled, names });
    room.status = 'inGame';
    const events = startMatch(room.game, this.rng);
    this.broadcastEvent(room, 'game:started', { round: room.game.round });
    this.broadcastRoom(room);
    this.afterChange(room, events);
  }

  backToLobby(socketId: string): void {
    const { room, player } = this.context(socketId);
    this.requireHost(room, player);
    if (room.status !== 'inGame' || !room.game) throw new RoomError('WRONG_PHASE', 'There is no match to leave.');
    if (room.game.phase !== 'roundEnd' && room.game.phase !== 'matchEnd') {
      throw new RoomError('WRONG_PHASE', 'You can return to the lobby between rounds.');
    }
    this.clearTurnTimer(room);
    room.status = 'lobby';
    room.game = null;
    for (const p of [...room.players.values()]) {
      if (p.vacated && p.seat !== null) {
        room.seats[p.seat] = null;
        room.players.delete(p.playerId);
      }
      p.ready = false;
    }
    this.ensureHost(room);
    this.touch(room);
    this.broadcastRoom(room);
  }

  // ── game actions ─────────────────────────────────────────────────────

  gameAction(
    socketId: string,
    meta: { roomCode: string; actionId: string; seq: number },
    action: GameAction,
  ): { seq: number } {
    const { room, player } = this.context(socketId, meta.roomCode);
    const game = room.game;
    if (!game || room.status !== 'inGame') throw new RoomError('WRONG_PHASE', 'No match is in progress.');
    if (player.seat === null) throw new RoomError('NOT_IN_ROOM', 'Spectators cannot act.');
    if (player.recentActionIds.includes(meta.actionId)) {
      throw new RoomError('DUPLICATE_ACTION', 'This action was already processed.');
    }
    if (meta.seq !== game.seq) {
      this.sendGameState(room, player);
      throw new RoomError('STALE_ACTION', 'Your view was out of date and has been refreshed. Try again.');
    }
    player.recentActionIds.push(meta.actionId);
    if (player.recentActionIds.length > MAX_RECENT_ACTIONS) player.recentActionIds.shift();

    const result = applyAction(game, player.seat, action, this.rng);
    if (!result.ok) throw new RoomError(result.error.code, result.error.message);
    this.touch(room);
    this.afterChange(room, result.events);
    return { seq: game.seq };
  }

  /** Emit events, schedule follow-ups and broadcast fresh views. */
  private afterChange(room: Room, events: EngineEvent[]): void {
    const game = room.game!;
    for (const ev of events) {
      if (ev.type === 'trickResolved') this.broadcastEvent(room, 'game:trickResolved', { trick: ev.trick });
      else if (ev.type === 'roundFinished') this.broadcastEvent(room, 'game:roundFinished', { result: ev.result });
      else if (ev.type === 'matchFinished') {
        this.broadcastEvent(room, 'game:matchFinished', { winner: ev.winner, matchScore: ev.matchScore });
      } else if (ev.type === 'roundStarted') this.broadcastEvent(room, 'game:started', { round: ev.round });
    }
    if (game.phase === 'trickResolution' && !room.timers.trick) {
      const delay = this.opts.trickDisplayMs ?? room.rules.trickDisplayMs;
      room.timers.trick = setTimeout(() => {
        room.timers.trick = null;
        if (room.game !== game || game.phase !== 'trickResolution') return;
        const evs = resolveTrick(game);
        this.afterChange(room, evs);
      }, delay);
    }
    this.scheduleTurn(room);
    this.broadcastGame(room);
  }

  private clearTurnTimer(room: Room): void {
    if (room.timers.turn) clearTimeout(room.timers.turn);
    room.timers.turn = null;
    room.turnDeadline = null;
    room.turnTimeLimitMs = null;
  }

  /**
   * (Re)arm the turn timer for whoever must act. Vacated seats are played
   * quickly; connected or briefly disconnected players get the room's turn
   * time limit (if enabled).
   */
  private scheduleTurn(room: Room): void {
    this.clearTurnTimer(room);
    const game = room.game;
    if (!game || room.status !== 'inGame') return;
    const anyoneConnected = [...room.players.values()].some((p) => p.connected && p.seat !== null);
    if (!anyoneConnected) return;

    const seq = game.seq;
    const limitMs = room.settings.turnTimeLimitSec * 1000;

    if (game.phase === 'roundEnd') {
      if (limitMs <= 0) return;
      const delay = Math.max(limitMs, this.opts.roundEndAutoAdvanceMs);
      room.turnDeadline = this.opts.now() + delay;
      room.turnTimeLimitMs = delay;
      room.timers.turn = setTimeout(() => this.autoAct(room, seq, null, { type: 'nextRound' }), delay);
      return;
    }

    const seat = seatToAct(game);
    if (seat === null) return;
    const pid = room.seats[seat];
    const player = pid ? room.players.get(pid) : undefined;
    const vacant = !player || player.vacated;
    const delay = vacant ? this.opts.vacantSeatDelayMs : limitMs;
    if (delay <= 0) return;
    room.turnDeadline = vacant ? null : this.opts.now() + delay;
    room.turnTimeLimitMs = vacant ? null : delay;
    room.timers.turn = setTimeout(() => this.autoAct(room, seq, seat, null), delay);
  }

  private autoAct(room: Room, seq: number, seat: Seat | null, fixed: GameAction | null): void {
    room.timers.turn = null;
    room.turnDeadline = null;
    const game = room.game;
    if (!game || game.seq !== seq || this.store.get(room.code) !== room) return;
    const actor = seat ?? 0;
    const action = fixed ?? getAutoAction(game, actor);
    if (!action) return;
    const res = applyAction(game, actor, action, this.rng);
    if (res.ok) this.afterChange(room, res.events);
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private touch(room: Room): void {
    room.lastActivity = this.opts.now();
  }

  private context(socketId: string, roomCode?: string): { room: Room; player: PlayerSession } {
    const m = this.sockets.get(socketId);
    if (!m) throw new RoomError('NOT_IN_ROOM', 'You are not in a room.');
    if (roomCode && roomCode.toUpperCase() !== m.code) throw new RoomError('NOT_IN_ROOM', 'You are not in that room.');
    const room = this.store.get(m.code);
    const player = room?.players.get(m.playerId);
    if (!room || !player) throw new RoomError('NOT_IN_ROOM', 'You are not in a room.');
    return { room, player };
  }

  private requireHost(room: Room, player: PlayerSession): void {
    if (room.hostId !== player.playerId) throw new RoomError('NOT_HOST', 'Only the host can do that.');
  }

  /** Re-send the room and game state to a socket (resync). */
  resync(socketId: string, roomCode: string): void {
    const { room, player } = this.context(socketId, roomCode);
    if (player.socketId) this.transport.send(player.socketId, 'room:updated', this.roomView(room, player.playerId));
    this.sendGameState(room, player);
  }

  roomView(room: Room, viewerId: string | null): RoomView {
    const viewer = viewerId ? room.players.get(viewerId) : undefined;
    const seats: (PublicPlayer | null)[] = room.seats.map((pid, i) => {
      const p = pid ? room.players.get(pid) : undefined;
      if (!p) return null;
      let status: SeatStatus;
      if (p.vacated) status = 'vacant';
      else if (!p.connected) status = 'disconnected';
      else if (room.status === 'lobby' && p.ready) status = 'ready';
      else status = 'connected';
      return {
        seat: i as Seat,
        nickname: p.nickname,
        team: (i % 2) as 0 | 1,
        connected: p.connected,
        ready: p.ready,
        isHost: room.hostId === p.playerId,
        vacated: p.vacated,
        status,
      };
    });
    const r = room.rules;
    return {
      code: room.code,
      status: room.status,
      seats,
      settings: { ...room.settings },
      ruleset: {
        id: r.id,
        name: r.name,
        description: r.description,
        minBid: r.minBid,
        maxBid: r.maxBid,
        targetScore: r.targetScore,
        trumpConcealed: r.trumpConcealed,
        pairEnabled: r.pairEnabled,
        reverseTrumpSupported: r.reverseTrumpSupported,
        reverseTrumpScope: r.reverseTrumpScope,
      },
      mySeat: viewer?.seat ?? null,
      isHost: !!viewer && room.hostId === viewer.playerId,
      isSpectator: !!viewer && viewer.seat === null,
      spectatorCount: [...room.players.values()].filter((p) => p.seat === null).length,
    };
  }

  private broadcastRoom(room: Room): void {
    for (const p of room.players.values()) {
      if (p.socketId) this.transport.send(p.socketId, 'room:updated', this.roomView(room, p.playerId));
    }
  }

  private sendGameState(room: Room, player: PlayerSession): void {
    if (!room.game || !player.socketId) return;
    this.transport.send(
      player.socketId,
      'game:state',
      buildPlayerView(room.game, player.seat, {
        turnDeadline: room.turnDeadline,
        turnTimeLimitMs: room.turnTimeLimitMs,
        now: this.opts.now(),
      }),
    );
  }

  private broadcastGame(room: Room): void {
    for (const p of room.players.values()) this.sendGameState(room, p);
  }

  private broadcastEvent<E extends keyof ServerToClientEvents>(
    room: Room,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    for (const p of room.players.values()) {
      if (p.socketId) this.transport.send(p.socketId, event, ...args);
    }
  }

  /** Test/diagnostic helper: membership for a socket. */
  membership(socketId: string) {
    return this.sockets.get(socketId);
  }
}
