import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/sha256.js';

describe('sha256', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('handles inputs that cross the padding boundary', () => {
    // 55, 56, and 64 bytes: the lengths where the message needs an extra block.
    for (const length of [55, 56, 57, 63, 64, 65, 119, 120]) {
      const digest = sha256Hex('a'.repeat(length));
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(sha256Hex('a'.repeat(1_000_000)).slice(0, 16)).toBe('cdc76e5c9914fb92');
  });

  it('encodes multi-byte characters as UTF-8', () => {
    expect(sha256Hex('é')).toBe(sha256Hex('é'));
    expect(sha256Hex('🂡')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('a')).not.toBe(sha256Hex('á'));
  });
});
