/**
 * Card strength and trick resolution — the single source of truth for
 * "which card wins". The client never compares cards; it only renders
 * what the server decides.
 */
import type { Card, PlayedCard, Rank, Seat, Suit } from '@shared/types';
import { NORMAL_RANK_ORDER, type ReverseTrumpScope } from '../config/rulesConfig';

/** Rank strength within a suit under normal order: J=8 … 7=1. */
export function normalRankStrength(rank: Rank): number {
  return NORMAL_RANK_ORDER.length - NORMAL_RANK_ORDER.indexOf(rank);
}

/** Rank strength with the order inverted: 7=8 … J=1. */
export function reversedRankStrength(rank: Rank): number {
  return NORMAL_RANK_ORDER.length + 1 - normalRankStrength(rank);
}

const TRUMP_TIER = 200;
const LEAD_TIER = 100;

/**
 * Effective strength of a card within a single trick.
 *
 *  • Cards of the (active) trump suit: TRUMP_TIER + rank strength.
 *  • Cards of the lead suit:           LEAD_TIER + rank strength.
 *  • Any other card:                   0 (can never win the trick).
 *
 * `trumpSuit` must be null when trump is not active for the trick (e.g. a
 * concealed trump that has not been revealed). When `reverseTrump` is true,
 * the trump suit's rank order is inverted; with scope 'allSuits' the lead
 * suit's order is inverted too. Point values are never affected.
 */
export function getEffectiveCardStrength(
  card: Card,
  leadSuit: Suit,
  trumpSuit: Suit | null,
  reverseTrump: boolean,
  reverseScope: ReverseTrumpScope = 'trumpSuitOnly',
): number {
  if (trumpSuit !== null && card.suit === trumpSuit) {
    return TRUMP_TIER + (reverseTrump ? reversedRankStrength(card.rank) : normalRankStrength(card.rank));
  }
  if (card.suit === leadSuit) {
    const reverseLead = reverseTrump && trumpSuit !== null && reverseScope === 'allSuits';
    return LEAD_TIER + (reverseLead ? reversedRankStrength(card.rank) : normalRankStrength(card.rank));
  }
  return 0;
}

/** Determine the winning seat of a complete (or partial) trick. */
export function determineTrickWinner(
  cards: readonly PlayedCard[],
  trumpSuit: Suit | null,
  reverseTrump: boolean,
  reverseScope: ReverseTrumpScope = 'trumpSuitOnly',
): Seat {
  if (cards.length === 0) throw new Error('Cannot resolve an empty trick');
  const leadSuit = cards[0].card.suit;
  let best = cards[0];
  let bestStrength = getEffectiveCardStrength(best.card, leadSuit, trumpSuit, reverseTrump, reverseScope);
  for (const pc of cards.slice(1)) {
    const s = getEffectiveCardStrength(pc.card, leadSuit, trumpSuit, reverseTrump, reverseScope);
    if (s > bestStrength) {
      best = pc;
      bestStrength = s;
    }
  }
  return best.seat;
}

/**
 * Cards a player may legally play.
 *  1. Leading a trick: any card.
 *  2. Holding the lead suit: must follow suit.
 *  3. Just revealed trump (and the ruleset requires it): must play trump if held.
 *  4. Otherwise: any card.
 */
export function legalCards(
  hand: readonly Card[],
  leadSuit: Suit | null,
  opts: { mustPlayTrump: boolean; trumpSuit: Suit | null },
): Card[] {
  if (leadSuit === null) return hand.slice();
  const follow = hand.filter((c) => c.suit === leadSuit);
  if (follow.length > 0) return follow;
  if (opts.mustPlayTrump && opts.trumpSuit) {
    const trumps = hand.filter((c) => c.suit === opts.trumpSuit);
    if (trumps.length > 0) return trumps;
  }
  return hand.slice();
}

export const nextSeat = (seat: Seat): Seat => ((seat + 1) % 4) as Seat;
