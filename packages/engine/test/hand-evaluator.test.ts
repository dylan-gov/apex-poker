import { describe, expect, it } from 'vitest';
import { cardsToString, FULL_DECK, parseCards, rankOf, type Card } from '../src/cards.js';
import { EngineError } from '../src/errors.js';
import {
  compareHands,
  describeHand,
  evaluate,
  HandCategory,
  isRoyalFlush,
} from '../src/hand-evaluator.js';
import { seededRng, shuffle } from '../src/rng.js';
import { combinations, compareRef, refBest } from './reference-evaluator.js';

const hand = (text: string) => evaluate(parseCards(text));

describe('hand evaluator — categories', () => {
  it('names every category correctly', () => {
    expect(hand('AsKsQsJsTs').category).toBe(HandCategory.StraightFlush);
    expect(describeHand(hand('AsKsQsJsTs'))).toBe('Royal Flush');
    expect(isRoyalFlush(hand('AsKsQsJsTs'))).toBe(true);

    expect(describeHand(hand('9s8s7s6s5s'))).toBe('Nine-high Straight Flush');
    expect(describeHand(hand('7c7d7h7s2c'))).toBe('Four of a Kind, Sevens');
    expect(describeHand(hand('KcKdKh3s3c'))).toBe('Full House, Kings full of Threes');
    expect(describeHand(hand('Ah9h7h4h2h'))).toBe('Ace-high Flush');
    expect(describeHand(hand('9c8d7h6s5c'))).toBe('Nine-high Straight');
    expect(describeHand(hand('QcQdQh8s2c'))).toBe('Three of a Kind, Queens');
    expect(describeHand(hand('JcJd4h4s9c'))).toBe('Two Pair, Jacks and Fours');
    expect(describeHand(hand('5c5dKhQs2c'))).toBe('Pair of Fives');
    expect(describeHand(hand('AcJd9h6s3c'))).toBe('Ace High');
  });

  it('ranks the categories in the right order', () => {
    const ascending = [
      'AcJd9h6s3c', // high card
      '5c5dKhQs2c', // pair
      'JcJd4h4s9c', // two pair
      'QcQdQh8s2c', // trips
      '9c8d7h6s5c', // straight
      'Ah9h7h4h2h', // flush
      'KcKdKh3s3c', // full house
      '7c7d7h7s2c', // quads
      '9s8s7s6s5s', // straight flush
    ].map(hand);

    for (let i = 1; i < ascending.length; i++) {
      expect(compareHands(ascending[i]!, ascending[i - 1]!)).toBeGreaterThan(0);
    }
  });
});

describe('hand evaluator — the awkward cases', () => {
  it('treats A-2-3-4-5 as a five-high straight, not an ace-high one', () => {
    const wheel = hand('Ac2d3h4s5c');
    expect(wheel.category).toBe(HandCategory.Straight);
    expect(describeHand(wheel)).toBe('Five-high Straight');
    expect(compareHands(wheel, hand('2c3d4h5s6c'))).toBeLessThan(0);
    expect(compareHands(wheel, hand('AcAdKhKsQc'))).toBeGreaterThan(0);
  });

  it('recognises the steel wheel', () => {
    const steelWheel = hand('As2s3s4s5s');
    expect(steelWheel.category).toBe(HandCategory.StraightFlush);
    expect(isRoyalFlush(steelWheel)).toBe(false);
    expect(compareHands(steelWheel, hand('6s5s4s3s2s'))).toBeLessThan(0);
  });

  it('does not read a straight across a gap', () => {
    expect(hand('Ac2d3h4s6c').category).toBe(HandCategory.HighCard);
    expect(hand('AcKdQhJs9c').category).toBe(HandCategory.HighCard);
  });

  it('compares kickers, not just the made hand', () => {
    expect(compareHands(hand('AcAdKh7s2c'), hand('AcAdQh7s2c'))).toBeGreaterThan(0);
    expect(compareHands(hand('AcAdKhQs2c'), hand('AcAdKhQs3c'))).toBeLessThan(0);
    // Two pair: the fifth card is the kicker even when a third pair is present.
    expect(compareHands(hand('AcAdKhKs9c9d'), hand('AcAdKhKs8c8d'))).toBeGreaterThan(0);
  });

  it('finds a genuine tie when the board plays', () => {
    const board = 'AsKsQsJd9h';
    const a = evaluate(parseCards(`2c3d${board}`));
    const b = evaluate(parseCards(`4c5d${board}`));
    expect(compareHands(a, b)).toBe(0);
    expect(a.value).toBe(b.value);
  });

  it('picks the best five out of seven', () => {
    // Trips on board plus a pair in hand is a full house, not trips.
    const sevenCards = parseCards('9c9d 5s5h5d Kc2c');
    const best = evaluate(sevenCards);
    expect(best.category).toBe(HandCategory.FullHouse);
    expect(describeHand(best)).toBe('Full House, Fives full of Nines');
    expect(best.cards).toHaveLength(5);
    expect(new Set(best.cards).size).toBe(5);
    for (const card of best.cards) expect(sevenCards).toContain(card);
  });

  it('prefers the higher full house when two are available', () => {
    const best = evaluate(parseCards('AcAdAh KcKd 2s2h'));
    expect(describeHand(best)).toBe('Full House, Aces full of Kings');
  });

  it('uses the top five of a six-card flush', () => {
    const best = evaluate(parseCards('AhKh9h7h4h2h 3c'));
    expect(best.category).toBe(HandCategory.Flush);
    expect(cardsToString(best.cards)).toBe('Ah Kh 9h 7h 4h');
  });

  it('rejects hands it cannot evaluate', () => {
    expect(() => evaluate(parseCards('AsKsQs'))).toThrow(EngineError);
    expect(() => evaluate(parseCards('AsKsQsJsTs9s8s7s'))).toThrow(EngineError);
    expect(() => evaluate(parseCards('AsAsKsQsJs'))).toThrow(/Duplicate/);
  });
});

describe('hand evaluator — cross-checked against an independent implementation', () => {
  it('agrees on every five-card hand from two exhaustive 20-card subsets', () => {
    // Deuce-to-five plus aces covers the wheel and the steel wheel; ten-to-ace
    // covers broadway and the royal. 15,504 hands each, every one compared
    // against a brute-force evaluator that shares no code with the one under
    // test.
    const subsets = [
      FULL_DECK.filter((card) => [0, 1, 2, 3, 12].includes(rankOf(card))),
      FULL_DECK.filter((card) => rankOf(card) >= 8),
    ];

    let checked = 0;
    for (const subset of subsets) {
      expect(subset).toHaveLength(20);
      const evaluated: { fast: number; reference: ReturnType<typeof refBest> }[] = [];

      for (const combo of combinations(subset, 5)) {
        const fast = evaluate(combo);
        const reference = refBest(combo);
        expect(fast.category).toBe(reference.category);
        evaluated.push({ fast: fast.value, reference });
        checked++;
      }

      // Ordering, not just category: sample pairs across the whole subset and
      // require both implementations to agree on who wins, including chops.
      for (let i = 0; i < evaluated.length; i += 37) {
        for (let j = 0; j < evaluated.length; j += 911) {
          const a = evaluated[i]!;
          const b = evaluated[j]!;
          expect(Math.sign(a.fast - b.fast)).toBe(Math.sign(compareRef(a.reference, b.reference)));
        }
      }
    }
    expect(checked).toBe(31_008);
  });

  it('agrees on the category of random seven-card hands', () => {
    const rng = seededRng('seven-card-categories');
    const seen = new Set<number>();
    for (let i = 0; i < 30_000; i++) {
      const cards: Card[] = shuffle(FULL_DECK, rng).slice(0, 7);
      const fast = evaluate(cards);
      expect(fast.category).toBe(refBest(cards).category);
      expect(fast.cards).toHaveLength(5);
      expect(new Set(fast.cards).size).toBe(5);
      seen.add(fast.category);
    }
    // Every category should turn up in 30,000 deals except, occasionally, the
    // rarest — assert we exercised at least eight of the nine.
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  it('orders random seven-card hands the same way the reference does', () => {
    // This is the property that actually matters: not the encoding, but who
    // wins. Ties must agree too, or split pots are wrong.
    const rng = seededRng('seven-card-ordering');
    let ties = 0;
    for (let i = 0; i < 30_000; i++) {
      const shuffled = shuffle(FULL_DECK, rng);
      const board = shuffled.slice(0, 5);
      const a = [...board, ...shuffled.slice(5, 7)];
      const b = [...board, ...shuffled.slice(7, 9)];

      const fast = Math.sign(compareHands(evaluate(a), evaluate(b)));
      const reference = Math.sign(compareRef(refBest(a), refBest(b)));
      expect(fast).toBe(reference);
      if (fast === 0) ties++;
    }
    // Shared boards produce plenty of chops; if we saw none, the test would
    // not be exercising tie handling at all.
    expect(ties).toBeGreaterThan(100);
  });
});
