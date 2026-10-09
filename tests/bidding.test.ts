import { describe, expect, it } from 'vitest';
import { CLASSIC_RULES } from '../server/src/config/rulesConfig';
import { applyAction, getAutoAction, mustBid } from '../server/src/game/engine';
import { buildPlayerView } from '../server/src/game/playerView';
import { act, newMatch } from './helpers';

/** The original "everyone raises in turn" auction, still available as a room option. */
const OPEN = { ...CLASSIC_RULES, biddingStyle: 'open' as const };

describe('open bidding', () => {
  it('starts with the player after the dealer', () => {
    const { state } = newMatch(OPEN, { dealer: 3 });
    expect(state.phase).toBe('bidding');
    expect(state.turn).toBe(0);
  });

  it('rejects bids below the minimum, above the maximum, non-integers and non-raises', () => {
    const { state } = newMatch(OPEN);
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
    const { state } = newMatch(OPEN);
    expect(applyAction(state, 2, { type: 'bid', amount: 16 })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    expect(applyAction(state, 2, { type: 'pass' })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
  });

  it('ends when three players have passed and stores the contract', () => {
    const { state } = newMatch(OPEN);
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
    const { state } = newMatch(OPEN);
    act(state, 0, { type: 'bid', amount: 28 });
    expect(state.phase).toBe('trumpSelection');
    expect(state.contract?.bidder).toBe(0);
  });

  it('a passed player cannot bid again', () => {
    const { state } = newMatch(OPEN);
    act(state, 0, { type: 'pass' });
    act(state, 1, { type: 'bid', amount: 16 });
    act(state, 2, { type: 'pass' });
    act(state, 3, { type: 'bid', amount: 17 });
    // seat 0 passed → seat 1 is next
    expect(state.turn).toBe(1);
    expect(applyAction(state, 0, { type: 'bid', amount: 18 })).toMatchObject({ ok: false });
  });

  it('default rule: all four passing redeals with the next dealer', () => {
    const { state } = newMatch(OPEN, { dealer: 3 });
    for (const s of [0, 1, 2, 3] as const) act(state, s, { type: 'pass' });
    expect(state.phase).toBe('bidding');
    expect(state.dealer).toBe(0);
    expect(state.round).toBe(2);
    expect(state.turn).toBe(1);
    expect(state.hands.every((h) => h.length === 4)).toBe(true);
  });

  it('dealerForced variant: dealer may not pass after three passes', () => {
    const { state } = newMatch({ ...OPEN, allPassAction: 'dealerForced' }, { dealer: 3 });
    for (const s of [0, 1, 2] as const) act(state, s, { type: 'pass' });
    expect(mustBid(state, 3)).toBe(true);
    expect(applyAction(state, 3, { type: 'pass' })).toMatchObject({ ok: false, error: { code: 'CANNOT_PASS' } });
    act(state, 3, { type: 'bid', amount: 16 });
    expect(state.phase).toBe('trumpSelection');
    expect(state.contract?.bidder).toBe(3);
  });

  it('rejects actions that do not belong to the phase', () => {
    const { state } = newMatch(OPEN);
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

// Dealer = 3, so the speaking order is 0 (you), 1 (right), 2 (partner), 3 (left).
describe('duel bidding (default)', () => {
  const duel = () => newMatch(CLASSIC_RULES, { dealer: 3 }).state;

  it('is the default style', () => {
    expect(CLASSIC_RULES.biddingStyle).toBe('duel');
    const s = duel();
    expect(s.turn).toBe(0);
    expect(s.bidding.holder).toBe(0);
    expect(s.bidding.challenger).toBe(1);
  });

  it("plays the example: 16, 17, stay 17, 18, pass — then the partner challenges", () => {
    const s = duel();
    act(s, 0, { type: 'bid', amount: 16 });
    expect(s.turn).toBe(1);
    // The challenger must go higher than the holder.
    expect(applyAction(s, 1, { type: 'bid', amount: 16 })).toMatchObject({ ok: false, error: { code: 'ILLEGAL_BID' } });
    act(s, 1, { type: 'bid', amount: 17 });
    expect(s.turn).toBe(0);
    // The holder may stay at the same number.
    expect(buildPlayerView(s, 0).bidding).toMatchObject({ nextMinBid: 17, canStay: true });
    act(s, 0, { type: 'bid', amount: 17 });
    expect(s.bidding.history.at(-1)).toEqual({ seat: 0, bid: 17, stay: true });
    expect(s.bidding.highestBidder).toBe(0);
    expect(s.turn).toBe(1);
    expect(applyAction(s, 1, { type: 'bid', amount: 17 })).toMatchObject({ ok: false, error: { code: 'ILLEGAL_BID' } });
    act(s, 1, { type: 'bid', amount: 18 });
    act(s, 0, { type: 'pass' });
    // Seat 1 survives with priority; seat 2 (the partner of seat 0) enters.
    expect(s.bidding.holder).toBe(1);
    expect(s.bidding.challenger).toBe(2);
    expect(s.turn).toBe(2);
    expect(applyAction(s, 0, { type: 'bid', amount: 19 })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    expect(applyAction(s, 2, { type: 'bid', amount: 18 })).toMatchObject({ ok: false, error: { code: 'ILLEGAL_BID' } });
    act(s, 2, { type: 'bid', amount: 19 });
    act(s, 1, { type: 'bid', amount: 19 }); // stay
    act(s, 2, { type: 'pass' });
    // Now seat 3 challenges seat 1.
    expect(s.bidding.holder).toBe(1);
    expect(s.bidding.challenger).toBe(3);
    expect(s.turn).toBe(3);
    act(s, 3, { type: 'pass' });
    expect(s.phase).toBe('trumpSelection');
    expect(s.contract).toEqual({ bidder: 1, team: 1, bid: 19, target: 19 });
  });

  it('if the second player passes, the partner duels the first player', () => {
    const s = duel();
    act(s, 0, { type: 'bid', amount: 16 });
    act(s, 1, { type: 'pass' });
    expect([s.bidding.holder, s.bidding.challenger, s.turn]).toEqual([0, 2, 2]);
    act(s, 2, { type: 'bid', amount: 17 });
    act(s, 0, { type: 'bid', amount: 17 }); // stay
    act(s, 2, { type: 'pass' });
    expect([s.bidding.holder, s.bidding.challenger, s.turn]).toEqual([0, 3, 3]);
    act(s, 3, { type: 'bid', amount: 18 });
    act(s, 0, { type: 'pass' });
    expect(s.contract).toMatchObject({ bidder: 3, bid: 18 });
  });

  it('the holder may also raise instead of staying', () => {
    const s = duel();
    act(s, 0, { type: 'bid', amount: 16 });
    act(s, 1, { type: 'bid', amount: 17 });
    act(s, 0, { type: 'bid', amount: 20 });
    expect(s.bidding.history.at(-1)).toEqual({ seat: 0, bid: 20 });
    expect(buildPlayerView(s, 1).bidding).toMatchObject({ nextMinBid: 21, canStay: false });
  });

  it('first player may pass without bidding: players 2 and 3 duel and player 2 holds priority', () => {
    const s = duel();
    act(s, 0, { type: 'pass' });
    expect([s.bidding.holder, s.bidding.challenger, s.turn]).toEqual([1, 2, 1]);
    act(s, 1, { type: 'bid', amount: 16 });
    expect(s.turn).toBe(2);
    act(s, 2, { type: 'bid', amount: 17 });
    act(s, 1, { type: 'bid', amount: 17 }); // stay
    expect(s.bidding.highestBidder).toBe(1);
  });

  it('everyone passing reshuffles and moves the deal', () => {
    const s = duel();
    act(s, 0, { type: 'pass' });
    act(s, 1, { type: 'pass' });
    act(s, 2, { type: 'pass' });
    expect(s.turn).toBe(3); // last player speaks alone
    act(s, 3, { type: 'pass' });
    expect(s.phase).toBe('bidding');
    expect(s.dealer).toBe(0);
    expect(s.round).toBe(2);
    expect(s.turn).toBe(1);
    expect(s.bidding.history).toEqual([]);
  });

  it('the last player alone may bid and wins immediately', () => {
    const s = duel();
    act(s, 0, { type: 'pass' });
    act(s, 1, { type: 'pass' });
    act(s, 2, { type: 'pass' });
    act(s, 3, { type: 'bid', amount: 16 });
    expect(s.contract).toMatchObject({ bidder: 3, bid: 16 });
  });

  it('staying at 28 wins: nobody can go higher, so the rest pass automatically', () => {
    const s = duel();
    act(s, 0, { type: 'bid', amount: 16 });
    act(s, 1, { type: 'bid', amount: 28 });
    act(s, 0, { type: 'bid', amount: 28 }); // stay at 28
    expect(s.phase).toBe('trumpSelection');
    expect(s.contract).toMatchObject({ bidder: 0, bid: 28 });
    expect(s.bidding.history.filter((h) => h.bid === null).map((h) => h.seat)).toEqual([1, 2, 3]);
  });

  it('a challenger bidding 28 can still be matched by the holder, or the holder passes', () => {
    const s = duel();
    act(s, 0, { type: 'bid', amount: 16 });
    act(s, 1, { type: 'bid', amount: 28 });
    expect(s.turn).toBe(0);
    act(s, 0, { type: 'pass' });
    // 2 and 3 cannot exceed 28 → pass automatically; seat 1 wins.
    expect(s.contract).toMatchObject({ bidder: 1, bid: 28 });
  });

  it('turn-timer auto action for the holder is a pass', () => {
    const s = duel();
    act(s, 0, { type: 'bid', amount: 16 });
    act(s, 1, { type: 'bid', amount: 17 });
    expect(getAutoAction(s, 0)).toEqual({ type: 'pass' });
  });
});
