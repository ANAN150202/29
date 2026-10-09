import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, JoinResult, ServerToClientEvents } from '@shared/events';
import type { GameView, RoomView } from '@shared/types';
import { createApp, type App, type AppOptions } from '../server/src/app';
import { seededRandomInt } from '../server/src/game/deck';

type CSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let counter = 0;
const newId = () => `act_${Date.now()}_${++counter}`;

class TestClient {
  socket!: CSocket;
  room: RoomView | null = null;
  state: GameView | null = null;
  events: { name: string; payload: unknown }[] = [];
  token = '';
  closedReason: string | null = null;
  evicted = false;
  private listeners: (() => void)[] = [];

  constructor(
    private url: string,
    public name: string,
  ) {}

  async connect(): Promise<void> {
    this.socket = ioClient(this.url, { transports: ['websocket'], forceNew: true, reconnection: false });
    this.socket.on('room:updated', (r) => {
      this.room = r;
      this.notify();
    });
    this.socket.on('game:state', (s) => {
      this.state = s;
      this.notify();
    });
    this.socket.on('room:closed', (p) => {
      this.closedReason = p.reason;
      this.evicted = !!p.evicted;
      this.notify();
    });
    for (const name of [
      'game:started',
      'game:trickResolved',
      'game:roundFinished',
      'game:matchFinished',
      'player:disconnected',
      'player:reconnected',
      'game:actionAccepted',
      'game:actionRejected',
    ] as const) {
      this.socket.on(name, ((payload: unknown) => {
        this.events.push({ name, payload });
        this.notify();
      }) as never);
    }
    await new Promise<void>((res, rej) => {
      this.socket.once('connect', () => res());
      this.socket.once('connect_error', rej);
    });
  }

  private notify() {
    for (const l of this.listeners.slice()) l();
  }

  emit<T = unknown>(event: keyof ClientToServerEvents, payload: unknown): Promise<Ack<T>> {
    return new Promise((resolve) => {
      (this.socket.emit as (e: string, p: unknown, cb: (r: Ack<T>) => void) => void)(event, payload, resolve);
    });
  }

  waitFor(pred: () => boolean, label = 'condition', timeout = 5000): Promise<void> {
    if (pred()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== check);
        reject(new Error(`${this.name}: timed out waiting for ${label}`));
      }, timeout);
      const check = () => {
        if (pred()) {
          clearTimeout(timer);
          this.listeners = this.listeners.filter((l) => l !== check);
          resolve();
        }
      };
      this.listeners.push(check);
    });
  }

  gameAction<T = unknown>(event: keyof ClientToServerEvents, extra: Record<string, unknown> = {}, actionId = newId()) {
    return this.emit<T>(event, { roomCode: this.room!.code, actionId, seq: this.state!.seq, ...extra });
  }
}

let app: App;
let url: string;
const clients: TestClient[] = [];

async function startServer(opts: AppOptions = {}) {
  app = createApp({ trickDisplayMs: 5, vacantSeatDelayMs: 5, roomCreateLimit: { limit: 100, windowMs: 60_000 },
    // Test bots act far faster than humans; the default per-socket limit is 40 events/s.
    eventLimit: { limit: 10_000, windowMs: 1_000 },
    ...opts,
   });
  await new Promise<void>((r) => app.httpServer.listen(0, r));
  url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
}

async function client(name: string) {
  const c = new TestClient(url, name);
  await c.connect();
  clients.push(c);
  return c;
}

/** Create a room with 4 seated, ready players. Timer disabled for determinism. */
async function fullRoom(settings: Record<string, unknown> = {}) {
  const host = await client('Host');
  const created = await host.emit<JoinResult>('room:create', {
    nickname: 'Host',
    settings: { turnTimeLimitSec: 0, ...settings },
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error();
  host.token = created.data.sessionToken;
  const code = created.data.room.code;
  const players = [host];
  for (const n of ['Bea', 'Cid', 'Dee']) {
    const c = await client(n);
    const res = await c.emit<JoinResult>('room:join', { roomCode: code, nickname: n });
    expect(res.ok).toBe(true);
    if (res.ok) c.token = res.data.sessionToken;
    players.push(c);
  }
  for (const p of players) {
    await p.waitFor(() => !!p.room && p.room.seats.filter(Boolean).length === 4, 'four seats');
  }
  return { code, players };
}

async function startedRoom(settings: Record<string, unknown> = {}) {
  const r = await fullRoom(settings);
  for (const p of r.players) expect((await p.emit('room:ready', { roomCode: r.code, ready: true })).ok).toBe(true);
  const start = await r.players[0].emit('game:start', { roomCode: r.code });
  expect(start).toEqual({ ok: true, data: undefined });
  for (const p of r.players) await p.waitFor(() => p.state?.phase === 'bidding', 'bidding');
  /** client by seat */
  const bySeat = (seat: number) => r.players.find((p) => p.room!.mySeat === seat)!;
  return { ...r, bySeat };
}

/** Take one legal step for whoever must act. Returns false if nothing to do. */
async function step(bySeat: (s: number) => TestClient, players: TestClient[]): Promise<boolean> {
  const any = players[0];
  const st = any.state!;
  if (st.phase === 'bidding') {
    const c = bySeat(st.turn!);
    await c.waitFor(() => c.state!.seq === st.seq, 'seq sync');
    const res = st.bidding.highestBid === null
      ? await c.gameAction('game:bid', { amount: 16 })
      : await c.gameAction('game:pass');
    expect(res.ok).toBe(true);
  } else if (st.phase === 'trumpSelection') {
    const c = bySeat(st.turn!);
    await c.waitFor(() => c.state!.seq === st.seq, 'seq sync');
    const res = await c.gameAction('game:chooseTrump', { suit: 'hearts', reverse: true });
    expect(res.ok).toBe(true);
  } else if (st.phase === 'playing') {
    const c = bySeat(st.turn!);
    await c.waitFor(() => c.state!.seq === st.seq, 'seq sync');
    const legal = c.state!.legalCardIds;
    expect(legal.length).toBeGreaterThan(0);
    const res = await c.gameAction('game:playCard', { cardId: legal[0] });
    expect(res).toMatchObject({ ok: true });
  } else if (st.phase === 'roundEnd') {
    const res = await any.gameAction('game:nextRound');
    expect(res.ok).toBe(true);
  } else if (st.phase === 'trickResolution') {
    // server resolves automatically
  } else return false;
  const seq = st.seq;
  await any.waitFor(() => any.state!.seq > seq, `progress after ${st.phase}`);
  return true;
}

beforeEach(async () => {
  await startServer();
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.socket.disconnect();
  await app.close();
});

describe('rooms & lobby', () => {
  it('creates a room with a unique code; four players join; a fifth is rejected', async () => {
    const { code, players } = await fullRoom();
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    expect(players.map((p) => p.room!.mySeat).sort()).toEqual([0, 1, 2, 3]);
    expect(players[0].room!.isHost).toBe(true);
    expect(players[1].room!.isHost).toBe(false);
    const fifth = await client('Eve');
    expect(await fifth.emit('room:join', { roomCode: code, nickname: 'Eve' })).toMatchObject({
      ok: false,
      error: { code: 'ROOM_FULL' },
    });
    expect(await fifth.emit('room:join', { roomCode: 'ZZZZZ', nickname: 'Eve' })).toMatchObject({
      ok: false,
      error: { code: 'ROOM_NOT_FOUND' },
    });
    expect(await fifth.emit('room:join', { roomCode: code, nickname: 'Eve', asSpectator: true })).toMatchObject({
      ok: false,
      error: { code: 'SPECTATORS_DISABLED' },
    });
  });

  it('rejects invalid payloads', async () => {
    const c = await client('X');
    expect(await c.emit('room:create', { nickname: '' })).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    expect(await c.emit('room:join', { roomCode: '<script>', nickname: 'a' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
    expect(await c.emit('room:create', { nickname: 'ok', settings: { evil: true } })).toMatchObject({ ok: false });
  });

  it('only the host can start, and only when all four are ready; no duplicate seats', async () => {
    const { code, players } = await fullRoom();
    expect(await players[1].emit('game:start', { roomCode: code })).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    expect(await players[0].emit('game:start', { roomCode: code })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    expect(await players[1].emit('room:switchSeat', { roomCode: code, seat: 0 })).toMatchObject({
      ok: false,
      error: { code: 'SEAT_TAKEN' },
    });
    expect(await players[1].emit('room:updateSettings', { roomCode: code, settings: { reverseTrumpEnabled: false } })).toMatchObject({
      ok: false,
      error: { code: 'NOT_HOST' },
    });
    for (const p of players.slice(0, 3)) await p.emit('room:ready', { roomCode: code, ready: true });
    expect(await players[0].emit('game:start', { roomCode: code })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
  });

  it('host can change settings in the lobby (resets ready) but not after the match starts', async () => {
    const { code, players } = await fullRoom();
    await players[1].emit('room:ready', { roomCode: code, ready: true });
    const res = await players[0].emit('room:updateSettings', {
      roomCode: code,
      settings: { rulesetId: 'open', reverseTrumpEnabled: false },
    });
    expect(res.ok).toBe(true);
    await players[1].waitFor(() => players[1].room!.ruleset.id === 'open', 'ruleset update');
    expect(players[1].room!.settings.reverseTrumpEnabled).toBe(false);
    expect(players[1].room!.seats[1]!.ready).toBe(false);
  });
});

describe('match flow', () => {
  it('every player sees only their own hand; concealed trump is hidden from non-bidders', async () => {
    const { players, bySeat } = await startedRoom();
    for (const p of players) {
      expect(p.state!.myHand).toHaveLength(4);
      expect(p.state!.handCounts).toEqual([4, 4, 4, 4]);
      const json = JSON.stringify(p.state);
      for (const other of players) {
        if (other === p) continue;
        for (const card of other.state!.myHand) expect(json).not.toContain(`"${card.id}"`);
      }
      expect(json).not.toContain('"deck"');
    }
    // Drive bidding and trump selection.
    while (players[0].state!.phase !== 'playing') await step(bySeat, players);
    const bidder = players[0].state!.contract!.bidder;
    for (const p of players) await p.waitFor(() => p.state!.phase === 'playing', 'playing');
    for (const p of players) {
      if (p.room!.mySeat === bidder) {
        expect(p.state!.trump).toMatchObject({ suit: 'hearts', reverse: true });
      } else {
        expect(p.state!.trump).toMatchObject({ suit: null, reverse: null, hiddenFromMe: true });
        expect(JSON.stringify(p.state)).not.toMatch(/"trumpSuit"/);
      }
      expect(p.state!.myHand).toHaveLength(8);
    }
  });

  it('rejects out-of-turn plays, unowned cards, duplicate and stale actions', async () => {
    const { players, bySeat } = await startedRoom();
    while (players[0].state!.phase !== 'playing') await step(bySeat, players);
    const st = players[0].state!;
    const turnClient = bySeat(st.turn!);
    const other = bySeat((st.turn! + 1) % 4);
    await other.waitFor(() => other.state!.seq === st.seq, 'sync');
    await turnClient.waitFor(() => turnClient.state!.seq === st.seq, 'sync');

    const outOfTurn = await other.gameAction('game:playCard', { cardId: other.state!.myHand[0].id });
    expect(outOfTurn).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    expect(other.events.some((e) => e.name === 'game:actionRejected')).toBe(true);

    const notMine = await turnClient.gameAction('game:playCard', { cardId: other.state!.myHand[0].id });
    expect(notMine).toMatchObject({ ok: false, error: { code: 'CARD_NOT_OWNED' } });

    const stale = await turnClient.emit('game:playCard', {
      roomCode: turnClient.room!.code,
      actionId: newId(),
      seq: st.seq - 1,
      cardId: turnClient.state!.legalCardIds[0],
    });
    expect(stale).toMatchObject({ ok: false, error: { code: 'STALE_ACTION' } });

    const id = newId();
    const card = turnClient.state!.legalCardIds[0];
    expect((await turnClient.gameAction('game:playCard', { cardId: card }, id)).ok).toBe(true);
    const dup = await turnClient.gameAction('game:playCard', { cardId: card }, id);
    expect(dup).toMatchObject({ ok: false, error: { code: 'DUPLICATE_ACTION' } });

    const locked = await players[0].emit('room:updateSettings', { roomCode: players[0].room!.code, settings: { rulesetId: 'open' } });
    expect(locked).toMatchObject({ ok: false, error: { code: 'SETTINGS_LOCKED' } });
  });

  it('plays a complete match to the end with all clients synchronized, then rematches', async () => {
    await app.close();
    await startServer({ rng: seededRandomInt(2024) }); // deterministic deals
    const { players, bySeat } = await startedRoom();
    let guard = 0;
    while (players[0].state!.phase !== 'matchEnd' && guard++ < 20_000) {
      if (players[0].state!.phase === 'trickResolution') {
        const seq = players[0].state!.seq;
        await players[0].waitFor(() => players[0].state!.seq > seq, 'trick resolution');
        continue;
      }
      await step(bySeat, players);
    }
    expect(players[0].state!.phase).toBe('matchEnd');
    for (const p of players) {
      await p.waitFor(() => p.state!.phase === 'matchEnd', 'matchEnd everywhere');
      expect(p.state!.matchScore).toEqual(players[0].state!.matchScore);
      expect(p.state!.matchWinner).toBe(players[0].state!.matchWinner);
      expect(p.events.some((e) => e.name === 'game:matchFinished')).toBe(true);
      expect(p.events.filter((e) => e.name === 'game:roundFinished').length).toBeGreaterThanOrEqual(6);
    }
    const result = players[0].state!.roundResult!;
    expect(result.cardPoints[0] + result.cardPoints[1]).toBe(28);
    expect(result.reverseTrump).toBe(true);

    expect((await players[2].gameAction('game:rematch')).ok).toBe(true);
    for (const p of players) await p.waitFor(() => p.state!.phase === 'bidding' && p.state!.matchScore[0] === 0, 'rematch');
  }, 60_000);
});

describe('reliability', () => {
  it('a player can reconnect with their session token to the same seat and hand', async () => {
    const { code, players } = await startedRoom();
    const leaver = players[2];
    const seat = leaver.room!.mySeat;
    const hand = leaver.state!.myHand.map((c) => c.id).sort();
    leaver.socket.disconnect();
    await players[0].waitFor(() => players[0].events.some((e) => e.name === 'player:disconnected'), 'disconnect event');
    await players[0].waitFor(() => players[0].room!.seats[seat!]!.status === 'disconnected', 'disconnected status');

    const back = await client('Cid-again');
    const res = await back.emit<JoinResult>('room:join', { roomCode: code, nickname: 'Whoever', sessionToken: leaver.token });
    expect(res.ok).toBe(true);
    await back.waitFor(() => !!back.state, 'state resync');
    expect(back.room!.mySeat).toBe(seat);
    expect(back.state!.myHand.map((c) => c.id).sort()).toEqual(hand);
    expect(back.room!.seats.filter(Boolean)).toHaveLength(4);
    await players[0].waitFor(() => players[0].events.some((e) => e.name === 'player:reconnected'), 'reconnect event');
  });

  it('refreshing with the same token never creates a second player; the old tab is evicted', async () => {
    const { code, players } = await fullRoom();
    const original = players[1];
    const tab2 = await client('tab2');
    const res = await tab2.emit<JoinResult>('room:join', { roomCode: code, nickname: 'Bea', sessionToken: original.token });
    expect(res.ok).toBe(true);
    await original.waitFor(() => original.closedReason !== null, 'eviction');
    expect(original.evicted).toBe(true);
    expect(tab2.room!.seats.filter(Boolean)).toHaveLength(4);
    expect(tab2.room!.mySeat).toBe(original.room!.mySeat);
    // Old socket can no longer act for the seat.
    expect(await original.emit('room:ready', { roomCode: code, ready: true })).toMatchObject({ ok: false, error: { code: 'NOT_IN_ROOM' } });
  });

  it('after the grace period a seat is vacated, auto-played, and can be taken over', async () => {
    await app.close();
    await startServer({ reconnectGraceMs: 50 });
    const { code, players, bySeat } = await startedRoom();
    const st = players[0].state!;
    // Disconnect the player whose turn it is.
    const victim = bySeat(st.turn!);
    const victimSeat = victim.room!.mySeat!;
    victim.socket.disconnect();
    const watcher = players.find((p) => p !== victim)!;
    await watcher.waitFor(() => watcher.room!.seats[victimSeat]!.status === 'vacant', 'vacant seat');
    // Server auto-acts for the vacant seat (pass/bid) so the game moves on.
    await watcher.waitFor(() => watcher.state!.bidding.history.some((b) => b.seat === victimSeat), 'auto bid action');

    const newcomer = await client('Newbie');
    const res = await newcomer.emit<JoinResult>('room:join', { roomCode: code, nickname: 'Newbie' });
    expect(res.ok).toBe(true);
    await newcomer.waitFor(() => !!newcomer.state, 'state');
    expect(newcomer.room!.mySeat).toBe(victimSeat);
    expect(newcomer.state!.myHand.length).toBeGreaterThan(0);
    await watcher.waitFor(() => watcher.room!.seats[victimSeat]!.nickname === 'Newbie', 'takeover visible');

    // Old token no longer works for that seat.
    const ghost = await client('ghost');
    const again = await ghost.emit<JoinResult>('room:join', { roomCode: code, nickname: 'x', sessionToken: victim.token });
    expect(again).toMatchObject({ ok: false, error: { code: 'MATCH_IN_PROGRESS' } });
  });

  it('turn timer auto-acts for an idle player', async () => {
    const { players } = await startedRoom({ turnTimeLimitSec: 20 });
    const st = players[0].state!;
    expect(st.turnTimeLimitMs).toBe(20_000);
    expect(st.turnTimeLeftMs).toBeGreaterThan(15_000);
    expect(st.turnTimeLeftMs).toBeLessThanOrEqual(20_000);
  });

  it('rate-limits room creation per client', async () => {
    await app.close();
    await startServer({ roomCreateLimit: { limit: 2, windowMs: 60_000 } });
    const c = await client('spam');
    expect((await c.emit('room:create', { nickname: 'a' })).ok).toBe(true);
    expect((await c.emit('room:create', { nickname: 'a' })).ok).toBe(true);
    expect(await c.emit('room:create', { nickname: 'a' })).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });

  it('rate-limits event floods and repeated invalid actions per socket', async () => {
    await app.close();
    await startServer({ eventLimit: { limit: 5, windowMs: 60_000 }, invalidActionLimit: { limit: 3, windowMs: 60_000 } });
    const flood = await client('flood');
    const results = await Promise.all(Array.from({ length: 8 }, () => flood.emit('room:join', { roomCode: 'NOPE1', nickname: 'x' })));
    const codes = results.map((r) => (r.ok ? 'ok' : r.error.code));
    expect(codes.slice(0, 3)).toEqual(['ROOM_NOT_FOUND', 'ROOM_NOT_FOUND', 'ROOM_NOT_FOUND']);
    expect(codes.slice(4)).toEqual(['RATE_LIMITED', 'RATE_LIMITED', 'RATE_LIMITED', 'RATE_LIMITED']);
  });

  it('cleans up abandoned rooms', async () => {
    const { players } = await fullRoom();
    for (const p of players) p.socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    expect(app.manager.store.size()).toBe(1);
    const real = Date.now;
    try {
      // Pretend 11 minutes have passed.
      (app.manager as unknown as { opts: { now: () => number } }).opts.now = () => real() + 11 * 60_000;
      expect(app.manager.sweep()).toBe(1);
      expect(app.manager.store.size()).toBe(0);
    } finally {
      (app.manager as unknown as { opts: { now: () => number } }).opts.now = real;
    }
  });
});
