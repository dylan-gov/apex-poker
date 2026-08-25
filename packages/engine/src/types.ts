import type { Card } from './cards.js';
import type { Shoe } from './deck.js';
import type { EvaluatedHand } from './hand-evaluator.js';
import type { Pot } from './pot.js';
import type { PotAward } from './showdown.js';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type HandPhase = Street | 'showdown' | 'payout' | 'complete';

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn';
export type LoggedActionType = ActionType | 'postAnte' | 'postSmallBlind' | 'postBigBlind';

/**
 * `toAmount` is the total this seat's street contribution becomes — "raise to
 * 300", not "raise by 300". Every real poker client speaks in totals, and it
 * removes the ambiguity that produces off-by-one-bet bugs. Ignored by fold,
 * check, call, and allIn, which have only one legal size.
 */
export interface PlayerAction {
  readonly type: ActionType;
  readonly toAmount?: number;
}

export interface SeatState {
  seat: number;
  playerId: string;
  stack: number;
  startingStack: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  committedThisStreet: number;
  committedTotal: number;
  /**
   * Whether this seat has acted since the last full raise. Drives both round
   * completion and the reopen rule, so it is reset for everyone else whenever
   * a full raise lands.
   */
  actedSinceLastFullRaise: boolean;
  won: number;
}

export interface LoggedAction {
  readonly index: number;
  readonly street: Street;
  readonly seat: number;
  readonly playerId: string;
  readonly type: LoggedActionType;
  /** Chips this action moved from stack to pot. */
  readonly amount: number;
  /** Street contribution after the action. */
  readonly toAmount: number;
  readonly potAfter: number;
}

export interface HandResult {
  readonly seat: number;
  readonly playerId: string;
  readonly holeCards: readonly Card[];
  readonly startingStack: number;
  readonly endingStack: number;
  readonly net: number;
  readonly folded: boolean;
  readonly wentToShowdown: boolean;
  readonly hand?: EvaluatedHand;
  readonly handDescription?: string;
}

export interface HandState {
  readonly handId: string;
  readonly handNumber: number;
  readonly seatCount: number;
  readonly buttonSeat: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly ante: number;

  phase: HandPhase;
  seats: (SeatState | null)[];
  shoe: Shoe;
  burned: Card[];
  board: Card[];

  /** Highest street contribution anyone has made. */
  currentBet: number;
  /** Size of the last full raise. The minimum legal raise increment. */
  lastRaiseSize: number;
  /**
   * False once a short all-in has capped the action: seats that already acted
   * may then only call or fold, which is the standard no-limit reopen rule.
   */
  raiseReopened: boolean;
  actionSeat: number | null;
  aggressorSeat: number | null;

  pots: Pot[];
  awards: PotAward[];
  actions: LoggedAction[];
  results: HandResult[];

  /**
   * Increments on every accepted action. A client must echo the seq it acted
   * on; a stale value is rejected, which is also what makes duplicate submits
   * harmless (spec §19).
   */
  seq: number;

  /** SHA-256 of handId ‖ seed, published before the deal. */
  readonly commitment?: string;
  /** Revealed only once the hand is complete. */
  seed?: string;
}

export interface SeatSetup {
  readonly seat: number;
  readonly playerId: string;
  readonly stack: number;
}

export interface StartHandOptions {
  readonly handId: string;
  readonly handNumber: number;
  readonly seatCount: number;
  readonly buttonSeat: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly ante?: number;
  readonly players: readonly SeatSetup[];
  readonly shoe: Shoe;
  readonly commitment?: string;
  readonly seed?: string;
}

export interface LegalActions {
  readonly seat: number;
  readonly canFold: boolean;
  readonly canCheck: boolean;
  readonly canCall: boolean;
  /** Chips needed to call, already capped at the seat's stack. */
  readonly callAmount: number;
  readonly canBet: boolean;
  readonly minBetTo: number;
  readonly canRaise: boolean;
  readonly minRaiseTo: number;
  readonly maxRaiseTo: number;
  readonly canAllIn: boolean;
  readonly allInTo: number;
}

/**
 * Hand-level events. Table-level events from spec §9 (TABLE_STATE,
 * PLAYER_JOINED, PLAYER_LEFT, CHAT_MESSAGE) belong to the game server in M4 —
 * the engine has no concept of connections, seats emptying, or chat.
 */
export type EngineEvent =
  | {
      type: 'HAND_STARTED';
      handId: string;
      handNumber: number;
      buttonSeat: number;
      smallBlind: number;
      bigBlind: number;
      commitment?: string;
    }
  | {
      type: 'BLINDS_POSTED';
      posts: readonly { seat: number; kind: 'ante' | 'smallBlind' | 'bigBlind'; amount: number }[];
    }
  | { type: 'CARDS_DEALT'; seats: readonly number[] }
  | { type: 'ACTION_REQUIRED'; seat: number; seq: number; legal: LegalActions }
  | {
      type: 'PLAYER_ACTION';
      seat: number;
      action: LoggedActionType;
      amount: number;
      toAmount: number;
    }
  | { type: 'FLOP_REVEALED'; cards: readonly Card[] }
  | { type: 'TURN_REVEALED'; card: Card }
  | { type: 'RIVER_REVEALED'; card: Card }
  | {
      type: 'SHOWDOWN';
      entries: readonly { seat: number; holeCards: readonly Card[]; description: string }[];
    }
  | { type: 'POT_AWARDED'; potIndex: number; seat: number; amount: number }
  | { type: 'HAND_COMPLETED'; results: readonly HandResult[]; seed?: string };
