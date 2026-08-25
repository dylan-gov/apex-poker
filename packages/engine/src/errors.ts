/**
 * Structured errors for the poker engine.
 *
 * Every rejection carries a stable machine-readable `code` so the transport
 * layer can map it to a wire error without string matching, and so nothing
 * ever needs to leak a stack trace to a player (spec §27).
 *
 * Transport-level codes (TABLE_NOT_FOUND, UNAUTHORIZED, RATE_LIMITED,
 * CONNECTION_LOST) deliberately do not live here — the engine has no concept
 * of connections or identity. They belong to the protocol package (M4).
 */
export type EngineErrorCode =
  | 'INVALID_ACTION'
  | 'NOT_YOUR_TURN'
  | 'INSUFFICIENT_CHIPS'
  | 'PLAYER_NOT_FOUND'
  | 'HAND_ALREADY_COMPLETE'
  | 'HAND_NOT_COMPLETE'
  | 'INVALID_AMOUNT'
  | 'INVALID_CARD'
  | 'DUPLICATE_CARD'
  | 'DECK_EXHAUSTED'
  | 'SEAT_TAKEN'
  | 'NOT_ENOUGH_PLAYERS'
  | 'STALE_ACTION'
  | 'INVALID_STATE';

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: EngineErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.details = details;
    // Preserves `instanceof` across the ES2022 target.
    Object.setPrototypeOf(this, EngineError.prototype);
  }

  /** Safe to send to a client: no stack, no internal state. */
  toWire(): { code: EngineErrorCode; message: string; details: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: { ...this.details } };
  }
}

export function fail(
  code: EngineErrorCode,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new EngineError(code, message, details);
}
