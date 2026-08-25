import { fail } from './errors.js';
import { sha256Hex } from './sha256.js';

/**
 * The engine's single source of nondeterminism, injected by the caller.
 *
 * Production passes `secureRng()`. Tests pass `seededRng('anything')` and get
 * a hand that replays identically every time, which is what makes the state
 * machine testable at all (spec §7).
 */
export interface Rng {
  /** Uniform integer in [0, maxExclusive). Must be unbiased. */
  nextInt(maxExclusive: number): number;
}

function assertPositiveInteger(maxExclusive: number): void {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    fail('INVALID_AMOUNT', `nextInt bound must be a positive integer, got ${maxExclusive}`, {
      maxExclusive,
    });
  }
}

/**
 * Rejection sampling. `value % max` on its own is biased whenever max does not
 * divide 2^32 — small, but in a shuffle it is a real edge and exactly the kind
 * of thing a fairness audit looks for.
 */
function unbiased(next32: () => number, maxExclusive: number): number {
  assertPositiveInteger(maxExclusive);
  if (maxExclusive === 1) return 0;
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  let value = next32();
  while (value >= limit) value = next32();
  return value % maxExclusive;
}

interface CryptoLike {
  getRandomValues(array: Uint32Array): Uint32Array;
}

/**
 * Cryptographically secure RNG backed by Web Crypto, which is present in Node
 * 18+ and every browser. Deliberately not `node:crypto`: the engine stays
 * platform-agnostic so the same module runs in tests, on the server, and in a
 * future client-side hand replayer.
 */
export function secureRng(): Rng {
  const host = globalThis as unknown as { crypto?: CryptoLike };
  const webCrypto = host.crypto;
  if (!webCrypto || typeof webCrypto.getRandomValues !== 'function') {
    fail(
      'INVALID_STATE',
      'No Web Crypto available in this runtime. Pass an explicit Rng implementation.',
    );
  }
  const scratch = new Uint32Array(1);
  const next32 = (): number => {
    webCrypto.getRandomValues(scratch);
    return scratch[0]!;
  };
  return { nextInt: (maxExclusive) => unbiased(next32, maxExclusive) };
}

/**
 * Deterministic RNG (mulberry32, seeded through SHA-256 so that similar seed
 * strings do not produce correlated streams).
 *
 * For tests and hand replay only. It is not secure and must never deal a live
 * hand; `dealHand` takes the Rng as an argument precisely so that choice is
 * always explicit at the call site.
 */
export function seededRng(seed: string | number): Rng {
  const digest = sha256Hex(String(seed));
  let state = parseInt(digest.slice(0, 8), 16) >>> 0;
  const next32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };
  return { nextInt: (maxExclusive) => unbiased(next32, maxExclusive) };
}

/** Fisher–Yates. Returns a new array; the input is never mutated. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}
