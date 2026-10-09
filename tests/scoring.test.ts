import { describe, expect, it } from 'vitest';
import type { Contract, Seat, TrickRecord } from '@shared/types';
import { CLASSIC_RULES } from '../server/src/config/rulesConfig';
import { applyAction, canDeclarePair, getLegalCards, resolveTrick } from '../server/src/game/engine';
import { applyGamePoints, countTeamCardPoints, countTeamTricks, detectMatchWinner, evaluateContract } from '../server/src/game/scoring';
import { act, c, newMatch, riggedPlaying, settle } from './helpers';

const trick = (winner: Seat, codes: string[]): TrickRecord => ({
  index: 0,
  leader: 0,
  winner,
  points: 0,
  trumpActive: true,
  cards: codes.map((code, i) => ({ seat: i as Seat, card: c(code) })),
});

describe('card points', () => {
  it('counts points per partnership', () => {
    const tricks = [trick(0, ['JS', '9S', 'AS', '10S']), trick(2, ['7S', '8S', 'KS', 'QS']), trick(3, ['JH', '9H', '7C', '8C'])];
    expect(countTeamCardPoints(tricks)).toEqual([7, 5]);
    expect(countTeamTricks(tricks)).toEqual([2, 1]);
  });
});

describe('contract evaluation', () => {
  const contract: Contract = { bidder: 1, team: 1, bid: 18, target: 18 };
  it('success when bidder team reaches the target', () => {
    expect(evaluateContract(contract, [10, 18], CLASSIC_RULES)).toEqual({ success: true, bidderTeamPoints: 18, gamePointsDelta: [0, 1] });
  });
  it('failure when short of the target', () => {
    expect(evaluateContract(contract, [11, 17], CLASSIC_RULES)).toEqual({ success: false, bidderTeamPoints: 17, gamePointsDelta: [0, -1] });
  });
  it('uses the (pair-adjusted) target, not the raw bid', () => {
    expect(evaluateContract({ ...contract, target: 22 }, [8, 20], CLASSIC_RULES).success).toBe(false);
  });
});

describe('match score', () => {
  it('applies deltas and detects winners at +6 or −6', () => {
    expect(applyGamePoints([5, 0], [1, 0])).toEqual([6, 0]);
    expect(detectMatchWinner([6, 0], CLASSIC_RULES)).toBe(0);
    expect(detectMatchWinner([2, 6], CLASSIC_RULES)).toBe(1);
    expect(detectMatchWinner([-6, 3], CLASSIC_RULES)).toBe(1);
    expect(detectMatchWinner([5, -5], CLASSIC_RULES)).toBeNull();
  });

  it('a full match ends in matchEnd and rematch resets the score', () => {
    const { state } = newMatch(CLASSIC_RULES, { seed: 3 });
    let rounds = 0;
    while (state.phase !== 'matchEnd' && rounds < 200) {
      if (state.phase === 'bidding') {
        // first bidder bids 16, everyone else passes
        const seat = state.turn!;
        const res = state.bidding.highestBid === null
          ? applyAction(state, seat, { type: 'bid', amount: 16 })
          : applyAction(state, seat, { type: 'pass' });
        expect(res.ok).toBe(true);
      } else if (state.phase === 'trumpSelection') {
        act(state, state.turn!, { type: 'chooseTrump', suit: 'spades', reverse: rounds % 2 === 1 });
      } else if (state.phase === 'playing') {
        const seat = state.turn!;
        if (getLegalCards(state, seat).length && state.trumpSuit && !state.trumpRevealed && state.currentTrick.cards.length) {
          applyAction(state, seat, { type: 'revealTrump' }); // allowed only when void; ignore failures
        }
        act(state, seat, { type: 'playCard', cardId: getLegalCards(state, seat)[0].id });
      } else if (state.phase === 'doubling' || state.phase === 'singleHand') {
        settle(state);
      } else if (state.phase === 'trickResolution') {
        resolveTrick(state);
      } else if (state.phase === 'roundEnd') {
        rounds++;
        expect(state.roundResult!.cardPoints[0] + state.roundResult!.cardPoints[1]).toBe(28);
        act(state, 0, { type: 'nextRound' });
      }
    }
    expect(state.phase).toBe('matchEnd');
    expect(state.matchWinner).not.toBeNull();
    expect(Math.max(...state.matchScore.map(Math.abs))).toBe(6);
    act(state, 2, { type: 'rematch' });
    expect(state.matchScore).toEqual([0, 0]);
    expect(state.phase).toBe('bidding');
    expect(state.round).toBe(1);
  });
});

describe('pair (K+Q of trump)', () => {
  const hands: [string, string, string, string] = [
    'KH QH AS 10S KS QS 8S 7S',
    'JS 9S AH 10H JH 9H 8H 7H',
    'JC 9C AC 10C KC QC 8C 7C',
    'JD 9D AD 10D KD QD 8D 7D',
  ];

  it('requires revealed trump, K+Q in hand and a trick won by the team; lowers bidder target by 4', () => {
    const s = riggedPlaying({ hands, trump: 'hearts', rules: CLASSIC_RULES, bid: 20, revealed: true });
    expect(canDeclarePair(s, 0)).toBe(false); // no trick won yet
    act(s, 0, { type: 'playCard', cardId: 'spades-7' });
    act(s, 1, { type: 'playCard', cardId: 'spades-J' });
    act(s, 2, { type: 'playCard', cardId: 'clubs-7' });
    act(s, 3, { type: 'playCard', cardId: 'diamonds-7' });
    resolveTrick(s); // seat 1 wins (team 1)
    expect(canDeclarePair(s, 0)).toBe(false);
    expect(applyAction(s, 0, { type: 'declarePair' })).toMatchObject({ ok: false, error: { code: 'CANNOT_DECLARE_PAIR' } });
    // seat 1 leads hearts; seat 0 has no... seat 0 has KH QH so must follow with hearts.
    act(s, 1, { type: 'playCard', cardId: 'hearts-7' });
    act(s, 2, { type: 'playCard', cardId: 'clubs-8' });
    act(s, 3, { type: 'playCard', cardId: 'diamonds-8' });
    act(s, 0, { type: 'playCard', cardId: 'hearts-K' });
    resolveTrick(s); // K beats 7 → seat 0 wins, but K is gone now
    expect(canDeclarePair(s, 0)).toBe(false);
  });

  it('defenders declaring raises the target by 4 (capped at 28); bidders lower it (floor 16)', () => {
    const s = riggedPlaying({ hands, trump: 'hearts', rules: CLASSIC_RULES, bid: 18, bidder: 1, revealed: true });
    act(s, 0, { type: 'playCard', cardId: 'spades-A' });
    act(s, 1, { type: 'playCard', cardId: 'spades-9' });
    act(s, 2, { type: 'playCard', cardId: 'clubs-7' });
    act(s, 3, { type: 'playCard', cardId: 'diamonds-7' });
    resolveTrick(s); // 9S beats AS → seat 1. need team 0 trick
    act(s, 1, { type: 'playCard', cardId: 'spades-J' });
    act(s, 2, { type: 'playCard', cardId: 'clubs-8' });
    act(s, 3, { type: 'playCard', cardId: 'diamonds-8' });
    act(s, 0, { type: 'playCard', cardId: 'spades-7' });
    resolveTrick(s); // seat 1 again
    s.completedTricks.push({ index: 2, leader: 2, winner: 2, points: 0, trumpActive: true, cards: [] });
    expect(canDeclarePair(s, 0)).toBe(true);
    act(s, 0, { type: 'declarePair' });
    expect(s.contract!.target).toBe(22);
    expect(s.pair).toEqual({ seat: 0, team: 0, adjustment: 4 });
    expect(applyAction(s, 0, { type: 'declarePair' })).toMatchObject({ ok: false });

    const t = riggedPlaying({ hands, trump: 'hearts', rules: CLASSIC_RULES, bid: 18, bidder: 2, revealed: true });
    t.completedTricks.push({ index: 0, leader: 2, winner: 2, points: 0, trumpActive: true, cards: [] });
    act(t, 0, { type: 'declarePair' });
    expect(t.contract!.target).toBe(16);
    expect(t.pair!.adjustment).toBe(-2);
  });
});
