import { describe, expect, it } from 'vitest';
import type { Seat } from '@shared/types';
import { CLASSIC_RULES, FULL_REVERSE_RULES, OPEN_TRUMP_RULES } from '../server/src/config/rulesConfig';
import { chooseBotAction, estimateHand } from '../server/src/game/bot';
import { seededRandomInt } from '../server/src/game/deck';
import { applyAction, createGame, resolveTrick, startMatch } from '../server/src/game/engine';
import { buildPlayerView } from '../server/src/game/playerView';
import { act, cards, riggedPlaying } from './helpers';

/** Play an entire match with four bots; every action must be legal. */
function botMatch(rules = CLASSIC_RULES, seed = 1) {
  const state = createGame({ rules, reverseTrumpAllowed: true });
  const rng = seededRandomInt(seed);
  startMatch(state, rng, 0);
  let actions = 0;
  while (state.phase !== 'matchEnd' && actions < 50_000) {
    if (state.phase === 'trickResolution') {
      resolveTrick(state);
      continue;
    }
    if (state.phase === 'roundEnd') {
      act(state, 0, { type: 'nextRound' });
      continue;
    }
    const seat = state.turn as Seat;
    const action = chooseBotAction(buildPlayerView(state, seat), rules.reverseTrumpScope);
    expect(action, `bot at seat ${seat} had no action in ${state.phase}`).not.toBeNull();
    const res = applyAction(state, seat, action!, rng);
    expect(res, JSON.stringify(action)).toMatchObject({ ok: true });
    actions++;
  }
  return state;
}

describe('computer players', () => {
  it.each([1, 2, 3, 4, 5])('four bots finish a classic match legally (seed %i)', (seed) => {
    const s = botMatch(CLASSIC_RULES, seed);
    expect(s.phase).toBe('matchEnd');
    expect(s.matchWinner).not.toBeNull();
  });

  it('bots also handle open bidding, open trump and full-reverse rules', () => {
    expect(botMatch({ ...CLASSIC_RULES, biddingStyle: 'open' }, 9).phase).toBe('matchEnd');
    expect(botMatch(OPEN_TRUMP_RULES, 10).phase).toBe('matchEnd');
    expect(botMatch(FULL_REVERSE_RULES, 11).phase).toBe('matchEnd');
  });

  it('values strong hands above weak ones', () => {
    expect(estimateHand(cards('JH 9H AH JS'))).toBeGreaterThan(22);
    expect(estimateHand(cards('7H 8S QC KD'))).toBeLessThan(16);
  });

  it('bids with a strong hand and passes with a weak one', () => {
    const s = createGame({ rules: CLASSIC_RULES, reverseTrumpAllowed: true });
    startMatch(s, seededRandomInt(3), 3);
    s.hands[0] = cards('JH 9H AH JS');
    expect(chooseBotAction(buildPlayerView(s, 0))).toEqual({ type: 'bid', amount: 16 });
    s.hands[0] = cards('7H 8S QC KD');
    expect(chooseBotAction(buildPlayerView(s, 0))).toEqual({ type: 'pass' });
  });

  it('picks its longest, strongest suit as trump', () => {
    const s = createGame({ rules: CLASSIC_RULES, reverseTrumpAllowed: false });
    startMatch(s, seededRandomInt(3), 3);
    s.hands[0] = cards('JH 9H AH 7S');
    act(s, 0, { type: 'bid', amount: 20 });
    act(s, 1, { type: 'pass' });
    act(s, 2, { type: 'pass' });
    act(s, 3, { type: 'pass' });
    expect(chooseBotAction(buildPlayerView(s, 0))).toEqual({ type: 'chooseTrump', suit: 'hearts', reverse: false });
  });

  it('wins a trick as cheaply as possible and feeds points to a winning partner', () => {
    const s = riggedPlaying({
      hands: ['9S 8C 7C QC KC 10C AC JC', 'JS 7S 7D 8D QD KD 10D AD', '10S KS 8S 7H 8H QH KH 10H', 'AS QS 9C 9D JD 9H JH AH'],
      trump: 'hearts',
    });
    act(s, 0, { type: 'playCard', cardId: 'spades-9' });
    // Seat 1 can beat the 9 only with the J.
    expect(chooseBotAction(buildPlayerView(s, 1))).toEqual({ type: 'playCard', cardId: 'spades-J' });
    act(s, 1, { type: 'playCard', cardId: 'spades-J' });
    act(s, 2, { type: 'playCard', cardId: 'spades-8' });
    // Seat 3's partner (seat 1) is winning with the J and seat 3 is last: feed it the Ace (1 point), not the Queen.
    expect(chooseBotAction(buildPlayerView(s, 3))).toEqual({ type: 'playCard', cardId: 'spades-A' });
  });

  it('decides only from its own sanitized view (no hidden trump knowledge)', () => {
    const s = riggedPlaying({
      hands: ['9S 8C 7C QC KC 10C AC JC', 'JS 7S 7D 8D QD KD 10D AD', '10S AS 8S 7H 8H QH KH 10H', 'KS QS 9C 9D JD 9H JH AH'],
      trump: 'hearts',
      rules: CLASSIC_RULES,
      bidder: 0,
    });
    const view = buildPlayerView(s, 2);
    expect(view.trump.suit).toBeNull();
    expect(JSON.stringify(view)).not.toContain('clubs-J'); // seat 0's cards are invisible
  });
});
