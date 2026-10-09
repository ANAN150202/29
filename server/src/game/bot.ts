/**
 * Computer player. It decides from the exact sanitized view a human in that
 * seat would receive (buildPlayerView), so it never sees other hands, the
 * deck, or a concealed trump it is not entitled to know.
 */
import type { Card, GameView, PlayedCard, Seat, Suit } from '@shared/types';
import { SUITS } from '@shared/types';
import { CARD_POINTS, type ReverseTrumpScope } from '../config/rulesConfig';
import { getEffectiveCardStrength, normalRankStrength, reversedRankStrength } from './rules';
import type { GameAction } from './state';

const pts = (c: Card) => CARD_POINTS[c.rank];
const team = (s: Seat) => s % 2;

/** Rough number of card points this 4-card hand is worth as bidder. */
export function estimateHand(hand: Card[]): number {
  const handPts = hand.reduce((a, c) => a + pts(c), 0);
  const bySuit = SUITS.map((s) => hand.filter((c) => c.suit === s));
  const longest = bySuit.reduce((a, b) => (b.length > a.length ? b : a));
  const jackInLongest = longest.some((c) => c.rank === 'J') ? 1 : 0;
  const jacks = hand.filter((c) => c.rank === 'J').length;
  return 13 + 1.2 * handPts + (longest.length - 1) + jackInLongest + (jacks >= 2 ? 1 : 0);
}

function decideBid(v: GameView): GameAction {
  const b = v.bidding;
  if (b.mustBid) return { type: 'bid', amount: b.nextMinBid };
  let limit = Math.floor(estimateHand(v.myHand));
  // Don't fight your own partner unless clearly stronger.
  const partnerHolds = b.highestBidder !== null && v.mySeat !== null && team(b.highestBidder) === team(v.mySeat);
  if (partnerHolds) limit -= 3;
  if (b.nextMinBid > b.maxBid || b.nextMinBid > limit) return { type: 'pass' };
  // Stay when allowed (cheapest way to keep the bid), otherwise raise by the minimum.
  return { type: 'bid', amount: b.nextMinBid };
}

function decideTrump(v: GameView): GameAction {
  let best: { suit: Suit; reverse: boolean; score: number } = { suit: v.myHand[0]?.suit ?? 'spades', reverse: false, score: -1 };
  for (const suit of SUITS) {
    const cards = v.myHand.filter((c) => c.suit === suit);
    if (!cards.length) continue;
    const normal = cards.reduce((a, c) => a + normalRankStrength(c.rank), 0);
    const reversed = cards.reduce((a, c) => a + reversedRankStrength(c.rank), 0);
    const reverse = v.reverseTrumpAllowed && reversed > normal + 2;
    const score = cards.length * 10 + Math.max(normal, reverse ? reversed : 0);
    if (score > best.score) best = { suit, reverse, score };
  }
  return { type: 'chooseTrump', suit: best.suit, reverse: best.reverse };
}

interface TrickCtx {
  leadSuit: Suit;
  trumpSuit: Suit | null; // only when active (revealed)
  reverse: boolean;
  scope: ReverseTrumpScope;
}

function strength(c: Card, t: TrickCtx) {
  return getEffectiveCardStrength(c, t.leadSuit, t.trumpSuit, t.reverse, t.scope);
}

function currentWinner(cards: PlayedCard[], t: TrickCtx): { seat: Seat; strength: number } {
  let best = { seat: cards[0].seat, strength: strength(cards[0].card, t) };
  for (const pc of cards.slice(1)) {
    const s = strength(pc.card, t);
    if (s > best.strength) best = { seat: pc.seat, strength: s };
  }
  return best;
}

/** Lowest-value card: fewest points, then weakest rank, avoiding known trumps. */
function cheapest(cards: Card[], trumpSuit: Suit | null): Card {
  return cards
    .slice()
    .sort(
      (a, b) =>
        Number(a.suit === trumpSuit) - Number(b.suit === trumpSuit) ||
        pts(a) - pts(b) ||
        normalRankStrength(a.rank) - normalRankStrength(b.rank),
    )[0];
}

function decidePlay(v: GameView, scope: ReverseTrumpScope): GameAction {
  const me = v.mySeat!;
  const legal = v.myHand.filter((c) => v.legalCardIds.includes(c.id));
  const trick = v.currentTrick.cards;
  const knownTrump = v.trump.suit; // null if hidden from this bot
  const activeTrump = v.trump.revealed ? knownTrump : null;
  const reverse = !!v.trump.reverse;

  // Leading: cash a Jack if we hold one outside trump, otherwise lead low from the longest side suit.
  if (trick.length === 0) {
    const jack = legal.find((c) => c.rank === 'J' && c.suit !== knownTrump);
    if (jack) return { type: 'playCard', cardId: jack.id };
    const side = legal.filter((c) => c.suit !== knownTrump);
    const pool = side.length ? side : legal;
    const counts = new Map<Suit, number>();
    pool.forEach((c) => counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1));
    const longSuit = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { type: 'playCard', cardId: cheapest(pool.filter((c) => c.suit === longSuit), knownTrump).id };
  }

  const ctx: TrickCtx = { leadSuit: trick[0].card.suit, trumpSuit: activeTrump, reverse, scope };
  const winner = currentWinner(trick, ctx);
  const partnerWinning = team(winner.seat) === team(me);
  const last = trick.length === 3;
  const trickPts = trick.reduce((a, pc) => a + pts(pc.card), 0);

  // Ask for the trump when void and the opponents are winning something worth having.
  if (v.canRevealTrump && !partnerWinning && (trickPts > 0 || v.tricksPlayed >= 4)) return { type: 'revealTrump' };

  const winners = legal.filter((c) => strength(c, ctx) > winner.strength);
  if (partnerWinning) {
    if (last || (winner.strength >= 100 + 7 && !activeTrump) || winner.strength >= 200) {
      // Safe: give partner points (but don't waste trumps).
      const nonTrump = legal.filter((c) => c.suit !== activeTrump);
      const pool = nonTrump.length ? nonTrump : legal;
      const richest = pool.slice().sort((a, b) => pts(b) - pts(a) || normalRankStrength(a.rank) - normalRankStrength(b.rank))[0];
      return { type: 'playCard', cardId: richest.id };
    }
    return { type: 'playCard', cardId: cheapest(legal, activeTrump).id };
  }
  if (winners.length && (trickPts > 0 || last || winners.some((c) => c.suit !== activeTrump))) {
    // Win as cheaply as possible.
    const cheapestWinner = winners.slice().sort((a, b) => strength(a, ctx) - strength(b, ctx))[0];
    return { type: 'playCard', cardId: cheapestWinner.id };
  }
  return { type: 'playCard', cardId: cheapest(legal, activeTrump).id };
}

/** The bot's next action for the view it was given, or null if it has nothing to do. */
export function chooseBotAction(v: GameView, scope: ReverseTrumpScope = 'trumpSuitOnly'): GameAction | null {
  if (v.mySeat === null) return null;
  if (v.canDeclarePair) return { type: 'declarePair' };
  if (v.turn !== v.mySeat) return null;
  if (v.phase === 'bidding') return decideBid(v);
  if (v.phase === 'trumpSelection') return decideTrump(v);
  if (v.phase === 'playing' && v.legalCardIds.length) return decidePlay(v, scope);
  return null;
}
