import { fail } from './errors.js';

/**
 * A card is a plain integer in [0, 51].
 *
 *   card  = rank * 4 + suit
 *   rank  = card >> 2   (0 = deuce … 12 = ace)
 *   suit  = card & 3    (0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades)
 *
 * Integers rather than objects: they compare, sort, serialise, and fit in a
 * typed array for free, and the evaluator does a lot of bit work on them.
 */
export type Card = number;
/** 0 = deuce … 12 = ace. */
export type Rank = number;
/** 0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades. */
export type Suit = number;

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';
export const RANK_NAMES = [
  'Deuce',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Jack',
  'Queen',
  'King',
  'Ace',
] as const;
export const RANK_NAMES_PLURAL = [
  'Deuces',
  'Threes',
  'Fours',
  'Fives',
  'Sixes',
  'Sevens',
  'Eights',
  'Nines',
  'Tens',
  'Jacks',
  'Queens',
  'Kings',
  'Aces',
] as const;

export const NUM_RANKS = 13;
export const NUM_SUITS = 4;
export const DECK_SIZE = NUM_RANKS * NUM_SUITS;

export function makeCard(rank: Rank, suit: Suit): Card {
  if (!Number.isInteger(rank) || rank < 0 || rank >= NUM_RANKS) {
    fail('INVALID_CARD', `Rank out of range: ${rank}`, { rank });
  }
  if (!Number.isInteger(suit) || suit < 0 || suit >= NUM_SUITS) {
    fail('INVALID_CARD', `Suit out of range: ${suit}`, { suit });
  }
  return rank * NUM_SUITS + suit;
}

export function rankOf(card: Card): Rank {
  return card >> 2;
}

export function suitOf(card: Card): Suit {
  return card & 3;
}

export function isCard(value: unknown): value is Card {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < DECK_SIZE;
}

export function assertCard(card: Card): void {
  if (!isCard(card)) fail('INVALID_CARD', `Not a card: ${String(card)}`, { card });
}

export function cardToString(card: Card): string {
  assertCard(card);
  return `${RANK_CHARS[rankOf(card)]}${SUIT_CHARS[suitOf(card)]}`;
}

export function cardsToString(cards: readonly Card[], separator = ' '): string {
  return cards.map(cardToString).join(separator);
}

export function parseCard(text: string): Card {
  const trimmed = text.trim();
  if (trimmed.length !== 2) {
    fail('INVALID_CARD', `Expected a two-character card such as "As", got "${text}"`, { text });
  }
  const rank = RANK_CHARS.indexOf(trimmed[0]!.toUpperCase());
  const suit = SUIT_CHARS.indexOf(trimmed[1]!.toLowerCase());
  if (rank < 0) fail('INVALID_CARD', `Unknown rank in "${text}"`, { text });
  if (suit < 0) fail('INVALID_CARD', `Unknown suit in "${text}"`, { text });
  return makeCard(rank, suit);
}

/** Accepts "AsKd", "As Kd", "As,Kd" — whatever a human or a fixture writes. */
export function parseCards(text: string): Card[] {
  const compact = text.replace(/[\s,]+/g, '');
  if (compact.length % 2 !== 0) {
    fail('INVALID_CARD', `Card list has a trailing half-card: "${text}"`, { text });
  }
  const out: Card[] = [];
  for (let i = 0; i < compact.length; i += 2) {
    out.push(parseCard(compact.slice(i, i + 2)));
  }
  return out;
}

/** The 52 cards in canonical order. Never mutate — copy first. */
export const FULL_DECK: readonly Card[] = Object.freeze(
  Array.from({ length: DECK_SIZE }, (_, i) => i),
);

export function findDuplicate(cards: readonly Card[]): Card | null {
  const seen = new Set<Card>();
  for (const card of cards) {
    if (seen.has(card)) return card;
    seen.add(card);
  }
  return null;
}

/**
 * Guards the invariant the whole game rests on: no card appears twice across
 * hole cards, board, and burns. Called on every deal, not only in tests.
 */
export function assertNoDuplicates(cards: readonly Card[], context = 'cards'): void {
  for (const card of cards) assertCard(card);
  const duplicate = findDuplicate(cards);
  if (duplicate !== null) {
    fail('DUPLICATE_CARD', `Duplicate ${cardToString(duplicate)} in ${context}`, {
      card: duplicate,
      context,
    });
  }
}

/** Descending by rank, then by suit. Deterministic display order. */
export function sortCardsDesc(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => b - a);
}
