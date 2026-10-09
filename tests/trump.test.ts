import { describe, expect, it } from 'vitest';
import { CLASSIC_RULES, OPEN_TRUMP_RULES } from '../server/src/config/rulesConfig';
import { applyAction, canRevealTrump, getLegalCards, resolveTrick } from '../server/src/game/engine';
import { buildPlayerView } from '../server/src/game/playerView';
import { act, newMatch, riggedPlaying, settle } from './helpers';

function toTrumpSelection(rules = CLASSIC_RULES, reverse = true) {
  const m = newMatch(rules, { reverse });
  act(m.state, 0, { type: 'bid', amount: 17 });
  act(m.state, 1, { type: 'pass' });
  act(m.state, 2, { type: 'pass' });
  act(m.state, 3, { type: 'pass' });
  return m.state;
}

describe('trump selection', () => {
  it('only the bidder may choose trump', () => {
    const state = toTrumpSelection();
    expect(applyAction(state, 1, { type: 'chooseTrump', suit: 'spades', reverse: false })).toMatchObject({
      ok: false,
      error: { code: 'NOT_YOUR_TURN' },
    });
    act(state, 0, { type: 'chooseTrump', suit: 'spades', reverse: true });
    settle(state);
    expect(state.trumpSuit).toBe('spades');
    expect(state.reverseTrump).toBe(true);
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe(0);
  });

  it('rejects Reverse Trump when the room disabled it', () => {
    const state = toTrumpSelection(CLASSIC_RULES, false);
    expect(applyAction(state, 0, { type: 'chooseTrump', suit: 'spades', reverse: true })).toMatchObject({
      ok: false,
      error: { code: 'REVERSE_TRUMP_DISABLED' },
    });
  });

  it('classic: concealed trump is visible to the bidder only', () => {
    const state = toTrumpSelection();
    act(state, 0, { type: 'chooseTrump', suit: 'hearts', reverse: false });
    settle(state);
    expect(state.trumpRevealed).toBe(false);
    expect(buildPlayerView(state, 0).trump).toMatchObject({ suit: 'hearts', reverse: false, hiddenFromMe: false });
    for (const s of [1, 2, 3] as const) {
      expect(buildPlayerView(state, s).trump).toMatchObject({ suit: null, reverse: null, hiddenFromMe: true });
    }
    expect(buildPlayerView(state, null).trump.suit).toBeNull();
    expect(JSON.stringify(buildPlayerView(state, 1).log)).not.toMatch(/hearts/i);
  });

  it('open trump: trump is public immediately', () => {
    const state = toTrumpSelection(OPEN_TRUMP_RULES);
    act(state, 0, { type: 'chooseTrump', suit: 'clubs', reverse: true });
    settle(state);
    expect(buildPlayerView(state, 2).trump).toMatchObject({ suit: 'clubs', reverse: true, revealed: true });
  });

  it('trump state stores suit and reverse flag separately', () => {
    const state = toTrumpSelection();
    act(state, 0, { type: 'chooseTrump', suit: 'diamonds', reverse: true });
    settle(state);
    expect(state.trumpSuit).toBe('diamonds');
    expect(state.reverseTrump).toBe(true);
  });
});

describe('concealed trump reveal', () => {
  const hands: [string, string, string, string] = [
    'JS 9S AS 10S KS QS 8S 7S',
    '7H 8H JC 9C AC 10C KC QC',
    'JH 9H AH 10H KH QH 8C 7C',
    'JD 9D AD 10D KD QD 8D 7D',
  ];

  it('a trump-suit card has no power until trump is revealed', () => {
    const state = riggedPlaying({ hands, trump: 'hearts', rules: CLASSIC_RULES });
    act(state, 0, { type: 'playCard', cardId: 'spades-7' });
    // seat 1 has no spades but does not call for trump; plays a heart
    act(state, 1, { type: 'playCard', cardId: 'hearts-8' });
    act(state, 2, { type: 'playCard', cardId: 'hearts-J' });
    act(state, 3, { type: 'playCard', cardId: 'diamonds-7' });
    const [ev] = resolveTrick(state);
    expect(ev).toMatchObject({ type: 'trickResolved', trick: { winner: 0, trumpActive: false } });
  });

  it('only a player unable to follow suit may reveal, then must play trump', () => {
    const state = riggedPlaying({ hands, trump: 'hearts', rules: CLASSIC_RULES });
    expect(canRevealTrump(state, 0)).toBe(false); // leading
    act(state, 0, { type: 'playCard', cardId: 'spades-7' });
    expect(canRevealTrump(state, 1)).toBe(true);
    act(state, 1, { type: 'revealTrump' });
    expect(state.trumpRevealed).toBe(true);
    expect(getLegalCards(state, 1).map((c) => c.id).sort()).toEqual(['hearts-7', 'hearts-8']);
    expect(applyAction(state, 1, { type: 'playCard', cardId: 'clubs-J' })).toMatchObject({
      ok: false,
      error: { code: 'ILLEGAL_CARD' },
    });
    act(state, 1, { type: 'playCard', cardId: 'hearts-7' });
    act(state, 2, { type: 'playCard', cardId: 'clubs-7' });
    act(state, 3, { type: 'playCard', cardId: 'diamonds-7' });
    const [ev] = resolveTrick(state);
    expect(ev).toMatchObject({ trick: { winner: 1, trumpActive: true } });
    expect(buildPlayerView(state, 3).trump).toMatchObject({ suit: 'hearts', revealed: true });
  });

  it('a revealer holding no trump may play any card and is not told to play trump', () => {
    const state = riggedPlaying({
      hands: ['JS 9S AS 10S KS QS 8S 7S', 'JC 9C AC 10C KC QC 8C 7C', hands[2], hands[3]],
      trump: 'hearts',
      rules: CLASSIC_RULES,
    });
    act(state, 0, { type: 'playCard', cardId: 'spades-7' });
    act(state, 1, { type: 'revealTrump' });
    expect(getLegalCards(state, 1)).toHaveLength(8);
    expect(buildPlayerView(state, 1).mustPlayTrump).toBe(false);
  });

  it('cannot reveal while holding the lead suit', () => {
    const state = riggedPlaying({ hands, trump: 'hearts', rules: CLASSIC_RULES });
    act(state, 0, { type: 'playCard', cardId: 'spades-7' });
    act(state, 1, { type: 'playCard', cardId: 'clubs-Q' });
    state.hands[2].push({ id: 'spades-x', suit: 'spades', rank: '7' } as never);
    expect(applyAction(state, 2, { type: 'revealTrump' })).toMatchObject({ ok: false, error: { code: 'CANNOT_REVEAL' } });
  });
});
