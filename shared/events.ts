/**
 * Typed Socket.IO contract between client and server.
 * Every client → server event takes an acknowledgement callback that
 * receives an {@link Ack}. The server additionally emits
 * `game:actionAccepted` / `game:actionRejected` for game actions.
 */
import type {
  GameView,
  RoomSettings,
  RoomView,
  RoundResult,
  Seat,
  Suit,
  TeamId,
  TrickRecord,
} from './types';

export type ErrorCode =
  | 'INVALID_PAYLOAD'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'MATCH_IN_PROGRESS'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_READY'
  | 'SEAT_TAKEN'
  | 'WRONG_PHASE'
  | 'NOT_YOUR_TURN'
  | 'ILLEGAL_BID'
  | 'ILLEGAL_CARD'
  | 'CARD_NOT_OWNED'
  | 'CANNOT_PASS'
  | 'CANNOT_REVEAL'
  | 'CANNOT_DECLARE_PAIR'
  | 'REVERSE_TRUMP_DISABLED'
  | 'DUPLICATE_ACTION'
  | 'STALE_ACTION'
  | 'RATE_LIMITED'
  | 'SPECTATORS_DISABLED'
  | 'SETTINGS_LOCKED'
  | 'INTERNAL_ERROR';

export interface ActionError {
  code: ErrorCode;
  message: string;
}

export type Ack<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };

export type AckFn<T = undefined> = (res: Ack<T>) => void;

/** Fields every game action carries. */
export interface GameActionBase {
  roomCode: string;
  /** Client-generated unique id; duplicates are rejected. */
  actionId: string;
  /** The game `seq` the client saw when it issued the action. */
  seq: number;
}

export interface JoinResult {
  room: RoomView;
  playerId: string;
  /** Session token; store it and send it back to reclaim the seat. */
  sessionToken: string;
}

export interface CreateRoomPayload {
  nickname: string;
  settings?: Partial<RoomSettings>;
}

export interface JoinRoomPayload {
  roomCode: string;
  nickname: string;
  sessionToken?: string;
  asSpectator?: boolean;
}

export interface ClientToServerEvents {
  'room:create': (p: CreateRoomPayload, ack: AckFn<JoinResult>) => void;
  'room:join': (p: JoinRoomPayload, ack: AckFn<JoinResult>) => void;
  'room:leave': (p: { roomCode: string }, ack: AckFn) => void;
  'room:ready': (p: { roomCode: string; ready: boolean }, ack: AckFn) => void;
  'room:switchSeat': (p: { roomCode: string; seat: Seat }, ack: AckFn) => void;
  'room:updateSettings': (p: { roomCode: string; settings: Partial<RoomSettings> }, ack: AckFn) => void;
  'room:backToLobby': (p: { roomCode: string }, ack: AckFn) => void;
  'game:start': (p: { roomCode: string }, ack: AckFn) => void;
  'game:bid': (p: GameActionBase & { amount: number }, ack: AckFn) => void;
  'game:pass': (p: GameActionBase, ack: AckFn) => void;
  'game:chooseTrump': (p: GameActionBase & { suit: Suit; reverse: boolean }, ack: AckFn) => void;
  'game:revealTrump': (p: GameActionBase, ack: AckFn) => void;
  'game:declarePair': (p: GameActionBase, ack: AckFn) => void;
  'game:playCard': (p: GameActionBase & { cardId: string }, ack: AckFn) => void;
  'game:nextRound': (p: GameActionBase, ack: AckFn) => void;
  'game:rematch': (p: GameActionBase, ack: AckFn) => void;
  'game:sync': (p: { roomCode: string }, ack: AckFn) => void;
}

export interface ServerToClientEvents {
  'room:created': (room: RoomView) => void;
  'room:updated': (room: RoomView) => void;
  /** `evicted`: this tab was superseded by the same player in another tab/device. */
  'room:closed': (p: { reason: string; evicted?: boolean }) => void;
  'game:started': (p: { round: number }) => void;
  'game:state': (state: GameView) => void;
  'game:actionAccepted': (p: { actionId: string; seq: number }) => void;
  'game:actionRejected': (p: { actionId: string | null; error: ActionError }) => void;
  'game:trickResolved': (p: { trick: TrickRecord }) => void;
  'game:roundFinished': (p: { result: RoundResult }) => void;
  'game:matchFinished': (p: { winner: TeamId; matchScore: [number, number] }) => void;
  'player:disconnected': (p: { seat: Seat; nickname: string }) => void;
  'player:reconnected': (p: { seat: Seat; nickname: string }) => void;
}
