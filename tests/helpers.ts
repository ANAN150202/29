import type { Card, Rank, Seat, Suit } from '@shared/types';
import { CLASSIC_RULES, OPEN_TRUMP_RULES, type RulesConfig } from '../server/src/config/rulesConfig';
import { seededRandomInt } from '../server/src/game/deck';
import { applyAction, createGame, startMatch } from '../server/src/game/engine';
import type { GameAction, GameState } from '../server/src/game/state';

const SUIT_CODE: Record<string, Suit> = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };

/** c('JH') → Jack of hearts, c('10S') → Ten of spades */
export function c(code: string): Card {
  const suit = SUIT_CODE[code.slice(-1)];
  const rank = code.slice(0, -1) as Rank;
  return { id: `${suit}-${rank}`, suit, rank };
}

export function cards(codes: string): Card[] {
  return codes.trim().split(/\s+/).map(c);
}

export function newMatch(rules: RulesConfig = CLASSIC_RULES, opts: { reverse?: boolean; seed?: number; dealer?: Seat } = {}) {
  const state = createGame({ rules, reverseTrumpAllowed: opts.reverse ?? true, names: ['Ann', 'Ben', 'Cat', 'Dan'] });
  const rng = seededRandomInt(opts.seed ?? 42);
  startMatch(state, rng, opts.dealer ?? 3);
  return { state, rng };
}

export function act(state: GameState, seat: Seat, action: GameAction) {
  const res = applyAction(state, seat, action, seededRandomInt(7));
  if (!res.ok) throw new Error(`${action.type} by ${seat} rejected: ${res.error.code} ${res.error.message}`);
  return res;
}

/**
 * Put a game directly into the playing phase with fixed 8-card hands.
 * Dealer = 3, so seat 0 leads and seat 0 is the bidder unless overridden.
 */
export function riggedPlaying(opts: {
  hands: [string, string, string, string];
  trump: Suit;
  reverse?: boolean;
  bidder?: Seat;
  bid?: number;
  rules?: RulesConfig;
  revealed?: boolean;
}): GameState {
  const rules = opts.rules ?? OPEN_TRUMP_RULES;
  const state = createGame({ rules, reverseTrumpAllowed: true, names: ['Ann', 'Ben', 'Cat', 'Dan'] });
  const bidder = opts.bidder ?? 0;
  state.round = 1;
  state.dealer = 3;
  state.hands = opts.hands.map(cards) as GameState['hands'];
  state.contract = { bidder, team: (bidder % 2) as 0 | 1, bid: opts.bid ?? 16, target: opts.bid ?? 16 };
  state.trumpSuit = opts.trump;
  state.reverseTrump = opts.reverse ?? false;
  const revealed = opts.revealed ?? !rules.trumpConcealed;
  state.trumpRevealed = revealed;
  state.trumpRevealTrick = revealed ? 0 : null;
  state.phase = 'playing';
  state.turn = 0;
  state.currentTrick = { leader: 0, cards: [] };
  return state;
}
