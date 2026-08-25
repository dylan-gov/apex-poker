import { describe, expect, it } from 'vitest';
import {
  assertNoDuplicates,
  cardsToString,
  cardToString,
  DECK_SIZE,
  findDuplicate,
  FULL_DECK,
  makeCard,
  parseCard,
  parseCards,
  rankOf,
  sortCardsDesc,
  suitOf,
} from '../src/cards.js';
import { EngineError } from '../src/errors.js';

describe('cards', () => {
  it('round-trips every card through its string form', () => {
    for (const card of FULL_DECK) {
      expect(parseCard(cardToString(card))).toBe(card);
    }
    expect(FULL_DECK).toHaveLength(DECK_SIZE);
    expect(new Set(FULL_DECK).size).toBe(DECK_SIZE);
  });

  it('decomposes a card into rank and suit', () => {
    const aceOfSpades = parseCard('As');
    expect(rankOf(aceOfSpades)).toBe(12);
    expect(suitOf(aceOfSpades)).toBe(3);
    expect(makeCard(12, 3)).toBe(aceOfSpades);

    const deuceOfClubs = parseCard('2c');
    expect(deuceOfClubs).toBe(0);
    expect(rankOf(deuceOfClubs)).toBe(0);
    expect(suitOf(deuceOfClubs)).toBe(0);
  });

  it('accepts the shapes a fixture or a human actually writes', () => {
    const expected = parseCards('AsKd');
    expect(parseCards('As Kd')).toEqual(expected);
    expect(parseCards('As,Kd')).toEqual(expected);
    expect(parseCards('as kD')).toEqual(expected);
    expect(cardsToString(expected)).toBe('As Kd');
  });

  it('rejects malformed input rather than guessing', () => {
    expect(() => parseCard('Xx')).toThrow(EngineError);
    expect(() => parseCard('A')).toThrow(EngineError);
    expect(() => parseCard('1s')).toThrow(EngineError);
    expect(() => parseCards('AsK')).toThrow(EngineError);
    expect(() => makeCard(13, 0)).toThrow(EngineError);
    expect(() => makeCard(0, 4)).toThrow(EngineError);
  });

  it('detects duplicates, which is the invariant the whole game rests on', () => {
    const clean = parseCards('AsKdQh');
    expect(findDuplicate(clean)).toBeNull();
    expect(() => assertNoDuplicates(clean)).not.toThrow();

    const dirty = parseCards('AsKdAs');
    expect(findDuplicate(dirty)).toBe(parseCard('As'));
    expect(() => assertNoDuplicates(dirty, 'hole cards')).toThrow(/Duplicate As in hole cards/);
  });

  it('sorts descending without mutating the input', () => {
    const cards = parseCards('2c As 7h');
    const sorted = sortCardsDesc(cards);
    expect(cardsToString(sorted)).toBe('As 7h 2c');
    expect(cardsToString(cards)).toBe('2c As 7h');
  });
});
