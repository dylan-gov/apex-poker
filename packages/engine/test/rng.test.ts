import { describe, expect, it } from 'vitest';
import { FULL_DECK } from '../src/cards.js';
import { EngineError } from '../src/errors.js';
import { secureRng, seededRng, shuffle } from '../src/rng.js';

describe('rng', () => {
  it('is deterministic for a given seed and different across seeds', () => {
    const a = Array.from({ length: 200 }, () => seededRng('table-7/hand-42').nextInt(52));
    const first = seededRng('table-7/hand-42');
    const second = seededRng('table-7/hand-42');
    const third = seededRng('table-7/hand-43');

    expect(Array.from({ length: 200 }, () => first.nextInt(52))).toEqual(
      Array.from({ length: 200 }, () => second.nextInt(52)),
    );
    expect(a[0]).toBe(seededRng('table-7/hand-42').nextInt(52));
    expect(Array.from({ length: 200 }, () => third.nextInt(52))).not.toEqual(
      Array.from({ length: 200 }, () => seededRng('table-7/hand-42').nextInt(52)),
    );
  });

  it('stays inside the requested bound', () => {
    const rng = seededRng('bounds');
    for (let bound = 1; bound <= 64; bound++) {
      for (let i = 0; i < 50; i++) {
        const value = rng.nextInt(bound);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(bound);
      }
    }
  });

  it('rejects nonsensical bounds instead of returning nonsense', () => {
    const rng = seededRng('bad-bounds');
    expect(() => rng.nextInt(0)).toThrow(EngineError);
    expect(() => rng.nextInt(-3)).toThrow(EngineError);
    expect(() => rng.nextInt(2.5)).toThrow(EngineError);
  });

  it('distributes roughly evenly across a small range', () => {
    const rng = seededRng('distribution');
    const buckets = new Array<number>(13).fill(0);
    const draws = 130_000;
    for (let i = 0; i < draws; i++) buckets[rng.nextInt(13)]! += 1;
    const expected = draws / 13;
    for (const count of buckets) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.05);
    }
  });

  it('shuffles into a permutation without mutating the source', () => {
    const shuffled = shuffle(FULL_DECK, seededRng('shuffle'));
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled).size).toBe(52);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([...FULL_DECK]);
    expect(shuffled).not.toEqual([...FULL_DECK]);
    expect(FULL_DECK[0]).toBe(0);
  });

  it('moves cards away from their starting positions', () => {
    // A shuffle that leaves most cards in place would pass a permutation check
    // but would be catastrophic in a real game.
    let totalFixedPoints = 0;
    for (let trial = 0; trial < 40; trial++) {
      const shuffled = shuffle(FULL_DECK, seededRng(`trial-${trial}`));
      totalFixedPoints += shuffled.filter((card, index) => card === index).length;
    }
    // A uniform random permutation of 52 cards averages exactly one fixed
    // point, so 40 trials should land near 40, nowhere near 52 per trial.
    expect(totalFixedPoints / 40).toBeLessThan(4);
  });

  it('provides a secure source in this runtime', () => {
    const rng = secureRng();
    const values = new Set(Array.from({ length: 500 }, () => rng.nextInt(1000)));
    expect(values.size).toBeGreaterThan(300);
  });
});
