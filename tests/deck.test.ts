import { describe, expect, it } from 'vitest';
import { CARD_POINTS } from '../server/src/config/rulesConfig';
import { createDeck, parseCardId, seededRandomInt, shuffle, sumPoints } from '../server/src/game/deck';
import { applyAction } from '../server/src/game/engine';
import { newMatch } from './helpers';

describe('deck', () => {
  it('has exactly 32 unique cards, 8 per suit', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(32);
    expect(new Set(deck.map((c) => c.id)).size).toBe(32);
    for (const suit of ['clubs', 'diamonds', 'hearts', 'spades']) {
      expect(deck.filter((c) => c.suit === suit).map((c) => c.rank).sort()).toEqual(
        ['10', '7', '8', '9', 'A', 'J', 'K', 'Q'],
      );
    }
  });

  it('totals 28 card points (J=3, 9=2, A=1, 10=1)', () => {
    expect(sumPoints(createDeck())).toBe(28);
    expect(CARD_POINTS).toMatchObject({ J: 3, '9': 2, A: 1, '10': 1, K: 0, Q: 0, '8': 0, '7': 0 });
  });

  it('shuffle is a permutation and does not mutate the input', () => {
    const deck = createDeck();
    const ids = deck.map((c) => c.id);
    const s = shuffle(deck, seededRandomInt(1));
    expect(deck.map((c) => c.id)).toEqual(ids);
    expect(s.map((c) => c.id).sort()).toEqual([...ids].sort());
    expect(s.map((c) => c.id)).not.toEqual(ids);
  });

  it('default shuffle uses crypto randomness and still yields a permutation', () => {
    const s = shuffle(createDeck());
    expect(new Set(s.map((c) => c.id)).size).toBe(32);
  });

  it('parses card ids and rejects garbage', () => {
    expect(parseCardId('hearts-10')).toEqual({ id: 'hearts-10', suit: 'hearts', rank: '10' });
    expect(parseCardId('hearts-1')).toBeNull();
    expect(parseCardId('stars-J')).toBeNull();
  });

  it('deals 4 cards each before bidding and 8 each after trump; 16 then 0 left undealt', () => {
    const { state } = newMatch();
    expect(state.hands.map((h) => h.length)).toEqual([4, 4, 4, 4]);
    expect(state.deck).toHaveLength(16);
    // bid then choose trump
    const first = state.turn!;
    expect(applyAction(state, first, { type: 'bid', amount: 16 }).ok).toBe(true);
    let s = state.turn!;
    for (let i = 0; i < 3; i++) {
      expect(applyAction(state, s, { type: 'pass' }).ok).toBe(true);
      s = state.turn!;
    }
    expect(state.phase).toBe('trumpSelection');
    expect(applyAction(state, first, { type: 'chooseTrump', suit: 'hearts', reverse: false }).ok).toBe(true);
    expect(state.hands.map((h) => h.length)).toEqual([8, 8, 8, 8]);
    expect(state.deck).toHaveLength(0);
    const all = state.hands.flat().map((c) => c.id);
    expect(new Set(all).size).toBe(32);
  });
});
