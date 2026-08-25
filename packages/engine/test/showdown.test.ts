import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/cards.js';
import { evaluate, type EvaluatedHand } from '../src/hand-evaluator.js';
import type { Pot } from '../src/pot.js';
import {
  awardPots,
  awardUncontested,
  evaluateShowdown,
  seatOrderFromButton,
} from '../src/showdown.js';

const handsFrom = (entries: Record<number, string>): Map<number, EvaluatedHand> =>
  new Map(
    Object.entries(entries).map(([seat, cards]) => [Number(seat), evaluate(parseCards(cards))]),
  );

const totalAwarded = (awards: readonly { amount: number }[]): number =>
  awards.reduce((sum, award) => sum + award.amount, 0);

describe('seat order from the button', () => {
  it('starts immediately left of the button and wraps', () => {
    expect(seatOrderFromButton([0, 1, 2, 3, 4, 5], 3, 6)).toEqual([4, 5, 0, 1, 2, 3]);
    expect(seatOrderFromButton([0, 2, 5], 5, 6)).toEqual([0, 2, 5]);
    expect(seatOrderFromButton([1, 4], 0, 6)).toEqual([1, 4]);
  });
});

describe('awarding pots', () => {
  const pots: Pot[] = [{ amount: 300, eligibleSeats: [0, 1, 2] }];

  it('gives the pot to the best hand', () => {
    const awards = awardPots(
      pots,
      handsFrom({ 0: 'AcAdKhQsJc', 1: 'KcKdQhJs9c', 2: '2c3d4h5s7c' }),
      0,
      6,
    );
    expect(awards).toEqual([{ potIndex: 0, seat: 0, amount: 300 }]);
  });

  it('splits an even pot exactly', () => {
    const awards = awardPots(pots, handsFrom({ 0: 'AcAdKhQsJc', 1: 'AhAsKcQdJh' }), 0, 6);
    expect(awards).toEqual([
      { potIndex: 0, seat: 1, amount: 150 },
      { potIndex: 0, seat: 0, amount: 150 },
    ]);
  });

  it('gives the odd chip to the first winner left of the button', () => {
    const oddPot: Pot[] = [{ amount: 301, eligibleSeats: [0, 1] }];
    const hands = handsFrom({ 0: 'AcAdKhQsJc', 1: 'AhAsKcQdJh' });

    // Button on seat 0 → seat 1 is first to its left, so seat 1 gets the extra.
    expect(awardPots(oddPot, hands, 0, 6)).toEqual([
      { potIndex: 0, seat: 1, amount: 151 },
      { potIndex: 0, seat: 0, amount: 150 },
    ]);

    // Move the button and the extra chip moves with it.
    expect(awardPots(oddPot, hands, 1, 6)).toEqual([
      { potIndex: 0, seat: 0, amount: 151 },
      { potIndex: 0, seat: 1, amount: 150 },
    ]);
  });

  it('spreads two odd chips across a three-way chop in button order', () => {
    const oddPot: Pot[] = [{ amount: 302, eligibleSeats: [0, 1, 2] }];
    const board = 'AsKsQsJd9h';
    const awards = awardPots(
      oddPot,
      handsFrom({ 0: `2c3d${board}`, 1: `4c5d${board}`, 2: `6c7d${board}` }),
      2,
      6,
    );
    expect(awards).toEqual([
      { potIndex: 0, seat: 0, amount: 101 },
      { potIndex: 0, seat: 1, amount: 101 },
      { potIndex: 0, seat: 2, amount: 100 },
    ]);
    expect(totalAwarded(awards)).toBe(302);
  });

  it('lets a short stack win the main pot while someone else takes the side pot', () => {
    const layered: Pot[] = [
      { amount: 150, eligibleSeats: [0, 1, 2] },
      { amount: 300, eligibleSeats: [1, 2] },
    ];
    const awards = awardPots(
      layered,
      handsFrom({
        0: 'AcAdAhAsKc', // quads: best hand, but only eligible for the main pot
        1: 'KcKdKhKs9c', // quads kings: wins the side pot
        2: '2c3d4h5s7c',
      }),
      0,
      6,
    );
    expect(awards).toEqual([
      { potIndex: 0, seat: 0, amount: 150 },
      { potIndex: 1, seat: 1, amount: 300 },
    ]);
    expect(totalAwarded(awards)).toBe(450);
  });

  it('refuses to award a pot with no eligible hand rather than losing the chips', () => {
    expect(() => awardPots(pots, handsFrom({ 5: 'AcAdKhQsJc' }), 0, 6)).toThrow(/no eligible seat/);
  });

  it('hands every pot to the last player standing when everyone folds', () => {
    const layered: Pot[] = [
      { amount: 150, eligibleSeats: [0, 1] },
      { amount: 0, eligibleSeats: [1] },
    ];
    expect(awardUncontested(layered, 1)).toEqual([{ potIndex: 0, seat: 1, amount: 150 }]);
  });
});

describe('evaluating a showdown', () => {
  it('describes each contender’s best hand', () => {
    const entries = evaluateShowdown(
      [
        { seat: 2, holeCards: parseCards('AcAd') },
        { seat: 5, holeCards: parseCards('7c7d') },
      ],
      parseCards('Ah7h2s9cKd'),
    );
    expect(entries.map((entry) => entry.description)).toEqual([
      'Three of a Kind, Aces',
      'Three of a Kind, Sevens',
    ]);
    expect(entries[0]!.hand.value).toBeGreaterThan(entries[1]!.hand.value);
  });
});
