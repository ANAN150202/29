/**
 * Shared domain types used by both the server and the client.
 * Nothing in this file contains game logic — the server is the single
 * source of truth for rules, card strength and scoring.
 */

export const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  /** Stable identifier, e.g. "hearts-J". */
  id: string;
  suit: Suit;
  rank: Rank;
}

export type Seat = 0 | 1 | 2 | 3;
/** Team 0 = seats 0 & 2, team 1 = seats 1 & 3 (partners sit opposite). */
export type TeamId = 0 | 1;

export type Phase =
  | 'waiting'
  | 'dealing'
  | 'bidding'
  | 'trumpSelection'
  /** Opponents may Double, bidder's team Redouble, opponents Set (seen only 4 cards). */
  | 'doubling'
  /** After all 8 cards: any player may declare a Single Hand. */
  | 'singleHand'
  | 'playing'
  | 'trickResolution'
  | 'roundEnd'
  | 'matchEnd';

export interface RulesetSummary {
  id: string;
  name: string;
  description: string;
  minBid: number;
  maxBid: number;
  targetScore: number;
  trumpConcealed: boolean;
  pairEnabled: boolean;
  reverseTrumpSupported: boolean;
  reverseTrumpScope: 'trumpSuitOnly' | 'allSuits';
}

export interface RoomSettings {
  rulesetId: string;
  reverseTrumpEnabled: boolean;
  allowSpectators: boolean;
  /** Seconds a player has to act; 0 disables the timer. */
  turnTimeLimitSec: number;
  /** 'duel' = traditional two-at-a-time auction with "stay"; 'open' = everyone raises in turn. */
  biddingStyle: BiddingStyle;
}

export type SeatStatus = 'empty' | 'connected' | 'ready' | 'disconnected' | 'vacant';

export interface PublicPlayer {
  seat: Seat;
  nickname: string;
  team: TeamId;
  connected: boolean;
  ready: boolean;
  isHost: boolean;
  /** Seat holder left mid-match; the server auto-plays until someone takes the seat. */
  vacated: boolean;
  /** Computer-controlled player. */
  isBot: boolean;
  status: SeatStatus;
}

export interface RoomView {
  code: string;
  status: 'lobby' | 'inGame';
  seats: (PublicPlayer | null)[];
  settings: RoomSettings;
  ruleset: RulesetSummary;
  mySeat: Seat | null;
  isHost: boolean;
  isSpectator: boolean;
  spectatorCount: number;
}

export interface BidEntry {
  seat: Seat;
  /** null = pass */
  bid: number | null;
  /** Duel bidding: the player with priority matched the current bid. */
  stay?: boolean;
}

export type BiddingStyle = 'duel' | 'open';

export interface PlayedCard {
  seat: Seat;
  card: Card;
}

export interface TrickRecord {
  index: number;
  leader: Seat;
  cards: PlayedCard[];
  winner: Seat;
  points: number;
  trumpActive: boolean;
}

export type DoublingCall = 'double' | 'redouble' | 'set';

export interface Contract {
  bidder: Seat;
  team: TeamId;
  /** The winning bid as made in the auction. */
  bid: number;
  /** Current card-point target (bid adjusted by pair declarations). */
  target: number;
  /** 0 = none, 1 = doubled, 2 = redoubled, 3 = set. */
  doubleLevel?: number;
  /** Game points won/lost are multiplied by this (1, 2, 4 or 6 by default). */
  multiplier?: number;
}

export interface PairDeclaration {
  seat: Seat;
  team: TeamId;
  /** Signed change applied to the contract target. */
  adjustment: number;
}

export interface RoundResult {
  round: number;
  /** 'single' when a Single Hand replaced the contract. */
  kind: 'contract' | 'single';
  multiplier: number;
  single: { seat: Seat; success: boolean; tricksWon: number } | null;
  contract: Contract;
  bidderTeamPoints: number;
  success: boolean;
  /** Game points added to each team this round (may be negative). */
  gamePointsDelta: [number, number];
  cardPoints: [number, number];
  tricksWon: [number, number];
  trumpSuit: Suit;
  reverseTrump: boolean;
  matchScore: [number, number];
}

export interface LogEntry {
  id: number;
  text: string;
  kind: 'info' | 'bid' | 'trump' | 'play' | 'trick' | 'round' | 'system';
}

export interface TrumpView {
  /** Whether trump has been revealed to everyone. */
  revealed: boolean;
  /** Suit, only if revealed or the viewer is the bidder (or the round is over). */
  suit: Suit | null;
  /** Reverse mode, same visibility as suit. */
  reverse: boolean | null;
  /** True when a trump has been chosen but is still hidden from this viewer. */
  hiddenFromMe: boolean;
  revealedBy: Seat | null;
}

export interface GameView {
  phase: Phase;
  round: number;
  /** Action sequence number; clients echo it with each action. */
  seq: number;
  dealer: Seat;
  turn: Seat | null;
  mySeat: Seat | null;
  myHand: Card[];
  /** Server-computed legal plays for the viewer (empty if not their turn). */
  legalCardIds: string[];
  handCounts: number[];
  bidding: {
    history: BidEntry[];
    highestBid: number | null;
    highestBidder: Seat | null;
    passed: boolean[];
    minBid: number;
    maxBid: number;
    /** Lowest amount the viewer may bid right now. */
    nextMinBid: number;
    /** True when the viewer may not pass (dealer forced to bid). */
    mustBid: boolean;
    style: BiddingStyle;
    /** Duel: player with priority (can stay). */
    holder: Seat | null;
    /** Duel: player who must outbid the holder. */
    challenger: Seat | null;
    /** Duel: players who have not entered the bidding yet, in order. */
    waiting: Seat[];
    /** True when the viewer's lowest legal bid equals the current bid (a "stay"). */
    canStay: boolean;
  };
  contract: Contract | null;
  trump: TrumpView;
  reverseTrumpAllowed: boolean;
  canRevealTrump: boolean;
  canDeclarePair: boolean;
  /** Seat that revealed trump in this trick and must now play a trump. */
  mustPlayTrump: boolean;
  pair: PairDeclaration | null;
  currentTrick: {
    leader: Seat | null;
    leadSuit: Suit | null;
    cards: PlayedCard[];
  };
  doubling: {
    /** Which call is currently open (null when the window is closed). */
    stage: DoublingCall | null;
    level: number;
    multiplier: number;
    /** Players who still have to decide on the open call. */
    pending: Seat[];
    calls: { seat: Seat; call: DoublingCall }[];
    /** The viewer may make the open call right now. */
    canCall: boolean;
  };
  single: {
    declarer: Seat | null;
    /** Players who still have to decide whether to declare (window open). */
    pending: Seat[];
    /** The viewer may declare a Single Hand right now. */
    canDeclare: boolean;
    /** Why the viewer may not declare, if they are pending but blocked. */
    blockedReason: string | null;
    points: number;
  };
  /** Server-determined winner of the completed trick shown during trickResolution. */
  trickWinner: Seat | null;
  lastTrick: TrickRecord | null;
  tricksPlayed: number;
  tricksWon: [number, number];
  cardPoints: [number, number];
  matchScore: [number, number];
  targetScore: number;
  roundResult: RoundResult | null;
  matchWinner: TeamId | null;
  /** Milliseconds left before the current turn auto-resolves (null = no timer). */
  turnTimeLeftMs: number | null;
  /** Full turn length in ms, for drawing the timer bar. */
  turnTimeLimitMs: number | null;
  log: LogEntry[];
}

export const teamOf = (seat: Seat): TeamId => (seat % 2) as TeamId;
export const cardId = (suit: Suit, rank: Rank): string => `${suit}-${rank}`;
