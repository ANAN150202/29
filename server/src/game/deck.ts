import { randomInt } from 'node:crypto';
import { RANKS, SUITS, cardId, type Card } from '@shared/types';
import { CARD_POINTS } from '../config/rulesConfig';

/** Returns an integer in [0, maxExclusive). */
export type RandomIntFn = (maxExclusive: number) => number;

/** Cryptographically secure RNG (default for real games). */
export const secureRandomInt: RandomIntFn = (max) => randomInt(max);

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ id: cardId(suit, rank), suit, rank });
  }
  return deck;
}

/** Fisher–Yates shuffle; returns a new array. */
export function shuffle<T>(items: readonly T[], rng: RandomIntFn = secureRandomInt): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function cardPoints(card: Card): number {
  return CARD_POINTS[card.rank];
}

export function sumPoints(cards: readonly Card[]): number {
  return cards.reduce((acc, c) => acc + cardPoints(c), 0);
}

export function parseCardId(id: string): Card | null {
  const idx = id.lastIndexOf('-');
  if (idx <= 0) return null;
  const suit = id.slice(0, idx);
  const rank = id.slice(idx + 1);
  if (!(SUITS as readonly string[]).includes(suit) || !(RANKS as readonly string[]).includes(rank)) return null;
  return { id, suit: suit as Card['suit'], rank: rank as Card['rank'] };
}

/** Deterministic seeded RNG for tests and replays (mulberry32). */
export function seededRandomInt(seed: number): RandomIntFn {
  let a = seed >>> 0;
  return (max) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(r * max);
  };
}
