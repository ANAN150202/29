import { describe, expect, it } from 'vitest';
import { CLASSIC_RULES } from '../server/src/config/rulesConfig';
import { applyAction, closeDeclarationWindow, getLegalCards, resolveTrick } from '../server/src/game/engine';
import { buildPlayerView } from '../server/src/game/playerView';
import { singleHandCanLose } from '../server/src/game/rules';
import type { GameState } from '../server/src/game/state';
import { act, cards, newMatch } from './helpers';

/** Dealer 3, seat 0 wins the bid at 16 (hearts trump); no doubles; then fixed 8-card hands. */
function toSingleWindow(hands: [string, string, string, string]): GameState {
  const { state } = newMatch(CLASSIC_RULES, { dealer: 3 });
  act(state, 0, { type: 'bid', amount: 16 });
  act(state, 1, { type: 'pass' });
  act(state, 2, { type: 'pass' });
  act(state, 3, { type: 'pass' });
  act(state, 0, { type: 'chooseTrump', suit: 'hearts', reverse: false });
  closeDeclarationWindow(state); // no doubles
  expect(state.phase).toBe('singleHand');
  state.hands = hands.map(cards) as GameState['hands'];
  return state;
}

// Seat 1 holds top spades & hearts (but a weak 8♣ and 7♦ that could be caught).
const STRONG: [string, string, string, string] = [
  '7S 8S QS 9C AC KC QD 8D',
  'JS 9S AS 10S JH 9H 8C 7D',
  'KS AH 10H KH QH 8H 7H JC',
  '10C 7C JD 9D AD 10D KD QC',
];

function playOut(s: GameState) {
  while (s.phase === 'playing' || s.phase === 'trickResolution') {
    if (s.phase === 'trickResolution') {
      resolveTrick(s);
      continue;
    }
    const seat = s.turn!;
    act(s, seat, { type: 'playCard', cardId: getLegalCards(s, seat)[0].id });
  }
}

describe('Single Hand — conceivably lose rule', () => {
  it('blocks invincible hands', () => {
    expect(singleHandCanLose(cards('JS 9S AS 10S KS QS 8S 7S'))).toBe(false);
    expect(singleHandCanLose(cards('JS 9S AS 10S JH 9H AH 10H'))).toBe(false); // top 4 of two suits
    expect(singleHandCanLose(cards('JS 9S AS 10S KS QS 7S JH'))).toBe(false); // lone missing 8♠ falls under the J
  });
  it('allows hands with at least one card that could be caught', () => {
    expect(singleHandCanLose(cards('JS 9S AS 10S JH 9H AH 7H'))).toBe(true); // 10♥ could catch the 7♥
    expect(singleHandCanLose(cards(STRONG[1]))).toBe(true);
  });
});

describe('Single Hand', () => {
  it('every player may answer; skipping closes the window and normal play starts', () => {
    const s = toSingleWindow(STRONG);
    expect(s.single.pending.sort()).toEqual([0, 1, 2, 3]);
    for (const seat of [0, 1, 2] as const) act(s, seat, { type: 'skipSingle' });
    expect(s.phase).toBe('singleHand');
    act(s, 3, { type: 'skipSingle' });
    expect(s.phase).toBe('playing');
    expect(s.turn).toBe(0);
  });

  it('an invincible hand may not declare', () => {
    const s = toSingleWindow(['JS 9S AS 10S KS QS 8S 7S', 'JH 9H AH 10H KH QH 8H 7H', 'JC 9C AC 10C KC QC 8C 7C', 'JD 9D AD 10D KD QD 8D 7D']);
    expect(buildPlayerView(s, 0).single).toMatchObject({ canDeclare: false });
    expect(buildPlayerView(s, 0).single.blockedReason).toMatch(/cannot lose/);
    expect(applyAction(s, 0, { type: 'declareSingle' })).toMatchObject({ ok: false, error: { code: 'CANNOT_DECLARE_SINGLE' } });
  });

  it('declarer leads, partner sits out, no trump, three cards per trick', () => {
    const s = toSingleWindow(STRONG);
    act(s, 1, { type: 'declareSingle' });
    expect(s.single.declarer).toBe(1);
    expect(s.phase).toBe('playing');
    expect(s.turn).toBe(1);
    act(s, 1, { type: 'playCard', cardId: 'spades-J' });
    expect(s.turn).toBe(2);
    act(s, 2, { type: 'playCard', cardId: 'spades-K' });
    // Seat 3 (partner) is skipped.
    expect(s.turn).toBe(0);
    act(s, 0, { type: 'playCard', cardId: 'spades-Q' });
    expect(s.phase).toBe('trickResolution');
    resolveTrick(s);
    expect(s.completedTricks[0]).toMatchObject({ winner: 1, trumpActive: false });
    expect(s.turn).toBe(1);
    // Trump/pair options are off in a Single Hand.
    expect(buildPlayerView(s, 2).canRevealTrump).toBe(false);
  });

  it('losing one trick ends the round at once with −3', () => {
    const s = toSingleWindow(STRONG);
    act(s, 1, { type: 'declareSingle' });
    // Lead the 8♣: seat 2 plays the J♣ and catches it.
    act(s, 1, { type: 'playCard', cardId: 'clubs-8' });
    act(s, 2, { type: 'playCard', cardId: 'clubs-J' });
    act(s, 0, { type: 'playCard', cardId: 'clubs-9' });
    resolveTrick(s);
    expect(s.phase).toBe('roundEnd');
    expect(s.roundResult).toMatchObject({
      kind: 'single',
      single: { seat: 1, success: false, tricksWon: 0 },
      gamePointsDelta: [0, -3],
    });
    expect(s.matchScore).toEqual([0, -3]);
  });

  it('winning all eight tricks scores +3 and ignores the contract and any doubles', () => {
    // Seat 1 holds every top card it needs except one weak suit no one can follow.
    const s = toSingleWindow([
      '8S 7S QH 8H 7H QC 8C 7C',
      'JS 9S AS 10S KS QS JH 7D',
      'JC 9C AC 10C KC 9H AH 10H',
      'JD 9D AD 10D KD QD 8D KH',
    ]);
    s.contract!.multiplier = 6; // even a "set" contract is replaced
    act(s, 1, { type: 'declareSingle' });
    playOut(s);
    expect(s.roundResult).toMatchObject({ kind: 'single', single: { seat: 1, success: true, tricksWon: 8 }, gamePointsDelta: [0, 3] });
  });
});
