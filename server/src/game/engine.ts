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
import { cardId, teamOf, type Card, type LogEntry, type Seat, type Suit, type TeamId } from '@shared/types';
import type { RulesConfig } from '../config/rulesConfig';
import { createDeck, secureRandomInt, shuffle, sumPoints, type RandomIntFn } from './deck';
import { determineTrickWinner, legalCards, nextSeat, normalRankStrength } from './rules';
import { applyGamePoints, detectMatchWinner, evaluateContract } from './scoring';
import {
  PHASE_ACTIONS,
  type EngineEvent,
  type EngineResult,
  type GameAction,
  type GameState,
} from './state';
import type { ErrorCode } from '@shared/events';

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
    roundResult: null,
    roundHistory: [],
    matchWinner: null,
    log: [],
    logCounter: 0,
  };
}

function freshBidding(): GameState['bidding'] {
  return { history: [], highestBid: null, highestBidder: null, passed: [false, false, false, false] };
}

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
  state.bidding = freshBidding();
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

export function nextMinBid(state: GameState): number {
  const { highestBid } = state.bidding;
  return highestBid === null ? state.rules.minBid : highestBid + state.rules.bidIncrement;
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
  if (state.phase !== 'playing' || state.turn !== seat) return false;
  if (!state.rules.trumpConcealed || state.trumpRevealed || state.trumpSuit === null) return false;
  const lead = leadSuit(state);
  if (lead === null) return false;
  return !state.hands[seat].some((c) => c.suit === lead);
}

export function canDeclarePair(state: GameState, seat: Seat): boolean {
  if (!state.rules.pairEnabled || state.pair !== null) return false;
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
  const min = nextMinBid(state);
  if (!Number.isInteger(amount) || amount < min || amount > state.rules.maxBid) {
    return fail('ILLEGAL_BID', `Bid must be a whole number between ${min} and ${state.rules.maxBid}.`);
  }
  state.bidding.history.push({ seat, bid: amount });
  state.bidding.highestBid = amount;
  state.bidding.highestBidder = seat;
  log(state, `${state.names[seat]} bids ${amount}.`, 'bid');
  state.seq += 1;
  const othersActive = state.bidding.passed.some((p, s) => !p && s !== seat);
  if (amount === state.rules.maxBid || !othersActive) return { ok: true, events: endBidding(state) };
  advanceBidTurn(state);
  return { ok: true, events: [] };
}

function doPass(state: GameState, seat: Seat, rng: RandomIntFn): EngineResult {
  if (state.turn !== seat) return fail('NOT_YOUR_TURN', 'It is not your turn to bid.');
  if (mustBid(state, seat)) return fail('CANNOT_PASS', 'Everyone else passed — the dealer must bid.');
  state.bidding.passed[seat] = true;
  state.bidding.history.push({ seat, bid: null });
  log(state, `${state.names[seat]} passes.`, 'bid');
  state.seq += 1;

  const active = state.bidding.passed.filter((p) => !p).length;
  if (state.bidding.highestBid === null && active === 0) {
    log(state, 'Everyone passed — the hand is redealt.', 'round');
    state.dealer = nextSeat(state.dealer);
    const events = startRound(state, rng);
    return { ok: true, events: [{ type: 'redeal', reason: 'All players passed.' }, ...events] };
  }
  if (state.bidding.highestBid !== null && active === 1) return { ok: true, events: endBidding(state) };
  advanceBidTurn(state);
  return { ok: true, events: [] };
}

function advanceBidTurn(state: GameState): void {
  let s = nextSeat(state.turn!);
  while (state.bidding.passed[s]) s = nextSeat(s);
  state.turn = s;
}

function endBidding(state: GameState): EngineEvent[] {
  const bidder = state.bidding.highestBidder!;
  const bid = state.bidding.highestBid!;
  state.contract = { bidder, team: teamOf(bidder), bid, target: bid };
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
  state.phase = 'dealing';
  dealCards(state, HAND_SIZE_SECOND_DEAL);
  state.phase = 'playing';
  const leader = nextSeat(state.dealer);
  state.currentTrick = { leader, cards: [] };
  state.turn = leader;
  state.seq += 1;
  return { ok: true, events: [] };
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

  if (state.currentTrick.cards.length === 4) {
    state.phase = 'trickResolution';
    state.turn = null;
  } else {
    state.turn = nextSeat(seat);
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
  const trumpActive = state.trumpRevealed;
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
  if (state.completedTricks.length === TRICKS_PER_ROUND) {
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
  const evaln = evaluateContract(contract, state.cardPoints, state.rules);
  state.matchScore = applyGamePoints(state.matchScore, evaln.gamePointsDelta);
  const result = {
    round: state.round,
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
  log(
    state,
    `${state.names[contract.bidder]}'s team ${evaln.success ? 'made' : 'failed'} ${contract.target} with ${evaln.bidderTeamPoints} points.`,
    'round',
  );
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
    return mustBid(state, seat) ? { type: 'bid', amount: nextMinBid(state) } : { type: 'pass' };
  }
  if (state.phase === 'trumpSelection' && state.contract?.bidder === seat) {
    const hand = state.hands[seat];
    const score = (s: Suit) =>
      hand.filter((c) => c.suit === s).reduce((a, c) => a + 10 + normalRankStrength(c.rank), 0);
    const suits: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
    const suit = suits.reduce((best, s) => (score(s) > score(best) ? s : best), suits[0]);
    return { type: 'chooseTrump', suit, reverse: false };
  }
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
