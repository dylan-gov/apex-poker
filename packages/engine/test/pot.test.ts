import { describe, expect, it } from 'vitest';
import { buildPots, findUncalledBet, totalPot } from '../src/pot.js';

const noneFolded = (count: number) => new Array<boolean>(count).fill(false);

/** Chips must never be created or destroyed by pot construction. */
function expectConserved(committed: readonly number[], folded: readonly boolean[]): void {
  const pots = buildPots(committed, folded);
  expect(totalPot(pots)).toBe(committed.reduce((sum, amount) => sum + amount, 0));
}

describe('pot construction', () => {
  it('makes one pot when nobody is all in', () => {
    const pots = buildPots([100, 100, 100], noneFolded(3));
    expect(pots).toEqual([{ amount: 300, eligibleSeats: [0, 1, 2] }]);
  });

  it('builds a side pot around a short all-in', () => {
    const committed = [50, 200, 200];
    const pots = buildPots(committed, noneFolded(3));
    expect(pots).toEqual([
      { amount: 150, eligibleSeats: [0, 1, 2] },
      { amount: 300, eligibleSeats: [1, 2] },
    ]);
    expectConserved(committed, noneFolded(3));
  });

  it('layers three simultaneous all-ins correctly', () => {
    const committed = [30, 80, 200, 200];
    const pots = buildPots(committed, noneFolded(4));
    expect(pots).toEqual([
      { amount: 120, eligibleSeats: [0, 1, 2, 3] },
      { amount: 150, eligibleSeats: [1, 2, 3] },
      { amount: 240, eligibleSeats: [2, 3] },
    ]);
    expectConserved(committed, noneFolded(4));
  });

  it('keeps a folded player’s chips in the pot but not their claim on it', () => {
    const committed = [100, 100, 100];
    const folded = [true, false, false];
    const pots = buildPots(committed, folded);
    expect(pots).toEqual([{ amount: 300, eligibleSeats: [1, 2] }]);
    expectConserved(committed, folded);
  });

  it('merges layers that nobody new can win', () => {
    // A player who folded for 20 creates a betting level, but not a side pot:
    // the same two players are eligible for every chip.
    const committed = [20, 100, 100];
    const folded = [true, false, false];
    expect(buildPots(committed, folded)).toEqual([{ amount: 220, eligibleSeats: [1, 2] }]);
  });

  it('never destroys chips even when the top layer has no eligible player', () => {
    // Unreachable in a legal betting sequence once uncalled bets are returned,
    // but a malformed input must fail safe rather than quietly lose chips.
    const committed = [100, 50];
    const folded = [true, false];
    const pots = buildPots(committed, folded);
    expect(totalPot(pots)).toBe(150);
    expect(pots.every((pot) => pot.eligibleSeats.length > 0)).toBe(true);
    expectConserved(committed, folded);
  });

  it('ignores empty seats', () => {
    const pots = buildPots([0, 100, 0, 100], [true, false, true, false]);
    expect(pots).toEqual([{ amount: 200, eligibleSeats: [1, 3] }]);
  });

  it('rejects mismatched inputs', () => {
    expect(() => buildPots([10, 10], [false])).toThrow(/same seats/);
  });
});

describe('uncalled bets', () => {
  it('returns the portion nobody could match', () => {
    expect(findUncalledBet([200, 50], [false, false])).toEqual({ seat: 0, amount: 150 });
    expect(findUncalledBet([50, 200], [false, false])).toEqual({ seat: 1, amount: 150 });
  });

  it('returns nothing when the bet was matched', () => {
    expect(findUncalledBet([100, 100], [false, false])).toBeNull();
    expect(findUncalledBet([0, 0, 0], [false, false, false])).toBeNull();
  });

  it('gives back the whole bet when everyone folds to it', () => {
    expect(findUncalledBet([100, 30], [false, true])).toEqual({ seat: 0, amount: 100 });
  });

  it('ignores folded players when deciding what was called', () => {
    // Seat 2 folded after putting in 100; seats 0 and 1 are all in for 40.
    expect(findUncalledBet([40, 40, 100], [false, false, true])).toBeNull();
  });
});
