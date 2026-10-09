import type { RoomSettings, Seat } from '@shared/types';
import type { ErrorCode } from '@shared/events';
import type { RulesConfig } from '../config/rulesConfig';
import type { GameState } from '../game/state';

export interface PlayerSession {
  playerId: string;
  /** SHA-256 of the session token; the raw token is never stored or logged. */
  tokenHash: string;
  nickname: string;
  /** null for spectators. */
  seat: Seat | null;
  socketId: string | null;
  connected: boolean;
  ready: boolean;
  disconnectedAt: number | null;
  /** Left mid-match or exceeded the reconnection grace period; auto-played. */
  vacated: boolean;
  /** Recently seen action ids (for duplicate detection). */
  recentActionIds: string[];
}

export interface Room {
  code: string;
  createdAt: number;
  lastActivity: number;
  hostId: string;
  settings: RoomSettings;
  rules: RulesConfig;
  status: 'lobby' | 'inGame';
  /** playerId per seat. */
  seats: (string | null)[];
  players: Map<string, PlayerSession>;
  game: GameState | null;
  timers: {
    turn: NodeJS.Timeout | null;
    trick: NodeJS.Timeout | null;
    grace: Map<string, NodeJS.Timeout>;
  };
  turnDeadline: number | null;
}

export class RoomError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
