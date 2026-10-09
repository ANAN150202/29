/**
 * Builds the sanitized view each client receives. Rules:
 *  • A player sees only their own hand; others see hand counts.
 *  • The undealt deck is never sent.
 *  • A concealed trump is visible only to the bidder until it is revealed
 *    (or the round ends).
 */
import type { GameView, Seat, TrumpView } from '@shared/types';
import { determineTrickWinner } from './rules';
import {
  canDeclarePair,
  canRevealTrump,
  getLegalCards,
  leadSuit,
  mustBid,
  nextMinBid,
} from './engine';
import type { GameState } from './state';

export function buildPlayerView(
  state: GameState,
  viewer: Seat | null,
  extras: { turnDeadline?: number | null; turnTimeLimitMs?: number | null; now?: number } = {},
): GameView {
  const roundOver = state.phase === 'roundEnd' || state.phase === 'matchEnd';
  const isBidder = viewer !== null && state.contract?.bidder === viewer;
  const trumpChosen = state.trumpSuit !== null;
  const canSeeTrump = trumpChosen && (state.trumpRevealed || isBidder || roundOver);

  const trump: TrumpView = {
    revealed: state.trumpRevealed || (roundOver && trumpChosen),
    suit: canSeeTrump ? state.trumpSuit : null,
    reverse: canSeeTrump ? state.reverseTrump : null,
    hiddenFromMe: trumpChosen && !canSeeTrump,
    revealedBy: state.trumpRevealedBy,
  };

  const trickWinner =
    state.phase === 'trickResolution'
      ? determineTrickWinner(
          state.currentTrick.cards,
          state.trumpRevealed ? state.trumpSuit : null,
          state.reverseTrump,
          state.rules.reverseTrumpScope,
        )
      : null;
  const now = extras.now ?? Date.now();
  const deadline = extras.turnDeadline ?? null;

  const lastTrick = state.completedTricks.length
    ? state.completedTricks[state.completedTricks.length - 1]
    : null;

  return {
    phase: state.phase,
    round: state.round,
    seq: state.seq,
    dealer: state.dealer,
    turn: state.turn,
    mySeat: viewer,
    myHand: viewer !== null ? state.hands[viewer].map((c) => ({ ...c })) : [],
    legalCardIds: viewer !== null ? getLegalCards(state, viewer).map((c) => c.id) : [],
    handCounts: state.hands.map((h) => h.length),
    bidding: {
      history: state.bidding.history.map((b) => ({ ...b })),
      highestBid: state.bidding.highestBid,
      highestBidder: state.bidding.highestBidder,
      passed: [...state.bidding.passed],
      minBid: state.rules.minBid,
      maxBid: state.rules.maxBid,
      nextMinBid: nextMinBid(state, viewer),
      mustBid: viewer !== null && mustBid(state, viewer),
      style: state.rules.biddingStyle,
      holder: state.rules.biddingStyle === 'duel' ? state.bidding.holder : null,
      challenger: state.rules.biddingStyle === 'duel' ? state.bidding.challenger : null,
      waiting: state.rules.biddingStyle === 'duel' ? state.bidding.order.slice(state.bidding.nextEntrant) : [],
      canStay:
        state.rules.biddingStyle === 'duel' &&
        viewer !== null &&
        state.bidding.highestBid !== null &&
        nextMinBid(state, viewer) === state.bidding.highestBid,
    },
    contract: state.contract ? { ...state.contract } : null,
    trump,
    reverseTrumpAllowed: state.reverseTrumpAllowed,
    canRevealTrump: viewer !== null && canRevealTrump(state, viewer),
    canDeclarePair: viewer !== null && canDeclarePair(state, viewer),
    mustPlayTrump:
      viewer !== null &&
      state.mustPlayTrumpSeat === viewer &&
      state.hands[viewer].some((c) => c.suit === state.trumpSuit),
    pair: state.pair ? { ...state.pair } : null,
    currentTrick: {
      leader: state.currentTrick.leader,
      leadSuit: leadSuit(state),
      cards: state.currentTrick.cards.map((pc) => ({ seat: pc.seat, card: { ...pc.card } })),
    },
    trickWinner,
    lastTrick: lastTrick ? { ...lastTrick, cards: lastTrick.cards.map((pc) => ({ ...pc })) } : null,
    tricksPlayed: state.completedTricks.length,
    tricksWon: [...state.tricksWon] as [number, number],
    cardPoints: [...state.cardPoints] as [number, number],
    matchScore: [...state.matchScore] as [number, number],
    targetScore: state.rules.targetScore,
    roundResult: state.roundResult,
    matchWinner: state.matchWinner,
    turnTimeLeftMs: deadline === null ? null : Math.max(0, deadline - now),
    turnTimeLimitMs: deadline === null ? null : (extras.turnTimeLimitMs ?? null),
    log: state.log.slice(-30),
  };
}
