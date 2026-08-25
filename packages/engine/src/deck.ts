import { assertNoDuplicates, DECK_SIZE, FULL_DECK, type Card } from './cards.js';
import { fail } from './errors.js';
import { shuffle, type Rng } from './rng.js';

/**
 * A shuffled deck plus a cursor. Kept as plain data (no class, no closure) so
 * hand state serialises straight to JSON for persistence and replay.
 */
export interface Shoe {
  readonly cards: Card[];
  index: number;
}

export function createDeck(): Card[] {
  return [...FULL_DECK];
}

export function createShoe(rng: Rng): Shoe {
  const cards = shuffle(FULL_DECK, rng);
  assertNoDuplicates(cards, 'shuffled deck');
  if (cards.length !== DECK_SIZE) {
    fail('INVALID_STATE', `Shuffle produced ${cards.length} cards, expected ${DECK_SIZE}`);
  }
  return { cards, index: 0 };
}

/** Builds a shoe from a fixed card order. Fixtures and hand replay only. */
export function createShoeFromOrder(order: readonly Card[]): Shoe {
  assertNoDuplicates(order, 'fixed deck order');
  return { cards: [...order], index: 0 };
}

export function remaining(shoe: Shoe): number {
  return shoe.cards.length - shoe.index;
}

export function draw(shoe: Shoe): Card {
  if (shoe.index >= shoe.cards.length) {
    fail('DECK_EXHAUSTED', 'Attempted to draw past the end of the deck', {
      drawn: shoe.index,
      size: shoe.cards.length,
    });
  }
  return shoe.cards[shoe.index++]!;
}

export function drawMany(shoe: Shoe, count: number): Card[] {
  if (!Number.isInteger(count) || count < 0) {
    fail('INVALID_AMOUNT', `Cannot draw ${count} cards`, { count });
  }
  const out: Card[] = [];
  for (let i = 0; i < count; i++) out.push(draw(shoe));
  return out;
}

/**
 * Real poker burns a card before each community street. Reproducing it here
 * costs nothing and means a revealed seed replays the deal exactly as it
 * happened, card for card — which is the whole point of the commitment.
 */
export function burn(shoe: Shoe): Card {
  return draw(shoe);
}
