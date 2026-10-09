import { describe, expect, it } from 'vitest';
import type { PlayedCard, Rank, Seat } from '@shared/types';
import { FULL_REVERSE_RULES, NORMAL_RANK_ORDER, OPEN_TRUMP_RULES } from '../server/src/config/rulesConfig';
import { sumPoints } from '../server/src/game/deck';
import { resolveTrick } from '../server/src/game/engine';
import { determineTrickWinner, getEffectiveCardStrength } from '../server/src/game/rules';
import { act, c, cards, riggedPlaying } from './helpers';

const RANKS = NORMAL_RANK_ORDER; // J 9 A 10 K Q 8 7 (strongest → weakest)
const card = (rank: Rank, suitCode = 'H') => c(`${rank}${suitCode}`);
const play = (seat: number, code: string): PlayedCard => ({ seat: seat as Seat, card: c(code) });

describe('Reverse Trump — every trump rank against every other trump rank', () => {
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = 0; j < RANKS.length; j++) {
      if (i === j) continue;
      const a = RANKS[i];
      const b = RANKS[j];
      const aNormallyStronger = i < j;

      it(`${a}♥ vs ${b}♥ — normal: ${aNormallyStronger ? a : b} wins, reverse: ${aNormallyStronger ? b : a} wins`, () => {
        // Lead a non-trump suit; seats 1 and 2 trump in with a and b.
        const trick = [play(0, 'AS'), { seat: 1 as Seat, card: card(a) }, { seat: 2 as Seat, card: card(b) }, play(3, '7S')];
        const normalWinner = determineTrickWinner(trick, 'hearts', false);
        const reverseWinner = determineTrickWinner(trick, 'hearts', true);
        expect(normalWinner).toBe(aNormallyStronger ? 1 : 2);
        expect(reverseWinner).toBe(aNormallyStronger ? 2 : 1);
        expect(normalWinner).not.toBe(reverseWinner);

        // Same comparison when trump itself is led.
        const led = [{ seat: 0 as Seat, card: card(a) }, { seat: 1 as Seat, card: card(b) }];
        expect(determineTrickWinner(led, 'hearts', false)).toBe(aNormallyStronger ? 0 : 1);
        expect(determineTrickWinner(led, 'hearts', true)).toBe(aNormallyStronger ? 1 : 0);
      });
    }
  }

  it('reverse trump order is 7 8 Q K 10 A 9 J (strongest → weakest)', () => {
    const order = [...RANKS].sort(
      (x, y) =>
        getEffectiveCardStrength(card(y), 'spades', 'hearts', true) -
        getEffectiveCardStrength(card(x), 'spades', 'hearts', true),
    );
    expect(order).toEqual(['7', '8', 'Q', 'K', '10', 'A', '9', 'J']);
  });
});

describe('Reverse Trump semantics', () => {
  it('the weakest reversed trump (J) still beats the best non-trump card', () => {
    const trick = [play(0, 'JS'), play(1, 'JH'), play(2, '9S'), play(3, 'AS')];
    expect(determineTrickWinner(trick, 'hearts', true)).toBe(1);
  });

  it('does not change the order of non-trump suits (default scope)', () => {
    for (let i = 0; i < RANKS.length; i++) {
      for (let j = i + 1; j < RANKS.length; j++) {
        const trick = [play(0, `${RANKS[j]}S`), play(1, `${RANKS[i]}S`)];
        expect(determineTrickWinner(trick, 'hearts', true)).toBe(1);
        expect(determineTrickWinner(trick, 'hearts', false)).toBe(1);
      }
    }
  });

  it('does not change card point values', () => {
    const trick = cards('JH 9H AH 10H');
    expect(sumPoints(trick)).toBe(7);
  });

  it('off-suit, non-trump cards can never win', () => {
    expect(getEffectiveCardStrength(c('JD'), 'spades', 'hearts', true)).toBe(0);
    expect(getEffectiveCardStrength(c('JD'), 'spades', 'hearts', false)).toBe(0);
  });

  it('has no effect when trump is not active (unrevealed concealed trump)', () => {
    const trick = [play(0, '7S'), play(1, 'JS'), play(2, '7H'), play(3, '8H')];
    expect(determineTrickWinner(trick, null, true)).toBe(1);
  });

  it('allSuits variant also reverses the lead suit (only when isolated in config)', () => {
    const trick = [play(0, 'JS'), play(1, '7S')];
    expect(determineTrickWinner(trick, 'hearts', true, 'trumpSuitOnly')).toBe(0);
    expect(determineTrickWinner(trick, 'hearts', true, 'allSuits')).toBe(1);
    expect(FULL_REVERSE_RULES.reverseTrumpScope).toBe('allSuits');
  });
});

describe('Reverse Trump through the engine', () => {
  const hands: [string, string, string, string] = [
    'AS 9C AC 10C KC QC 8C 7C',
    'JH 9D AD 10D KD QD 8D 7D',
    '7H JC JD 10S KS QS 8S 7S',
    'KH QH 8H 10H AH 9H JS 9S',
  ];

  function playFirstTrick(reverse: boolean) {
    const state = riggedPlaying({ hands, trump: 'hearts', reverse, rules: OPEN_TRUMP_RULES });
    act(state, 0, { type: 'playCard', cardId: 'spades-A' });
    act(state, 1, { type: 'playCard', cardId: 'hearts-J' }); // no spades → trumps with J
    act(state, 2, { type: 'playCard', cardId: 'spades-7' });
    act(state, 3, { type: 'playCard', cardId: 'spades-J' });
    // Seat 2 has spades so must follow; overtrump attempt happens next trick.
    return { state, ev: resolveTrick(state)[0] };
  }

  it('normal and reverse produce different winners for the same cards', () => {
    const normal = riggedPlaying({ hands, trump: 'hearts', reverse: false, rules: OPEN_TRUMP_RULES });
    const reverse = riggedPlaying({ hands, trump: 'hearts', reverse: true, rules: OPEN_TRUMP_RULES });
    for (const s of [normal, reverse]) {
      // Seat 0 leads clubs; seat 1 has no clubs → trumps with J♥; seat 2 follows; seat 3 has no clubs → 8♥.
      act(s, 0, { type: 'playCard', cardId: 'clubs-7' });
      act(s, 1, { type: 'playCard', cardId: 'hearts-J' });
      act(s, 2, { type: 'playCard', cardId: 'clubs-J' });
      act(s, 3, { type: 'playCard', cardId: 'hearts-8' });
    }
    const n = resolveTrick(normal)[0];
    const r = resolveTrick(reverse)[0];
    expect(n).toMatchObject({ trick: { winner: 1, points: 6 } });
    expect(r).toMatchObject({ trick: { winner: 3, points: 6 } });
    expect(normal.cardPoints).toEqual([0, 6]);
    expect(reverse.cardPoints).toEqual([0, 6]);
    expect(normal.turn).toBe(1);
    expect(reverse.turn).toBe(3);
  });

  it('a lone reversed J of trump still wins against non-trumps', () => {
    const { ev, state } = playFirstTrick(true);
    expect(ev).toMatchObject({ trick: { winner: 1 } });
    expect(state.turn).toBe(1);
  });
});
