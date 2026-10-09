/**
 * Pure 29 game engine (no Express, Socket.IO or React dependencies).
 *
 * The engine mutates the GameState it is given and returns either an error
 * (state untouched) or a list of events describing what happened.
 *
 * Phase machine:
 *   waiting → dealing → bidding ─┬→ trumpSelection → dealing → playing
 *                                └→ (all pass) dealing → bidding (redeal)
 *   playing ⇄ trickResolution → … → roundEnd → dealing → bidding …
 *                                          └→ matchEnd → (rematch) dealing …
 */
import { cardId, teamOf, type Card, type DoublingCall, type LogEntry, type Seat, type Suit, type TeamId } from '@shared/types';
import type { RulesConfig } from '../config/rulesConfig';
import { createDeck, secureRandomInt, shuffle, sumPoints, type RandomIntFn } from './deck';
import { determineTrickWinner, legalCards, nextSeat, normalRankStrength, singleHandCanLose } from './rules';
import { applyGamePoints, detectMatchWinner, evaluateContract } from './scoring';
import {
  PHASE_ACTIONS,
  type EngineEvent,
  type EngineResult,
  type GameAction,
  type GameState,
} from './state';
import type { ErrorCode } from '@shared/events';
import type { RoundResult } from '@shared/types';

const HAND_SIZE_FIRST_DEAL = 4;
const HAND_SIZE_SECOND_DEAL = 4;
const TRICKS_PER_ROUND = 8;
const MAX_LOG = 80;

const SUIT_NAME: Record<Suit, string> = {
  clubs: 'Clubs',
  diamonds: 'Diamonds',
  hearts: 'Hearts',
  spades: 'Spades',
};

export function trumpLabel(suit: Suit, reverse: boolean): string {
  return `${reverse ? 'REVERSE TRUMP' : 'TRUMP'}: ${SUIT_NAME[suit].toUpperCase()}`;
}

// ─── construction ─────────────────────────────────────────────────────────

export function createGame(opts: {
  rules: RulesConfig;
  reverseTrumpAllowed: boolean;
  names?: [string, string, string, string];
}): GameState {
  return {
    rules: opts.rules,
    reverseTrumpAllowed: opts.reverseTrumpAllowed && opts.rules.reverseTrumpSupported,
    names: opts.names ?? ['North', 'East', 'South', 'West'],
    phase: 'waiting',
    round: 0,
    seq: 0,
    dealer: 0,
    turn: null,
    deck: [],
    hands: [[], [], [], []],
    bidding: freshBidding(),
    contract: null,
    trumpSuit: null,
    reverseTrump: false,
    trumpRevealed: false,
    trumpRevealedBy: null,
    trumpRevealTrick: null,
    mustPlayTrumpSeat: null,
    currentTrick: { leader: null, cards: [] },
    completedTricks: [],
    tricksWon: [0, 0],
    cardPoints: [0, 0],
    matchScore: [0, 0],
    pair: null,
    doubling: freshDoubling(),
    single: { declarer: null, pending: [] },
    roundResult: null,
    roundHistory: [],
    matchWinner: null,
    log: [],
    logCounter: 0,
  };
}

function freshBidding(dealer: Seat = 0): GameState['bidding'] {
  const order: Seat[] = [];
  for (let i = 1; i <= 4; i++) order.push(((dealer + i) % 4) as Seat);
  return {
    history: [],
    highestBid: null,
    highestBidder: null,
    passed: [false, false, false, false],
    order,
    holder: order[0],
    challenger: order[1],
    nextEntrant: 2,
  };
}

function freshDoubling(): GameState['doubling'] {
  return { stage: null, level: 0, pending: [], calls: [] };
}

const partnerOf = (seat: Seat): Seat => ((seat + 2) % 4) as Seat;

function log(state: GameState, text: string, kind: LogEntry['kind']): void {
  state.log.push({ id: ++state.logCounter, text, kind });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

const fail = (code: ErrorCode, message: string): EngineResult => ({ ok: false, error: { code, message } });

/** Start a new match. `firstDealer` defaults to a random seat. */
export function startMatch(
  state: GameState,
  rng: RandomIntFn = secureRandomInt,
  firstDealer?: Seat,
): EngineEvent[] {
  state.matchScore = [0, 0];
  state.matchWinner = null;
  state.roundHistory = [];
  state.round = 0;
  state.dealer = firstDealer ?? (rng(4) as Seat);
  log(state, 'Match started.', 'system');
  return startRound(state, rng);
}

/** Deal a fresh round with the current dealer. */
export function startRound(state: GameState, rng: RandomIntFn = secureRandomInt): EngineEvent[] {
  state.round += 1;
  state.phase = 'dealing';
  state.deck = shuffle(createDeck(), rng);
  state.hands = [[], [], [], []];
  state.bidding = freshBidding(state.dealer);
  state.contract = null;
  state.trumpSuit = null;
  state.reverseTrump = false;
  state.trumpRevealed = false;
  state.trumpRevealedBy = null;
  state.trumpRevealTrick = null;
  state.mustPlayTrumpSeat = null;
  state.currentTrick = { leader: null, cards: [] };
  state.completedTricks = [];
  state.tricksWon = [0, 0];
  state.cardPoints = [0, 0];
  state.pair = null;
  state.doubling = freshDoubling();
  state.single = { declarer: null, pending: [] };
  state.roundResult = null;

  dealCards(state, HAND_SIZE_FIRST_DEAL);
  log(state, `Round ${state.round}: ${state.names[state.dealer]} deals.`, 'round');

  state.phase = 'bidding';
  state.turn = nextSeat(state.dealer);
  state.seq += 1;
  return [{ type: 'roundStarted', round: state.round }];
}

/** Deal `count` cards to each player, starting left of the dealer. */
function dealCards(state: GameState, count: number): void {
  let seat = nextSeat(state.dealer);
  for (let i = 0; i < 4; i++) {
    const cards = state.deck.splice(0, count);
    state.hands[seat].push(...cards);
    seat = nextSeat(seat);
  }
}

// ─── queries ──────────────────────────────────────────────────────────────

export function leadSuit(state: GameState): Suit | null {
  return state.currentTrick.cards[0]?.card.suit ?? null;
}

/**
 * Lowest amount `seat` may bid now. In duel bidding the player with priority
 * (the holder) may "stay" by matching the current bid; everyone else must go higher.
 */
export function nextMinBid(state: GameState, seat: Seat | null = state.turn): number {
  const { highestBid, holder } = state.bidding;
  if (highestBid === null) return state.rules.minBid;
  if (state.rules.biddingStyle === 'duel' && seat !== null && seat === holder) return highestBid;
  return highestBid + state.rules.bidIncrement;
}

/** Dealer forced to bid because the other three passed without a bid. */
export function mustBid(state: GameState, seat: Seat): boolean {
  if (state.phase !== 'bidding' || state.rules.allPassAction !== 'dealerForced') return false;
  if (state.bidding.highestBid !== null || seat !== state.dealer) return false;
  return state.bidding.passed.filter((p, s) => p && s !== seat).length === 3;
}

export function getLegalCards(state: GameState, seat: Seat): Card[] {
  if (state.phase !== 'playing' || state.turn !== seat) return [];
  return legalCards(state.hands[seat], leadSuit(state), {
    mustPlayTrump: state.mustPlayTrumpSeat === seat,
    trumpSuit: state.trumpRevealed ? state.trumpSuit : null,
  });
}

export function canRevealTrump(state: GameState, seat: Seat): boolean {
  if (state.phase !== 'playing' || state.turn !== seat || state.single.declarer !== null) return false;
  if (!state.rules.trumpConcealed || state.trumpRevealed || state.trumpSuit === null) return false;
  const lead = leadSuit(state);
  if (lead === null) return false;
  return !state.hands[seat].some((c) => c.suit === lead);
}

export function canDeclarePair(state: GameState, seat: Seat): boolean {
  if (!state.rules.pairEnabled || state.pair !== null || state.single.declarer !== null) return false;
  if (state.phase !== 'playing' && state.phase !== 'trickResolution') return false;
  if (!state.trumpRevealed || state.trumpSuit === null || state.trumpRevealTrick === null) return false;
  const hand = state.hands[seat];
  const hasK = hand.some((c) => c.id === cardId(state.trumpSuit!, 'K'));
  const hasQ = hand.some((c) => c.id === cardId(state.trumpSuit!, 'Q'));
  if (!hasK || !hasQ) return false;
  const team = teamOf(seat);
  const revealIdx = state.trumpRevealTrick;
  return state.completedTricks.some((t) => t.index >= revealIdx && teamOf(t.winner) === team);
}

// ─── actions ──────────────────────────────────────────────────────────────

export function applyAction(
  state: GameState,
  seat: Seat,
  action: GameAction,
  rng: RandomIntFn = secureRandomInt,
): EngineResult {
  if (!PHASE_ACTIONS[state.phase].includes(action.type)) {
    return fail('WRONG_PHASE', `Cannot ${action.type} during ${state.phase}.`);
  }
  switch (action.type) {
    case 'bid':
      return doBid(state, seat, action.amount);
    case 'pass':
      return doPass(state, seat, rng);
    case 'chooseTrump':
      return doChooseTrump(state, seat, action.suit, action.reverse);
    case 'revealTrump':
      return doRevealTrump(state, seat);
    case 'declarePair':
      return doDeclarePair(state, seat);
    case 'playCard':
      return doPlayCard(state, seat, action.cardId);
    case 'double':
      return doDouble(state, seat, action.stage);
    case 'declineDouble':
      return doDeclineDouble(state, seat);
    case 'declareSingle':
      return doDeclareSingle(state, seat);
    case 'skipSingle':
      return doSkipSingle(state, seat);
    case 'nextRound':
      state.dealer = nextSeat(state.dealer);
      return { ok: true, events: startRound(state, rng) };
    case 'rematch':
      log(state, 'Rematch!', 'system');
      state.dealer = nextSeat(state.dealer);
      return { ok: true, events: startMatch(state, rng, state.dealer) };
  }
}

function doBid(state: GameState, seat: Seat, amount: number): EngineResult {
  if (state.turn !== seat) return fail('NOT_YOUR_TURN', 'It is not your turn to bid.');
  if (state.bidding.passed[seat]) return fail('ILLEGAL_BID', 'You have already passed.');
  const min = nextMinBid(state, seat);
  if (min > state.rules.maxBid) return fail('ILLEGAL_BID', 'You cannot bid any higher — you must pass.');
  if (!Number.isInteger(amount) || amount < min || amount > state.rules.maxBid) {
    return fail('ILLEGAL_BID', `Bid must be a whole number between ${min} and ${state.rules.maxBid}.`);
  }
  const b = state.bidding;
  const stay = state.rules.biddingStyle === 'duel' && b.highestBid !== null && amount === b.highestBid;
  b.history.push(stay ? { seat, bid: amount, stay: true } : { seat, bid: amount });
  b.highestBid = amount;
  b.highestBidder = seat;
  log(state, stay ? `${state.names[seat]} stays at ${amount}.` : `${state.names[seat]} bids ${amount}.`, 'bid');
  state.seq += 1;

  if (state.rules.biddingStyle === 'duel') {
    const opponent = seat === b.holder ? b.challenger : b.holder;
    if (opponent === null) return { ok: true, events: endBidding(state) };
    state.turn = opponent;
    return { ok: true, events: forcePassesIfOutbid(state) };
  }

  const othersActive = b.passed.some((p, s) => !p && s !== seat);
  if (amount === state.rules.maxBid || !othersActive) return { ok: true, events: endBidding(state) };
  advanceBidTurn(state);
  return { ok: true, events: [] };
}

function doPass(state: GameState, seat: Seat, rng: RandomIntFn, forced = false): EngineResult {
  if (state.turn !== seat) return fail('NOT_YOUR_TURN', 'It is not your turn to bid.');
  if (mustBid(state, seat)) return fail('CANNOT_PASS', 'Everyone else passed — the dealer must bid.');
  const b = state.bidding;
  b.passed[seat] = true;
  b.history.push({ seat, bid: null });
  log(state, forced ? `${state.names[seat]} cannot go above ${b.highestBid} and passes.` : `${state.names[seat]} passes.`, 'bid');
  state.seq += 1;

  const active = b.passed.filter((p) => !p).length;
  if (b.highestBid === null && active === 0) {
    log(state, 'Everyone passed — the hand is redealt.', 'round');
    state.dealer = nextSeat(state.dealer);
    const events = startRound(state, rng);
    return { ok: true, events: [{ type: 'redeal', reason: 'All players passed.' }, ...events] };
  }

  if (state.rules.biddingStyle === 'duel') {
    // The survivor of the duel keeps priority and faces the next player in order.
    const survivor = seat === b.holder ? b.challenger : b.holder;
    if (b.nextEntrant < b.order.length) {
      b.holder = survivor;
      b.challenger = b.order[b.nextEntrant++];
      if (b.holder === null) {
        // Only possible when nobody is left in the duel; the entrant speaks alone.
        b.holder = b.challenger;
        b.challenger = null;
      }
      state.turn = b.highestBid === null ? b.holder : b.challenger ?? b.holder;
      return { ok: true, events: forcePassesIfOutbid(state) };
    }
    if (b.highestBid !== null) return { ok: true, events: endBidding(state) };
    // Nobody has bid and everyone else is out: the last player speaks alone.
    b.holder = survivor;
    b.challenger = null;
    state.turn = survivor;
    return { ok: true, events: [] };
  }

  if (b.highestBid !== null && active === 1) return { ok: true, events: endBidding(state) };
  advanceBidTurn(state);
  return { ok: true, events: [] };
}

/** Duel bidding: a challenger who cannot exceed the current bid (it is already the maximum) passes automatically. */
function forcePassesIfOutbid(state: GameState): EngineEvent[] {
  const events: EngineEvent[] = [];
  while (state.phase === 'bidding' && state.turn !== null && nextMinBid(state, state.turn) > state.rules.maxBid) {
    const res = doPass(state, state.turn, secureRandomInt, true);
    if (!res.ok) break;
    events.push(...res.events);
  }
  return events;
}

function advanceBidTurn(state: GameState): void {
  let s = nextSeat(state.turn!);
  while (state.bidding.passed[s]) s = nextSeat(s);
  state.turn = s;
}

function endBidding(state: GameState): EngineEvent[] {
  const bidder = state.bidding.highestBidder!;
  const bid = state.bidding.highestBid!;
  state.contract = { bidder, team: teamOf(bidder), bid, target: bid, doubleLevel: 0, multiplier: state.rules.doublingMultipliers[0] };
  state.phase = 'trumpSelection';
  state.turn = bidder;
  log(state, `${state.names[bidder]} wins the bid at ${bid} and chooses trump.`, 'bid');
  return [];
}

function doChooseTrump(state: GameState, seat: Seat, suit: Suit, reverse: boolean): EngineResult {
  if (!state.contract || state.contract.bidder !== seat) {
    return fail('NOT_YOUR_TURN', 'Only the winning bidder chooses trump.');
  }
  if (reverse && !state.reverseTrumpAllowed) {
    return fail('REVERSE_TRUMP_DISABLED', 'Reverse Trump is not enabled in this room.');
  }
  state.trumpSuit = suit;
  state.reverseTrump = reverse;
  if (state.rules.trumpConcealed) {
    log(state, `${state.names[seat]} has secretly chosen trump.`, 'trump');
  } else {
    state.trumpRevealed = true;
    state.trumpRevealedBy = seat;
    state.trumpRevealTrick = 0;
    log(state, `${state.names[seat]} declares ${trumpLabel(suit, reverse)}.`, 'trump');
  }
  state.seq += 1;
  if (state.rules.doublingEnabled) openDoubling(state, 'double');
  else afterDoubling(state);
  return { ok: true, events: [] };
}

// ─── Double / Redouble / Set ──────────────────────────────────────────────

const DOUBLING_ORDER: DoublingCall[] = ['double', 'redouble', 'set'];
const CALL_LABEL: Record<DoublingCall, string> = { double: 'DOUBLE', redouble: 'REDOUBLE', set: 'SET' };

/** Seats allowed to make `call`: opponents double and set, the bidder's team redoubles. */
function callersFor(state: GameState, call: DoublingCall): Seat[] {
  const bidder = state.contract!.bidder;
  return call === 'redouble' ? [bidder, partnerOf(bidder)] : [nextSeat(bidder), partnerOf(nextSeat(bidder))];
}

function openDoubling(state: GameState, stage: DoublingCall): void {
  state.phase = 'doubling';
  state.turn = null;
  state.doubling.stage = stage;
  state.doubling.pending = callersFor(state, stage);
}

function doDouble(state: GameState, seat: Seat, stage: DoublingCall): EngineResult {
  const d = state.doubling;
  if (d.stage !== stage) return fail('STALE_ACTION', 'That call is no longer open.');
  if (!d.pending.includes(seat)) return fail('NOT_YOUR_TURN', `Only the ${stage === 'redouble' ? "bidder's team" : 'opponents'} can ${stage}.`);
  d.level += 1;
  d.calls.push({ seat, call: stage });
  const contract = state.contract!;
  contract.doubleLevel = d.level;
  contract.multiplier = state.rules.doublingMultipliers[d.level];
  log(state, `${state.names[seat]} says ${CALL_LABEL[stage]}! Points are now ×${contract.multiplier}.`, 'bid');
  state.seq += 1;
  const next = DOUBLING_ORDER[DOUBLING_ORDER.indexOf(stage) + 1];
  if (next) openDoubling(state, next);
  else afterDoubling(state);
  return { ok: true, events: [] };
}

function doDeclineDouble(state: GameState, seat: Seat): EngineResult {
  const d = state.doubling;
  if (!d.pending.includes(seat)) return fail('NOT_YOUR_TURN', 'You have nothing to decide right now.');
  d.pending = d.pending.filter((s) => s !== seat);
  state.seq += 1;
  if (d.pending.length === 0) afterDoubling(state);
  return { ok: true, events: [] };
}

/** Deal the last four cards, then open the Single-Hand window (or start play). */
function afterDoubling(state: GameState): void {
  state.doubling.stage = null;
  state.doubling.pending = [];
  state.phase = 'dealing';
  dealCards(state, HAND_SIZE_SECOND_DEAL);
  if (state.rules.singleHandEnabled) {
    state.phase = 'singleHand';
    state.turn = null;
    const order: Seat[] = [];
    for (let i = 1; i <= 4; i++) order.push(((state.dealer + i) % 4) as Seat);
    state.single.pending = order;
  } else startPlay(state, nextSeat(state.dealer));
}

// ─── Single Hand ──────────────────────────────────────────────────────────

export function singleHandBlockedReason(state: GameState, seat: Seat): string | null {
  if (!singleHandCanLose(state.hands[seat])) {
    return 'Your hand cannot lose a trick — a Single Hand needs at least one card that could be caught.';
  }
  return null;
}

function doDeclareSingle(state: GameState, seat: Seat): EngineResult {
  if (!state.single.pending.includes(seat)) return fail('NOT_YOUR_TURN', 'The Single-Hand window is closed for you.');
  const blocked = singleHandBlockedReason(state, seat);
  if (blocked) return fail('CANNOT_DECLARE_SINGLE', blocked);
  state.single = { declarer: seat, pending: [] };
  log(state, `${state.names[seat]} declares SINGLE HAND! ${state.names[partnerOf(seat)]} sits out — no trump.`, 'trump');
  state.seq += 1;
  startPlay(state, seat);
  return { ok: true, events: [] };
}

function doSkipSingle(state: GameState, seat: Seat): EngineResult {
  if (!state.single.pending.includes(seat)) return fail('NOT_YOUR_TURN', 'You have nothing to decide right now.');
  state.single.pending = state.single.pending.filter((s) => s !== seat);
  state.seq += 1;
  if (state.single.pending.length === 0) startPlay(state, nextSeat(state.dealer));
  return { ok: true, events: [] };
}

/**
 * Close an open Double/Set or Single-Hand window: everyone who has not
 * answered declines. Called by the room layer when the window times out.
 */
export function closeDeclarationWindow(state: GameState): boolean {
  if (state.phase === 'doubling') {
    state.seq += 1;
    afterDoubling(state);
    return true;
  }
  if (state.phase === 'singleHand') {
    state.single.pending = [];
    state.seq += 1;
    startPlay(state, nextSeat(state.dealer));
    return true;
  }
  return false;
}

function startPlay(state: GameState, leader: Seat): void {
  state.phase = 'playing';
  state.currentTrick = { leader, cards: [] };
  state.turn = leader;
}

const isSingle = (state: GameState) => state.single.declarer !== null;
/** Next seat in play order, skipping a Single-Hand declarer's partner. */
function nextPlaySeat(state: GameState, seat: Seat): Seat {
  const s = nextSeat(seat);
  return isSingle(state) && s === partnerOf(state.single.declarer!) ? nextSeat(s) : s;
}

function doRevealTrump(state: GameState, seat: Seat): EngineResult {
  if (state.turn !== seat) return fail('NOT_YOUR_TURN', 'It is not your turn.');
  if (!canRevealTrump(state, seat)) {
    return fail('CANNOT_REVEAL', 'You may only call for trump when you cannot follow the lead suit.');
  }
  state.trumpRevealed = true;
  state.trumpRevealedBy = seat;
  state.trumpRevealTrick = state.completedTricks.length;
  if (state.rules.mustPlayTrumpAfterReveal) state.mustPlayTrumpSeat = seat;
  log(state, `${state.names[seat]} calls for trump — ${trumpLabel(state.trumpSuit!, state.reverseTrump)}!`, 'trump');
  state.seq += 1;
  return { ok: true, events: [] };
}

function doDeclarePair(state: GameState, seat: Seat): EngineResult {
  if (!canDeclarePair(state, seat)) {
    return fail(
      'CANNOT_DECLARE_PAIR',
      'A pair needs the K and Q of the revealed trump and a trick won by your team since the reveal.',
    );
  }
  const contract = state.contract!;
  const team = teamOf(seat);
  const r = state.rules;
  const before = contract.target;
  contract.target =
    team === contract.team
      ? Math.max(contract.target - r.pairValue, r.pairMinTarget)
      : Math.min(contract.target + r.pairValue, r.pairMaxTarget);
  state.pair = { seat, team, adjustment: contract.target - before };
  log(state, `${state.names[seat]} declares the pair! Target is now ${contract.target}.`, 'trump');
  state.seq += 1;
  return { ok: true, events: [] };
}

function doPlayCard(state: GameState, seat: Seat, id: string): EngineResult {
  if (state.turn !== seat) return fail('NOT_YOUR_TURN', 'It is not your turn.');
  const hand = state.hands[seat];
  const idx = hand.findIndex((c) => c.id === id);
  if (idx < 0) return fail('CARD_NOT_OWNED', 'That card is not in your hand.');
  if (!getLegalCards(state, seat).some((c) => c.id === id)) {
    const lead = leadSuit(state);
    const msg =
      state.mustPlayTrumpSeat === seat
        ? 'You called for trump, so you must play a trump card.'
        : `You must follow suit (${lead}).`;
    return fail('ILLEGAL_CARD', msg);
  }
  const [card] = hand.splice(idx, 1);
  if (state.currentTrick.cards.length === 0) state.currentTrick.leader = seat;
  state.currentTrick.cards.push({ seat, card });
  if (state.mustPlayTrumpSeat === seat) state.mustPlayTrumpSeat = null;
  log(state, `${state.names[seat]} plays ${card.rank} of ${SUIT_NAME[card.suit]}.`, 'play');

  if (state.currentTrick.cards.length === (isSingle(state) ? 3 : 4)) {
    state.phase = 'trickResolution';
    state.turn = null;
  } else {
    state.turn = nextPlaySeat(state, seat);
  }
  state.seq += 1;
  return { ok: true, events: [] };
}

/**
 * Collect the completed trick (called by the room layer after a short
 * display delay). Trump counts for this trick if it has been revealed at
 * any point before resolution, including during this trick.
 */
export function resolveTrick(state: GameState): EngineEvent[] {
  if (state.phase !== 'trickResolution') throw new Error('No trick to resolve');
  const cards = state.currentTrick.cards;
  const trumpActive = state.trumpRevealed && !isSingle(state);
  const winner = determineTrickWinner(
    cards,
    trumpActive ? state.trumpSuit : null,
    state.reverseTrump,
    state.rules.reverseTrumpScope,
  );
  const points = sumPoints(cards.map((c) => c.card));
  const trick = {
    index: state.completedTricks.length,
    leader: state.currentTrick.leader!,
    cards: cards.slice(),
    winner,
    points,
    trumpActive,
  };
  state.completedTricks.push(trick);
  const team = teamOf(winner);
  state.tricksWon[team] += 1;
  state.cardPoints[team] += points;
  log(state, `${state.names[winner]} wins trick ${trick.index + 1} (${points} pts).`, 'trick');

  const events: EngineEvent[] = [{ type: 'trickResolved', trick }];
  const singleLost = isSingle(state) && winner !== state.single.declarer;
  if (singleLost || state.completedTricks.length === TRICKS_PER_ROUND) {
    events.push(...finishRound(state));
  } else {
    state.phase = 'playing';
    state.currentTrick = { leader: winner, cards: [] };
    state.turn = winner;
  }
  state.seq += 1;
  return events;
}

function finishRound(state: GameState): EngineEvent[] {
  const contract = state.contract!;
  const single = state.single.declarer;
  let evaln = evaluateContract(contract, state.cardPoints, state.rules);
  let singleResult: RoundResult['single'] = null;
  if (single !== null) {
    // A Single Hand replaces the contract (and any doubles) for this round.
    const tricks = state.completedTricks.filter((t) => t.winner === single).length;
    const success = tricks === TRICKS_PER_ROUND;
    const delta: [number, number] = [0, 0];
    delta[teamOf(single)] = success ? state.rules.singleHandPoints : -state.rules.singleHandPoints;
    evaln = { success, bidderTeamPoints: state.cardPoints[teamOf(single)], gamePointsDelta: delta };
    singleResult = { seat: single, success, tricksWon: tricks };
  }
  state.matchScore = applyGamePoints(state.matchScore, evaln.gamePointsDelta);
  const result: RoundResult = {
    round: state.round,
    kind: single !== null ? 'single' : 'contract',
    multiplier: single !== null ? 1 : contract.multiplier ?? 1,
    single: singleResult,
    contract: { ...contract },
    bidderTeamPoints: evaln.bidderTeamPoints,
    success: evaln.success,
    gamePointsDelta: evaln.gamePointsDelta,
    cardPoints: [...state.cardPoints] as [number, number],
    tricksWon: [...state.tricksWon] as [number, number],
    trumpSuit: state.trumpSuit!,
    reverseTrump: state.reverseTrump,
    matchScore: [...state.matchScore] as [number, number],
  };
  state.roundResult = result;
  state.roundHistory.push(result);
  state.turn = null;
  state.currentTrick = { leader: null, cards: [] };
  if (single !== null) {
    log(state, `${state.names[single]}'s Single Hand ${evaln.success ? 'succeeds — all 8 tricks!' : 'is caught!'}`, 'round');
  } else {
    log(
      state,
      `${state.names[contract.bidder]}'s team ${evaln.success ? 'made' : 'failed'} ${contract.target} with ${evaln.bidderTeamPoints} points.`,
      'round',
    );
  }
  const events: EngineEvent[] = [{ type: 'roundFinished', result }];
  const winner = detectMatchWinner(state.matchScore, state.rules);
  if (winner !== null) {
    state.matchWinner = winner;
    state.phase = 'matchEnd';
    log(state, `Team ${winner === 0 ? 'Red' : 'Blue'} wins the match!`, 'round');
    events.push({ type: 'matchFinished', winner, matchScore: [...state.matchScore] as [number, number] });
  } else {
    state.phase = 'roundEnd';
  }
  return events;
}

// ─── automation (timeouts / vacated seats) ────────────────────────────────

/** Seat whose input the game is waiting for, if any. */
export function seatToAct(state: GameState): Seat | null {
  if (state.phase === 'bidding' || state.phase === 'trumpSelection' || state.phase === 'playing') return state.turn;
  return null;
}

/**
 * A safe default action for a seat that ran out of time or is vacant:
 * pass (or bid the minimum if forced), choose the longest suit as normal
 * trump, or play the least valuable legal card. Never reveals trump.
 */
export function getAutoAction(state: GameState, seat: Seat): GameAction | null {
  if (state.phase === 'bidding' && state.turn === seat) {
    return mustBid(state, seat) ? { type: 'bid', amount: nextMinBid(state, seat) } : { type: 'pass' };
  }
  if (state.phase === 'trumpSelection' && state.contract?.bidder === seat) {
    const hand = state.hands[seat];
    const score = (s: Suit) =>
      hand.filter((c) => c.suit === s).reduce((a, c) => a + 10 + normalRankStrength(c.rank), 0);
    const suits: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
    const suit = suits.reduce((best, s) => (score(s) > score(best) ? s : best), suits[0]);
    return { type: 'chooseTrump', suit, reverse: false };
  }
  if (state.phase === 'doubling' && state.doubling.pending.includes(seat)) return { type: 'declineDouble' };
  if (state.phase === 'singleHand' && state.single.pending.includes(seat)) return { type: 'skipSingle' };
  if (state.phase === 'playing' && state.turn === seat) {
    const legal = getLegalCards(state, seat);
    const sorted = legal
      .slice()
      .sort((a, b) => sumPoints([a]) - sumPoints([b]) || normalRankStrength(a.rank) - normalRankStrength(b.rank));
    return sorted.length ? { type: 'playCard', cardId: sorted[0].id } : null;
  }
  return null;
}

export const otherTeam = (t: TeamId): TeamId => (1 - t) as TeamId;
