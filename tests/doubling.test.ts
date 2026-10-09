import { describe, expect, it } from 'vitest';
import { CLASSIC_RULES } from '../server/src/config/rulesConfig';
import { applyAction, closeDeclarationWindow, resolveTrick } from '../server/src/game/engine';
import { buildPlayerView } from '../server/src/game/playerView';
import { evaluateContract } from '../server/src/game/scoring';
import { act, newMatch } from './helpers';

/** Dealer 3 → seat 0 bids 18 and picks trump. Opponents are seats 1 and 3. */
function toDoubling() {
  const { state } = newMatch(CLASSIC_RULES, { dealer: 3 });
  act(state, 0, { type: 'bid', amount: 18 });
  act(state, 1, { type: 'pass' });
  act(state, 2, { type: 'pass' });
  act(state, 3, { type: 'pass' });
  act(state, 0, { type: 'chooseTrump', suit: 'hearts', reverse: false });
  return state;
}

describe('Double / Redouble / Set', () => {
  it('opens after trump is chosen, before the last four cards are dealt', () => {
    const s = toDoubling();
    expect(s.phase).toBe('doubling');
    expect(s.doubling.stage).toBe('double');
    expect(s.doubling.pending.sort()).toEqual([1, 3]);
    expect(s.hands.map((h) => h.length)).toEqual([4, 4, 4, 4]);
    // Opponents still don't know the hidden trump.
    expect(buildPlayerView(s, 1).trump.suit).toBeNull();
    expect(buildPlayerView(s, 1).doubling).toMatchObject({ stage: 'double', canCall: true });
    expect(buildPlayerView(s, 2).doubling.canCall).toBe(false);
  });

  it("only the opponents may double; the bidder's team may not", () => {
    const s = toDoubling();
    expect(applyAction(s, 0, { type: 'double', stage: 'double' })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    expect(applyAction(s, 2, { type: 'double', stage: 'double' })).toMatchObject({ ok: false });
  });

  it('double → redouble → set escalates the multiplier 2 → 4 → 6, then deals the rest', () => {
    const s = toDoubling();
    act(s, 3, { type: 'double', stage: 'double' });
    expect(s.contract).toMatchObject({ doubleLevel: 1, multiplier: 2 });
    expect(s.doubling.stage).toBe('redouble');
    expect(s.doubling.pending.sort()).toEqual([0, 2]);
    // Opponents cannot redouble their own double.
    expect(applyAction(s, 1, { type: 'double', stage: 'redouble' })).toMatchObject({ ok: false });
    act(s, 2, { type: 'double', stage: 'redouble' });
    expect(s.contract).toMatchObject({ doubleLevel: 2, multiplier: 4 });
    expect(s.doubling.stage).toBe('set');
    expect(s.doubling.pending.sort()).toEqual([1, 3]);
    act(s, 1, { type: 'double', stage: 'set' });
    expect(s.contract).toMatchObject({ doubleLevel: 3, multiplier: 6 });
    expect(s.phase).toBe('singleHand');
    expect(s.hands.map((h) => h.length)).toEqual([8, 8, 8, 8]);
    expect(s.doubling.calls.map((c) => c.call)).toEqual(['double', 'redouble', 'set']);
  });

  it('a stale call for a stage that is no longer open is rejected', () => {
    const s = toDoubling();
    act(s, 1, { type: 'double', stage: 'double' });
    act(s, 0, { type: 'double', stage: 'redouble' });
    // Seat 3 clicked "double" late — must not be treated as "set".
    expect(applyAction(s, 3, { type: 'double', stage: 'double' })).toMatchObject({ ok: false, error: { code: 'STALE_ACTION' } });
    expect(s.contract!.multiplier).toBe(4);
  });

  it('both opponents declining keeps normal points', () => {
    const s = toDoubling();
    act(s, 1, { type: 'declineDouble' });
    expect(s.phase).toBe('doubling');
    act(s, 3, { type: 'declineDouble' });
    expect(s.phase).toBe('singleHand');
    expect(s.contract!.multiplier).toBe(1);
  });

  it('declining a redouble ends the window without escalating', () => {
    const s = toDoubling();
    act(s, 1, { type: 'double', stage: 'double' });
    act(s, 0, { type: 'declineDouble' });
    act(s, 2, { type: 'declineDouble' });
    expect(s.phase).toBe('singleHand');
    expect(s.contract!.multiplier).toBe(2);
  });

  it('the window closes on timeout as if everyone declined', () => {
    const s = toDoubling();
    expect(closeDeclarationWindow(s)).toBe(true);
    expect(s.phase).toBe('singleHand');
    expect(closeDeclarationWindow(s)).toBe(true);
    expect(s.phase).toBe('playing');
  });

  it('scores ±1 normal, ±2 doubled, ±4 redoubled, ±6 set', () => {
    const base = { bidder: 0 as const, team: 0 as const, bid: 18, target: 18 };
    for (const [m, label] of [[1, 'normal'], [2, 'double'], [4, 'redouble'], [6, 'set']] as const) {
      expect(evaluateContract({ ...base, multiplier: m }, [20, 8], CLASSIC_RULES).gamePointsDelta, label).toEqual([m, 0]);
      expect(evaluateContract({ ...base, multiplier: m }, [10, 18], CLASSIC_RULES).gamePointsDelta, label).toEqual([-m, 0]);
    }
  });

  it('a failed Set contract (−6) ends the match immediately', () => {
    const s = toDoubling();
    act(s, 1, { type: 'double', stage: 'double' });
    act(s, 0, { type: 'double', stage: 'redouble' });
    act(s, 3, { type: 'double', stage: 'set' });
    closeDeclarationWindow(s); // nobody declares single
    // Force a loss: give every trick to the opponents.
    while (s.phase !== 'matchEnd' && s.phase !== 'roundEnd') {
      if (s.phase === 'trickResolution') {
        s.currentTrick.cards.forEach((pc) => (pc.seat = 1)); // opponents win every trick
        resolveTrick(s);
        continue;
      }
      act(s, s.turn!, { type: 'playCard', cardId: buildPlayerView(s, s.turn!).legalCardIds[0] });
    }
    expect(s.roundResult).toMatchObject({ kind: 'contract', multiplier: 6, success: false, gamePointsDelta: [-6, 0] });
    expect(s.phase).toBe('matchEnd');
    expect(s.matchWinner).toBe(1);
  });
});
