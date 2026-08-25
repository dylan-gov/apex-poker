import { describe, expect, it } from 'vitest';
import { commitToShuffle, generateSeed, verifyShuffleCommitment } from '../src/fairness.js';
import { seededRng } from '../src/rng.js';

describe('shuffle commitment', () => {
  it('verifies a seed that was actually committed to', () => {
    const { commitment } = commitToShuffle('hand-001', 'abc123');
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyShuffleCommitment(commitment, 'hand-001', 'abc123')).toBe(true);
  });

  it('rejects a different seed, which is the entire point', () => {
    const { commitment } = commitToShuffle('hand-001', 'abc123');
    expect(verifyShuffleCommitment(commitment, 'hand-001', 'abc124')).toBe(false);
    expect(verifyShuffleCommitment(commitment, 'hand-002', 'abc123')).toBe(false);
  });

  it('cannot be forged by shifting characters between hand id and seed', () => {
    // Without a separator, commit('ab', 'c') and commit('a', 'bc') would collide.
    const a = commitToShuffle('ab', 'c').commitment;
    const b = commitToShuffle('a', 'bc').commitment;
    expect(a).not.toBe(b);
  });

  it('generates seeds with enough entropy to be unguessable', () => {
    const rng = seededRng('seed-source');
    const seeds = new Set(Array.from({ length: 200 }, () => generateSeed((n) => rng.nextInt(n))));
    expect(seeds.size).toBe(200);
    for (const seed of seeds) expect(seed).toMatch(/^[0-9a-f]{32}$/);
  });
});
