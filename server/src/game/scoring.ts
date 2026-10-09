/**
 * Scoring: card points (0–28 per round) and game points (match score) are
 * deliberately kept in separate functions and never mixed.
 */
import { teamOf, type Card, type Contract, type TeamId, type TrickRecord } from '@shared/types';
import type { RulesConfig } from '../config/rulesConfig';
import { sumPoints } from './deck';

/** Card points captured by each team, from completed tricks. */
export function countTeamCardPoints(tricks: readonly TrickRecord[]): [number, number] {
  const totals: [number, number] = [0, 0];
  for (const t of tricks) totals[teamOf(t.winner)] += sumPoints(t.cards.map((pc) => pc.card));
  return totals;
}

export function countTeamTricks(tricks: readonly TrickRecord[]): [number, number] {
  const totals: [number, number] = [0, 0];
  for (const t of tricks) totals[teamOf(t.winner)] += 1;
  return totals;
}

export function trickPoints(cards: readonly Card[]): number {
  return sumPoints(cards);
}

export interface ContractEvaluation {
  success: boolean;
  bidderTeamPoints: number;
  /** Game points to add to each team (index = TeamId). */
  gamePointsDelta: [number, number];
}

/** Did the bidding team make its contract, and what game points does that give? */
export function evaluateContract(
  contract: Contract,
  cardPoints: [number, number],
  rules: RulesConfig,
): ContractEvaluation {
  const bidderTeamPoints = cardPoints[contract.team];
  const success = bidderTeamPoints >= contract.target;
  const gamePointsDelta: [number, number] = [0, 0];
  const m = contract.multiplier ?? 1;
  gamePointsDelta[contract.team] = (success ? rules.gamePointsForWin : -rules.gamePointsForLoss) * m;
  return { success, bidderTeamPoints, gamePointsDelta };
}

export function applyGamePoints(
  matchScore: [number, number],
  delta: [number, number],
): [number, number] {
  return [matchScore[0] + delta[0], matchScore[1] + delta[1]];
}

/**
 * Returns the winning team if the match is over, else null.
 * A team wins on reaching +target; a team reaching −target loses.
 */
export function detectMatchWinner(matchScore: [number, number], rules: RulesConfig): TeamId | null {
  const t = rules.targetScore;
  for (const team of [0, 1] as TeamId[]) {
    if (matchScore[team] >= t) return team;
  }
  for (const team of [0, 1] as TeamId[]) {
    if (matchScore[team] <= -t) return (1 - team) as TeamId;
  }
  return null;
}
