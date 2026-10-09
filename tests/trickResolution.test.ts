import { describe, expect, it } from 'vitest';
import type { PlayedCard, Seat } from '@shared/types';
import { OPEN_TRUMP_RULES } from '../server/src/config/rulesConfig';
import { applyAction, getLegalCards, resolveTrick } from '../server/src/game/engine';
import { determineTrickWinner, legalCards } from '../server/src/game/rules';
import { act, c, cards, riggedPlaying } from './helpers';

const play = (seat: number, code: string): PlayedCard => ({ seat: seat as Seat, card: c(code) });

describe('trick winner (normal trump)', () => {
  it('highest lead-suit card wins when no trump is played (J 9 A 10 K Q 8 7)', () => {
    expect(determineTrickWinner([play(0, 'AS'), play(1, '9S'), play(2, '10S'), play(3, 'KS')], 'hearts', false)).toBe(1);
    expect(determineTrickWinner([play(0, '7S'), play(1, '8S'), play(2, 'QS'), play(3, 'KS')], 'hearts', false)).toBe(3);
    expect(determineTrickWinner([play(0, '10S'), play(1, 'AS'), play(2, 'JD'), play(3, 'KS')], 'hearts', false)).toBe(1);
  });

  it('any trump beats any non-trump', () => {
    expect(determineTrickWinner([play(0, 'JS'), play(1, '7H'), play(2, '9S'), play(3, 'AS')], 'hearts', false)).toBe(1);
  });

  it('higher trump beats lower trump', () => {
    expect(determineTrickWinner([play(0, 'JS'), play(1, '7H'), play(2, '9H'), play(3, 'AH')], 'hearts', false)).toBe(2);
  });

  it('off-suit discards never win', () => {
    expect(determineTrickWinner([play(0, '7S'), play(1, 'JD'), play(2, 'JC'), play(3, '8S')], 'hearts', false)).toBe(3);
  });

  it('with no trump active, only the lead suit matters', () => {
    expect(determineTrickWinner([play(0, '7S'), play(1, 'JH')], null, false)).toBe(0);
  });
});

describe('legal plays', () => {
  it('must follow suit when able', () => {
    const hand = cards('JS 7S AH 9D');
    expect(legalCards(hand, 'spades', { mustPlayTrump: false, trumpSuit: 'hearts' }).map((x) => x.id)).toEqual(['spades-J', 'spades-7']);
  });
  it('any card when void in the lead suit or leading', () => {
    const hand = cards('AH 9D');
    expect(legalCards(hand, 'spades', { mustPlayTrump: false, trumpSuit: 'hearts' })).toHaveLength(2);
    expect(legalCards(hand, null, { mustPlayTrump: false, trumpSuit: 'hearts' })).toHaveLength(2);
  });
});

describe('trick flow through the engine', () => {
  const hands: [string, string, string, string] = [
    'JS 9S AS 10S KS QS 8S 7S',
    'JH 9H AH 10H KH QH 8H 7H',
    'JC 9C AC 10C KC QC 8C 7C',
    'JD 9D AD 10D KD QD 8D 7D',
  ];

  it('rejects playing out of turn, unowned cards and failing to follow suit', () => {
    const s = riggedPlaying({ hands: ['JS 9S AS 10S KS QS 8S 7H', '7S 9H AH 10H KH QH 8H JH', hands[2], hands[3]], trump: 'clubs' });
    expect(applyAction(s, 1, { type: 'playCard', cardId: 'hearts-9' })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    expect(applyAction(s, 0, { type: 'playCard', cardId: 'hearts-9' })).toMatchObject({ ok: false, error: { code: 'CARD_NOT_OWNED' } });
    expect(applyAction(s, 0, { type: 'playCard', cardId: 'not-a-card' })).toMatchObject({ ok: false, error: { code: 'CARD_NOT_OWNED' } });
    act(s, 0, { type: 'playCard', cardId: 'spades-J' });
    expect(getLegalCards(s, 1).map((x) => x.id)).toEqual(['spades-7']);
    expect(applyAction(s, 1, { type: 'playCard', cardId: 'hearts-J' })).toMatchObject({ ok: false, error: { code: 'ILLEGAL_CARD' } });
    act(s, 1, { type: 'playCard', cardId: 'spades-7' });
    expect(s.hands[0]).toHaveLength(7);
  });

  it('winner collects points and leads the next trick; cards cannot be played during resolution', () => {
    const s = riggedPlaying({ hands, trump: 'diamonds' });
    act(s, 0, { type: 'playCard', cardId: 'spades-9' });
    act(s, 1, { type: 'playCard', cardId: 'hearts-J' });
    act(s, 2, { type: 'playCard', cardId: 'clubs-J' });
    act(s, 3, { type: 'playCard', cardId: 'diamonds-7' });
    expect(s.phase).toBe('trickResolution');
    expect(applyAction(s, 0, { type: 'playCard', cardId: 'spades-J' })).toMatchObject({ ok: false, error: { code: 'WRONG_PHASE' } });
    const [ev] = resolveTrick(s);
    expect(ev).toMatchObject({ type: 'trickResolved', trick: { winner: 3, points: 8, leader: 0 } });
    expect(s.turn).toBe(3);
    expect(s.currentTrick.leader).toBe(3);
    expect(s.tricksWon).toEqual([0, 1]);
    expect(s.cardPoints).toEqual([0, 8]);
    expect(s.phase).toBe('playing');
  });

  it('turn order goes to the next seat', () => {
    const s = riggedPlaying({ hands, trump: 'diamonds' });
    act(s, 0, { type: 'playCard', cardId: 'spades-7' });
    expect(s.turn).toBe(1);
    act(s, 1, { type: 'playCard', cardId: 'hearts-7' });
    expect(s.turn).toBe(2);
  });

  it('plays a full round of 8 tricks with 28 total card points', () => {
    const s = riggedPlaying({ hands, trump: 'diamonds', rules: OPEN_TRUMP_RULES });
    for (let t = 0; t < 8; t++) {
      for (let i = 0; i < 4; i++) {
        const seat = s.turn!;
        act(s, seat, { type: 'playCard', cardId: getLegalCards(s, seat)[0].id });
      }
      resolveTrick(s);
    }
    expect(s.cardPoints[0] + s.cardPoints[1]).toBe(28);
    expect(s.tricksWon[0] + s.tricksWon[1]).toBe(8);
    expect(['roundEnd', 'matchEnd']).toContain(s.phase);
  });
});
