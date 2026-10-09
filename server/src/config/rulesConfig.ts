/**
 * ─────────────────────────────────────────────────────────────────────────
 *  29 ROYALE — RULES CONFIGURATION (single source of configurable rules)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 29 has many regional variations. Every rule that differs between regions
 * is isolated here. The game engine reads these values and never hard-codes
 * a regional choice. See docs/RULES.md for the human-readable version.
 *
 * Fixed (not configurable — these define the game of 29 itself):
 *   • 32-card deck: 7 8 9 10 J Q K A in ♣ ♦ ♥ ♠.
 *   • Card points: J=3, 9=2, A=1, 10=1, others 0 — 28 points total.
 *   • Normal rank order (strongest → weakest): J 9 A 10 K Q 8 7.
 *   • Four players, partners sit opposite (seats 0+2 vs 1+3).
 *   • Play proceeds to the next seat index (seat + 1), which the UI renders
 *     anticlockwise: the player on your right acts after you.
 *   • Must follow the lead suit when able.
 */
import type { Rank } from '@shared/types';

export type AllPassAction =
  /** Hand is thrown in; the deal passes to the next dealer. */
  | 'redeal'
  /** If the first three players pass, the dealer must bid the minimum. */
  | 'dealerForced';

export type BiddingStyle =
  /**
   * Traditional 29 auction: two players bid at a time. The first two after the
   * dealer start; the later player must bid higher, the earlier player (who
   * holds priority) may "stay" by matching. Whoever passes is out and the next
   * player in order challenges the survivor, until everyone has spoken.
   */
  | 'duel'
  /** Everyone bids in turn order; each bid must beat the current high bid. */
  | 'open';

export type ReverseTrumpScope =
  /** Only the trump suit's rank order is inverted (default). */
  | 'trumpSuitOnly'
  /** Every suit's rank order is inverted (regional "full reverse" variant). */
  | 'allSuits';

export interface RulesConfig {
  id: string;
  name: string;
  description: string;

  // ── Bidding ──────────────────────────────────────────────────────────
  /** Lowest legal opening bid. */
  minBid: number;
  /** Highest legal bid (all 28 card points). */
  maxBid: number;
  /** Each bid must exceed the current highest by at least this much. */
  bidIncrement: number;
  /** What happens when nobody bids. */
  allPassAction: AllPassAction;
  /** Auction format (default 'duel'; rooms can switch to 'open'). */
  biddingStyle: BiddingStyle;

  // ── Trump ────────────────────────────────────────────────────────────
  /**
   * Classic 29: the bidder chooses trump secretly after seeing only their
   * first four cards. It stays hidden until a player who cannot follow suit
   * asks for it to be revealed. Before it is revealed, trump-suit cards have
   * no trumping power. When false, trump is announced immediately.
   */
  trumpConcealed: boolean;
  /**
   * When a player reveals trump (because they cannot follow suit), they must
   * then play a trump card if they hold one.
   */
  mustPlayTrumpAfterReveal: boolean;

  // ── Reverse Trump ────────────────────────────────────────────────────
  /** Whether this ruleset supports Reverse Trump at all. */
  reverseTrumpSupported: boolean;
  /**
   * Reverse Trump keeps card POINT values unchanged; it only reverses
   * trick-winning priority. Under the default scope only the trump suit's
   * order becomes 7 8 Q K 10 A 9 J (7 strongest, J weakest). Trump still
   * beats every non-trump card; other suits keep their normal order.
   */
  reverseTrumpScope: ReverseTrumpScope;

  // ── Pair (King + Queen of trump, a.k.a. "marriage") ──────────────────
  pairEnabled: boolean;
  /** Target change when a pair is declared (−value for bidding team, +value for defenders). */
  pairValue: number;
  /** Pair cannot push the target below this value. */
  pairMinTarget: number;
  /** Pair cannot push the target above this value. */
  pairMaxTarget: number;

  // ── Double / Redouble / Set ──────────────────────────────────────────
  /**
   * After trump is chosen and BEFORE the last four cards are dealt, the
   * opponents may Double, then the bidder's team may Redouble, then the
   * opponents may Set. Each call multiplies the game points at stake.
   */
  doublingEnabled: boolean;
  /** Game-point multiplier for [none, double, redouble, set]. */
  doublingMultipliers: [number, number, number, number];

  // ── Single Hand ──────────────────────────────────────────────────────
  /**
   * After all 8 cards are dealt, any player may declare a Single Hand: their
   * partner sits out, they lead, there is no trump, and they must win all 8
   * tricks. Not allowed with a hand that cannot conceivably lose a trick.
   */
  singleHandEnabled: boolean;
  /** Game points won (or lost) by a Single Hand. Replaces the contract. */
  singleHandPoints: number;

  /** Milliseconds the Double/Set and Single-Hand decision windows stay open. */
  declarationWindowMs: number;

  // ── Scoring ──────────────────────────────────────────────────────────
  /** Game points the bidding team gains when it makes its contract. */
  gamePointsForWin: number;
  /** Game points the bidding team loses when it fails its contract. */
  gamePointsForLoss: number;
  /**
   * Match ends when a team reaches +targetScore (it wins) or −targetScore
   * (it loses, the other team wins).
   */
  targetScore: number;

  // ── Timing (presentation, used by the room layer) ────────────────────
  /** Milliseconds a completed trick stays on the table before being collected. */
  trickDisplayMs: number;
}

/** Fixed card point values. Reverse Trump never changes these. */
export const CARD_POINTS: Readonly<Record<Rank, number>> = {
  J: 3,
  '9': 2,
  A: 1,
  '10': 1,
  K: 0,
  Q: 0,
  '8': 0,
  '7': 0,
};

/** Normal rank order, strongest first. */
export const NORMAL_RANK_ORDER: readonly Rank[] = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];

export const CLASSIC_RULES: RulesConfig = {
  id: 'classic',
  name: 'Classic 29',
  description:
    'Hidden trump revealed on demand, pair (K+Q of trump) adjusts the target by 4, first to +6 wins.',
  minBid: 16,
  maxBid: 28,
  bidIncrement: 1,
  allPassAction: 'redeal',
  biddingStyle: 'duel',
  trumpConcealed: true,
  mustPlayTrumpAfterReveal: true,
  reverseTrumpSupported: true,
  reverseTrumpScope: 'trumpSuitOnly',
  pairEnabled: true,
  pairValue: 4,
  pairMinTarget: 16,
  pairMaxTarget: 28,
  doublingEnabled: true,
  doublingMultipliers: [1, 2, 4, 6],
  singleHandEnabled: true,
  singleHandPoints: 3,
  declarationWindowMs: 12_000,
  gamePointsForWin: 1,
  gamePointsForLoss: 1,
  targetScore: 6,
  trickDisplayMs: 1400,
};

export const OPEN_TRUMP_RULES: RulesConfig = {
  ...CLASSIC_RULES,
  id: 'open',
  name: 'Open Trump',
  description:
    'Beginner friendly: trump is announced as soon as it is chosen, no pair. First to +6 wins.',
  trumpConcealed: false,
  mustPlayTrumpAfterReveal: false,
  pairEnabled: false,
};

export const FULL_REVERSE_RULES: RulesConfig = {
  ...CLASSIC_RULES,
  id: 'fullReverse',
  name: 'Classic · Full Reverse',
  description:
    'Classic rules, but Reverse Trump inverts the rank order of every suit, not only the trump suit.',
  reverseTrumpScope: 'allSuits',
};

export const RULESETS: Readonly<Record<string, RulesConfig>> = {
  [CLASSIC_RULES.id]: CLASSIC_RULES,
  [OPEN_TRUMP_RULES.id]: OPEN_TRUMP_RULES,
  [FULL_REVERSE_RULES.id]: FULL_REVERSE_RULES,
};

export const DEFAULT_RULESET_ID = CLASSIC_RULES.id;

export function getRuleset(id: string | undefined): RulesConfig {
  return (id && RULESETS[id]) || RULESETS[DEFAULT_RULESET_ID];
}
