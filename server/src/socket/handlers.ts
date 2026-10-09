/**
 * Socket.IO transport layer: validates payloads (Zod), applies rate limits,
 * forwards to the RoomManager and replies with a uniform Ack.
 * Internal errors are logged server-side and never exposed to clients.
 */
import type { Server, Socket } from 'socket.io';
import type { ZodTypeAny, z } from 'zod';
import type {
  Ack,
  ActionError,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@shared/events';
import { RoomError } from '../rooms/Room';
import { RoomManager, type RoomManagerOptions } from '../rooms/RoomManager';
import type { GameAction } from '../game/state';
import { RateLimiter } from './rateLimit';
import { schemas } from './schemas';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type ClientSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface HandlerOptions extends RoomManagerOptions {
  roomCreateLimit?: { limit: number; windowMs: number };
  invalidActionLimit?: { limit: number; windowMs: number };
  eventLimit?: { limit: number; windowMs: number };
  /** Trust X-Forwarded-For for client IPs (only behind a known reverse proxy). */
  trustProxy?: boolean;
}

function toError(err: unknown): ActionError {
  if (err instanceof RoomError) return { code: err.code, message: err.message };
  console.error('[socket] internal error:', err instanceof Error ? err.message : err);
  return { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' };
}

export function registerSocketHandlers(io: IO, options: HandlerOptions = {}): RoomManager {
  const manager = new RoomManager(
    {
      send: (socketId, event, ...args) => {
        io.to(socketId).emit(event, ...args);
      },
      evict: (socketId, reason) => {
        io.to(socketId).emit('room:closed', { reason, evicted: true });
      },
    },
    options,
  );

  const createLimiter = new RateLimiter(options.roomCreateLimit?.limit ?? 5, options.roomCreateLimit?.windowMs ?? 60_000);
  const invalidLimiter = new RateLimiter(
    options.invalidActionLimit?.limit ?? 25,
    options.invalidActionLimit?.windowMs ?? 10_000,
  );
  const eventLimiter = new RateLimiter(options.eventLimit?.limit ?? 40, options.eventLimit?.windowMs ?? 1_000);

  io.on('connection', (socket: ClientSocket) => {
    const forwarded = options.trustProxy
      ? (socket.handshake.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      : undefined;
    const ip = forwarded || socket.handshake.address;

    /**
     * Wrap a handler: validate payload, enforce limits, convert errors.
     * `isGameAction` also mirrors the result to game:actionAccepted/Rejected.
     */
    function on<E extends keyof typeof schemas>(
      event: E,
      handler: (payload: z.infer<(typeof schemas)[E]>) => unknown,
      isGameAction = false,
    ) {
      const schema: ZodTypeAny = schemas[event];
      socket.on(event as keyof ClientToServerEvents, ((raw: unknown, ack?: unknown) => {
        const reply = (res: Ack<unknown>) => {
          if (typeof ack === 'function') (ack as (r: Ack<unknown>) => void)(res);
        };
        const actionId =
          raw && typeof raw === 'object' && typeof (raw as { actionId?: unknown }).actionId === 'string'
            ? (raw as { actionId: string }).actionId
            : null;
        const reject = (error: ActionError) => {
          if (error.code !== 'RATE_LIMITED') invalidLimiter.hit(socket.id);
          if (isGameAction) socket.emit('game:actionRejected', { actionId, error });
          reply({ ok: false, error });
        };

        if (!eventLimiter.hit(socket.id) || invalidLimiter.blocked(socket.id)) {
          return reject({ code: 'RATE_LIMITED', message: 'Too many requests — slow down.' });
        }
        const parsed = schema.safeParse(raw);
        if (!parsed.success) return reject({ code: 'INVALID_PAYLOAD', message: 'Invalid request.' });
        try {
          const data = handler(parsed.data);
          if (isGameAction && actionId) {
            socket.emit('game:actionAccepted', { actionId, seq: (data as { seq: number }).seq });
          }
          reply({ ok: true, data: data as never });
        } catch (err) {
          reject(toError(err));
        }
      }) as never);
    }

    on('room:create', (p) => {
      if (!createLimiter.hit(`create:${ip}`)) {
        throw new RoomError('RATE_LIMITED', 'Too many rooms created — try again in a minute.');
      }
      return manager.createRoom(socket.id, p.nickname, p.settings);
    });
    on('room:playVsComputer', (p) => {
      if (!createLimiter.hit(`create:${ip}`)) {
        throw new RoomError('RATE_LIMITED', 'Too many rooms created — try again in a minute.');
      }
      return manager.playVsComputer(socket.id, p.nickname, p.settings);
    });
    on('room:join', (p) => manager.joinRoom(socket.id, p));
    on('room:addBot', (p) => manager.addBot(socket.id, p.seat));
    on('room:removeBot', (p) => manager.removeBot(socket.id, p.seat));
    on('room:leave', () => manager.leaveRoom(socket.id));
    on('room:ready', (p) => manager.setReady(socket.id, p.ready));
    on('room:switchSeat', (p) => manager.switchSeat(socket.id, p.seat));
    on('room:updateSettings', (p) => manager.updateSettings(socket.id, p.settings));
    on('room:backToLobby', () => manager.backToLobby(socket.id));
    on('game:start', () => manager.startGame(socket.id));
    on('game:sync', (p) => manager.resync(socket.id, p.roomCode));

    const act = (p: { roomCode: string; actionId: string; seq: number }, action: GameAction) =>
      manager.gameAction(socket.id, p, action);
    on('game:bid', (p) => act(p, { type: 'bid', amount: p.amount }), true);
    on('game:pass', (p) => act(p, { type: 'pass' }), true);
    on('game:chooseTrump', (p) => act(p, { type: 'chooseTrump', suit: p.suit, reverse: p.reverse }), true);
    on('game:revealTrump', (p) => act(p, { type: 'revealTrump' }), true);
    on('game:declarePair', (p) => act(p, { type: 'declarePair' }), true);
    on('game:playCard', (p) => act(p, { type: 'playCard', cardId: p.cardId }), true);
    on('game:double', (p) => act(p, { type: 'double', stage: p.stage }), true);
    on('game:declineDouble', (p) => act(p, { type: 'declineDouble' }), true);
    on('game:declareSingle', (p) => act(p, { type: 'declareSingle' }), true);
    on('game:skipSingle', (p) => act(p, { type: 'skipSingle' }), true);
    on('game:nextRound', (p) => act(p, { type: 'nextRound' }), true);
    on('game:rematch', (p) => act(p, { type: 'rematch' }), true);

    socket.on('disconnect', () => manager.handleDisconnect(socket.id));
  });

  return manager;
}
