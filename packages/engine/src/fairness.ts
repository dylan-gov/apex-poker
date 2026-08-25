import { sha256Hex } from './sha256.js';

/**
 * Commit–reveal shuffle verification.
 *
 * Before a hand is dealt the server publishes `commitment = SHA-256(handId ‖ seed)`.
 * After the hand completes it publishes the seed. Any player can recompute the
 * hash and confirm the deck order was fixed before a single card was seen —
 * which is what makes the business plan's promise to "publish shuffle
 * verification documentation" a real claim rather than a marketing line.
 *
 * What this is NOT: an independent RNG or RTP certification. It proves the
 * server did not change the deck mid-hand. It does not prove the shuffle was
 * fair to begin with — that requires an accredited testing lab, and nothing in
 * this product may describe itself as certified or audited until one has
 * signed off.
 */
export interface ShuffleCommitment {
  handId: string;
  commitment: string;
}

const SEPARATOR = '␟';

export function commitToShuffle(handId: string, seed: string): ShuffleCommitment {
  return { handId, commitment: sha256Hex(`${handId}${SEPARATOR}${seed}`) };
}

export function verifyShuffleCommitment(
  commitment: string,
  handId: string,
  revealedSeed: string,
): boolean {
  return commitToShuffle(handId, revealedSeed).commitment === commitment;
}

/**
 * A seed with enough entropy that it cannot be guessed before the reveal.
 * Uses the caller's Rng so the engine keeps no ambient randomness of its own.
 */
export function generateSeed(nextInt: (maxExclusive: number) => number): string {
  let seed = '';
  for (let i = 0; i < 8; i++) {
    seed += nextInt(0x10000).toString(16).padStart(4, '0');
  }
  return seed;
}
