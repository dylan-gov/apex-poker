import { describe, expect, it } from 'vitest';
import { cardsToString, DECK_SIZE, parseCards } from '../src/cards.js';
import {
  burn,
  createDeck,
  createShoe,
  createShoeFromOrder,
  draw,
  drawMany,
  remaining,
} from '../src/deck.js';
import { EngineError } from '../src/errors.js';
import { seededRng } from '../src/rng.js';

describe('deck', () => {
  it('builds a complete 52-card deck with no duplicates', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(DECK_SIZE);
    expect(new Set(deck).size).toBe(DECK_SIZE);
  });

  it('shuffles into a full deck and tracks the cursor', () => {
    const shoe = createShoe(seededRng('deck-test'));
    expect(shoe.cards).toHaveLength(DECK_SIZE);
    expect(new Set(shoe.cards).size).toBe(DECK_SIZE);
    expect(remaining(shoe)).toBe(52);

    const first = draw(shoe);
    expect(remaining(shoe)).toBe(51);
    const next = drawMany(shoe, 4);
    expect(next).toHaveLength(4);
    expect(next).not.toContain(first);
    expect(remaining(shoe)).toBe(47);
  });

  it('deals a fixed order for replay', () => {
    const shoe = createShoeFromOrder(parseCards('AsKsQsJsTs'));
    expect(cardsToString(drawMany(shoe, 5))).toBe('As Ks Qs Js Ts');
    expect(remaining(shoe)).toBe(0);
  });

  it('refuses to deal a deck containing a duplicate', () => {
    expect(() => createShoeFromOrder(parseCards('AsKsAs'))).toThrow(EngineError);
  });

  it('fails loudly instead of dealing past the end', () => {
    const shoe = createShoeFromOrder(parseCards('As'));
    expect(draw(shoe)).toBeDefined();
    expect(() => draw(shoe)).toThrow(/past the end of the deck/);
    expect(() => drawMany(shoe, 1)).toThrow(EngineError);
  });

  it('rejects a negative draw count', () => {
    const shoe = createShoe(seededRng('negative'));
    expect(() => drawMany(shoe, -1)).toThrow(EngineError);
    expect(drawMany(shoe, 0)).toEqual([]);
  });

  it('burns a card off the top', () => {
    const shoe = createShoeFromOrder(parseCards('AsKsQs'));
    const burned = burn(shoe);
    expect(cardsToString([burned])).toBe('As');
    expect(remaining(shoe)).toBe(2);
  });
});
