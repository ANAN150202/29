/**
 * Full, authoritative server-side game state. This object never leaves the
 * server; clients receive sanitized views built by playerView.ts.
 */
import type {
  BidEntry,
  Card,
  Contract,
  LogEntry,
  PairDeclaration,
  Phase,
  PlayedCard,
  RoundResult,
  Seat,
  Suit,
  TeamId,
  TrickRecord,
} from '@shared/types';
import type { ErrorCode } from '@shared/events';
import type { RulesConfig } from '../config/rulesConfig';

export interface BiddingState {
  history: BidEntry[];
  highestBid: number | null;
  highestBidder: Seat | null;
  passed: [boolean, boolean, boolean, boolean];
  /** Speaking order for this round, starting after the dealer. */
  order: Seat[];
  /** Duel bidding: the player with priority (may "stay" at the current bid). */
  holder: Seat | null;
  /** Duel bidding: the player who must outbid the holder (null when bidding alone). */
  challenger: Seat | null;
  /** Duel bidding: index in `order` of the next player to enter the duel. */
  nextEntrant: number;
}

export interface GameState {
  rules: RulesConfig;
  /** Room-level switch: may the bidder pick Reverse Trump this match? */
  reverseTrumpAllowed: boolean;
  /** Display names per seat, used only for the game log. */
  names: [string, string, string, string];

  phase: Phase;
  round: number;
  /** Incremented after every accepted state change. */
  seq: number;
  dealer: Seat;
  turn: Seat | null;

  /** Undealt cards (never sent to clients). */
  deck: Card[];
  /** Private hands by seat (each player only ever receives their own). */
  hands: [Card[], Card[], Card[], Card[]];

  bidding: BiddingState;
  contract: Contract | null;

  trumpSuit: Suit | null;
  reverseTrump: boolean;
  trumpRevealed: boolean;
  trumpRevealedBy: Seat | null;
  /** Index of the trick during which trump was revealed (0 if open trump). */
  trumpRevealTrick: number | null;
  /** Seat that just revealed trump and must play a trump if able. */
  mustPlayTrumpSeat: Seat | null;

  currentTrick: { leader: Seat | null; cards: PlayedCard[] };
  completedTricks: TrickRecord[];
  tricksWon: [number, number];
  cardPoints: [number, number];
  matchScore: [number, number];
  pair: PairDeclaration | null;

  roundResult: RoundResult | null;
  roundHistory: RoundResult[];
  matchWinner: TeamId | null;

  log: LogEntry[];
  logCounter: number;
}

export type GameAction =
  | { type: 'bid'; amount: number }
  | { type: 'pass' }
  | { type: 'chooseTrump'; suit: Suit; reverse: boolean }
  | { type: 'revealTrump' }
  | { type: 'declarePair' }
  | { type: 'playCard'; cardId: string }
  | { type: 'nextRound' }
  | { type: 'rematch' };

export type EngineEvent =
  | { type: 'roundStarted'; round: number }
  | { type: 'redeal'; reason: string }
  | { type: 'trickResolved'; trick: TrickRecord }
  | { type: 'roundFinished'; result: RoundResult }
  | { type: 'matchFinished'; winner: TeamId; matchScore: [number, number] };

export type EngineResult =
  | { ok: true; events: EngineEvent[] }
  | { ok: false; error: { code: ErrorCode; message: string } };

/** Which phases accept which actions (explicit FSM table). */
export const PHASE_ACTIONS: Readonly<Record<Phase, readonly GameAction['type'][]>> = {
  waiting: [],
  dealing: [],
  bidding: ['bid', 'pass'],
  trumpSelection: ['chooseTrump'],
  playing: ['playCard', 'revealTrump', 'declarePair'],
  trickResolution: ['declarePair'],
  roundEnd: ['nextRound'],
  matchEnd: ['rematch'],
};
