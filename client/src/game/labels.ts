import type { Rank, Seat, Suit, TeamId } from '@shared/types';

export const SUIT_NAME: Record<Suit, string> = {
  clubs: 'Clubs',
  diamonds: 'Diamonds',
  hearts: 'Hearts',
  spades: 'Spades',
};
export const SUIT_SYMBOL: Record<Suit, string> = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };
export const isRed = (s: Suit) => s === 'hearts' || s === 'diamonds';
export const TEAM_NAME: Record<TeamId, string> = { 0: 'Red', 1: 'Blue' };
export const RANK_NAME: Record<Rank, string> = {
  '7': 'Seven', '8': 'Eight', '9': 'Nine', '10': 'Ten', J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace',
};
/** Display-only point values (the server computes all scoring). */
export const RANK_POINTS: Record<Rank, number> = { J: 3, '9': 2, A: 1, '10': 1, K: 0, Q: 0, '8': 0, '7': 0 };

export type Position = 'south' | 'east' | 'north' | 'west';
const ORDER: Position[] = ['south', 'east', 'north', 'west'];
/** Seat positions relative to the viewer; the next player sits to the viewer's right (east). */
export function positionOf(seat: Seat, mySeat: Seat | null): Position {
  return ORDER[(seat - (mySeat ?? 0) + 4) % 4];
}

export function trumpText(suit: Suit, reverse: boolean): string {
  return `${reverse ? 'REVERSE TRUMP' : 'TRUMP'}: ${SUIT_NAME[suit].toUpperCase()}`;
}
