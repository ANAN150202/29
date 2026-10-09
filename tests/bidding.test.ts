import { describe, expect, it } from 'vitest';
import { CLASSIC_RULES } from '../server/src/config/rulesConfig';
import { applyAction, mustBid } from '../server/src/game/engine';
import { act, newMatch } from './helpers';

describe('bidding', () => {
  it('starts with the player after the dealer', () => {
    const { state } = newMatch(CLASSIC_RULES, { dealer: 3 });
    expect(state.phase).toBe('bidding');
    expect(state.turn).toBe(0);
  });

  it('rejects bids below the minimum, above the maximum, non-integers and non-raises', () => {
    const { state } = newMatch();
    expect(applyAction(state, 0, { type: 'bid', amount: 15 })).toMatchObject({ ok: false, error: { code: 'ILLEGAL_BID' } });
    expect(applyAction(state, 0, { type: 'bid', amount: 29 })).toMatchObject({ ok: false, error: { code: 'ILLEGAL_BID' } });
    expect(applyAction(state, 0, { type: 'bid', amount: 16.5 })).toMatchObject({ ok: false, error: { code: 'ILLEGAL_BID' } });
    act(state, 0, { type: 'bid', amount: 18 });
    expect(applyAction(state, 1, { type: 'bid', amount: 18 })).toMatchObject({ ok: false, error: { code: 'ILLEGAL_BID' } });
    act(state, 1, { type: 'bid', amount: 19 });
    expect(state.bidding.highestBid).toBe(19);
    expect(state.bidding.highestBidder).toBe(1);
  });

  it('rejects bidding out of turn', () => {
    const { state } = newMatch();
    expect(applyAction(state, 2, { type: 'bid', amount: 16 })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    expect(applyAction(state, 2, { type: 'pass' })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
  });

  it('ends when three players have passed and stores the contract', () => {
    const { state } = newMatch();
    act(state, 0, { type: 'bid', amount: 16 });
    act(state, 1, { type: 'bid', amount: 17 });
    act(state, 2, { type: 'pass' });
    act(state, 3, { type: 'pass' });
    expect(state.turn).toBe(0); // passed players are skipped
    act(state, 0, { type: 'bid', amount: 20 });
    expect(state.turn).toBe(1);
    act(state, 1, { type: 'pass' });
    expect(state.phase).toBe('trumpSelection');
    expect(state.contract).toEqual({ bidder: 0, team: 0, bid: 20, target: 20 });
    expect(state.turn).toBe(0);
    expect(state.bidding.history).toHaveLength(6);
  });

  it('a bid of the maximum ends bidding immediately', () => {
    const { state } = newMatch();
    act(state, 0, { type: 'bid', amount: 28 });
    expect(state.phase).toBe('trumpSelection');
    expect(state.contract?.bidder).toBe(0);
  });

  it('a passed player cannot bid again', () => {
    const { state } = newMatch();
    act(state, 0, { type: 'pass' });
    act(state, 1, { type: 'bid', amount: 16 });
    act(state, 2, { type: 'pass' });
    act(state, 3, { type: 'bid', amount: 17 });
    // seat 0 passed → seat 1 is next
    expect(state.turn).toBe(1);
    expect(applyAction(state, 0, { type: 'bid', amount: 18 })).toMatchObject({ ok: false });
  });

  it('default rule: all four passing redeals with the next dealer', () => {
    const { state } = newMatch(CLASSIC_RULES, { dealer: 3 });
    for (const s of [0, 1, 2, 3] as const) act(state, s, { type: 'pass' });
    expect(state.phase).toBe('bidding');
    expect(state.dealer).toBe(0);
    expect(state.round).toBe(2);
    expect(state.turn).toBe(1);
    expect(state.hands.every((h) => h.length === 4)).toBe(true);
  });

  it('dealerForced variant: dealer may not pass after three passes', () => {
    const { state } = newMatch({ ...CLASSIC_RULES, allPassAction: 'dealerForced' }, { dealer: 3 });
    for (const s of [0, 1, 2] as const) act(state, s, { type: 'pass' });
    expect(mustBid(state, 3)).toBe(true);
    expect(applyAction(state, 3, { type: 'pass' })).toMatchObject({ ok: false, error: { code: 'CANNOT_PASS' } });
    act(state, 3, { type: 'bid', amount: 16 });
    expect(state.phase).toBe('trumpSelection');
    expect(state.contract?.bidder).toBe(3);
  });

  it('rejects actions that do not belong to the phase', () => {
    const { state } = newMatch();
    expect(applyAction(state, 0, { type: 'playCard', cardId: state.hands[0][0].id })).toMatchObject({
      ok: false,
      error: { code: 'WRONG_PHASE' },
    });
    expect(applyAction(state, 0, { type: 'chooseTrump', suit: 'hearts', reverse: false })).toMatchObject({
      ok: false,
      error: { code: 'WRONG_PHASE' },
    });
  });
});
