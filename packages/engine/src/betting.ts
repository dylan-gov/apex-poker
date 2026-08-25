import { fail } from './errors.js';
import type { ActionType, HandState, LegalActions, PlayerAction, SeatState } from './types.js';

export function seatAt(state: HandState, seat: number): SeatState {
  const found = state.seats[seat];
  if (!found) fail('PLAYER_NOT_FOUND', `Seat ${seat} is empty`, { seat });
  return found;
}

export function occupiedSeats(state: HandState): SeatState[] {
  return state.seats.filter((seat): seat is SeatState => seat !== null);
}

/** Seats still in the hand. */
export function liveSeats(state: HandState): SeatState[] {
  return occupiedSeats(state).filter((seat) => !seat.folded);
}

/** Seats that can still put chips in. Fewer than two means the betting is over. */
export function actingSeats(state: HandState): SeatState[] {
  return liveSeats(state).filter((seat) => !seat.allIn && seat.stack > 0);
}

export function potSoFar(state: HandState): number {
  return occupiedSeats(state).reduce((sum, seat) => sum + seat.committedTotal, 0);
}

const NO_ACTIONS = (seat: number): LegalActions => ({
  seat,
  canFold: false,
  canCheck: false,
  canCall: false,
  callAmount: 0,
  canBet: false,
  minBetTo: 0,
  canRaise: false,
  minRaiseTo: 0,
  maxRaiseTo: 0,
  canAllIn: false,
  allInTo: 0,
});

export function getLegalActions(state: HandState, seat: number): LegalActions {
  const player = seatAt(state, seat);
  if (player.folded || player.allIn || player.stack <= 0) return NO_ACTIONS(seat);
  if (state.phase === 'showdown' || state.phase === 'payout' || state.phase === 'complete') {
    return NO_ACTIONS(seat);
  }

  const toCall = Math.max(0, state.currentBet - player.committedThisStreet);
  const maxTo = player.committedThisStreet + player.stack;

  // A player who has already acted since the last full raise, and is now
  // facing only a short all-in, may call or fold but may not re-raise.
  const raiseAllowed = !player.actedSinceLastFullRaise || state.raiseReopened;

  const canBet = state.currentBet === 0;
  const minBetTo = Math.min(state.bigBlind, maxTo);
  const minRaiseTo = state.currentBet + state.lastRaiseSize;
  const allInIsAggressive = maxTo > state.currentBet;

  return {
    seat,
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount: Math.min(toCall, player.stack),
    canBet,
    minBetTo: canBet ? minBetTo : 0,
    canRaise: !canBet && raiseAllowed && maxTo >= minRaiseTo,
    minRaiseTo: !canBet && raiseAllowed && maxTo >= minRaiseTo ? minRaiseTo : 0,
    maxRaiseTo: maxTo,
    canAllIn: !allInIsAggressive || raiseAllowed,
    allInTo: maxTo,
  };
}

export interface ResolvedAction {
  readonly type: ActionType;
  /** Street contribution after the action. */
  readonly toAmount: number;
  /** Chips leaving the stack. */
  readonly chips: number;
  readonly isAllIn: boolean;
  /** Whether this reopens betting for players who have already acted. */
  readonly isFullRaise: boolean;
}

/**
 * Validates an action against the current state and normalises it to the
 * chips it actually moves. Everything the server needs to reject a malformed
 * or hostile client message happens here — nothing downstream re-checks.
 */
export function resolveAction(
  state: HandState,
  seat: number,
  action: PlayerAction,
): ResolvedAction {
  const player = seatAt(state, seat);
  const legal = getLegalActions(state, seat);

  if (state.actionSeat !== seat) {
    fail('NOT_YOUR_TURN', `Seat ${seat} acted out of turn`, {
      seat,
      actionSeat: state.actionSeat,
    });
  }
  if (player.folded) fail('INVALID_ACTION', `Seat ${seat} has folded`, { seat });
  if (player.allIn) fail('INVALID_ACTION', `Seat ${seat} is already all in`, { seat });

  switch (action.type) {
    case 'fold':
      if (!legal.canFold) fail('INVALID_ACTION', 'Fold is not available', { seat });
      return {
        type: 'fold',
        toAmount: player.committedThisStreet,
        chips: 0,
        isAllIn: false,
        isFullRaise: false,
      };

    case 'check':
      if (!legal.canCheck) {
        fail('INVALID_ACTION', `Cannot check facing a bet of ${legal.callAmount}`, {
          seat,
          callAmount: legal.callAmount,
        });
      }
      return {
        type: 'check',
        toAmount: player.committedThisStreet,
        chips: 0,
        isAllIn: false,
        isFullRaise: false,
      };

    case 'call': {
      if (!legal.canCall) fail('INVALID_ACTION', 'There is nothing to call', { seat });
      const chips = legal.callAmount;
      return {
        type: 'call',
        toAmount: player.committedThisStreet + chips,
        chips,
        isAllIn: chips === player.stack,
        isFullRaise: false,
      };
    }

    case 'allIn': {
      if (!legal.canAllIn) {
        fail('INVALID_ACTION', 'Betting is not reopened for this seat; call or fold', { seat });
      }
      const chips = player.stack;
      const toAmount = player.committedThisStreet + chips;
      const increment = toAmount - state.currentBet;
      return {
        type: 'allIn',
        toAmount,
        chips,
        isAllIn: true,
        isFullRaise: increment >= state.lastRaiseSize,
      };
    }

    case 'bet':
    case 'raise': {
      const requested = action.toAmount;
      if (requested === undefined || !Number.isInteger(requested) || requested <= 0) {
        fail('INVALID_AMOUNT', `${action.type} needs a positive whole "toAmount"`, {
          seat,
          toAmount: requested,
        });
      }
      if (requested > legal.maxRaiseTo) {
        fail('INSUFFICIENT_CHIPS', `Seat ${seat} cannot commit ${requested}`, {
          seat,
          requested,
          maximum: legal.maxRaiseTo,
        });
      }
      const isAllIn = requested === legal.allInTo;

      if (action.type === 'bet') {
        if (!legal.canBet) {
          fail('INVALID_ACTION', 'There is already a bet; raise instead', {
            seat,
            currentBet: state.currentBet,
          });
        }
        if (requested < legal.minBetTo && !isAllIn) {
          fail('INVALID_AMOUNT', `Minimum bet is ${legal.minBetTo}`, {
            seat,
            requested,
            minimum: legal.minBetTo,
          });
        }
      } else {
        if (legal.canBet) {
          fail('INVALID_ACTION', 'There is no bet to raise; bet instead', { seat });
        }
        if (requested <= state.currentBet) {
          fail('INVALID_AMOUNT', `A raise must exceed the current bet of ${state.currentBet}`, {
            seat,
            requested,
            currentBet: state.currentBet,
          });
        }
        if (isAllIn ? !legal.canAllIn : !legal.canRaise) {
          fail('INVALID_ACTION', 'Betting is not reopened for this seat; call or fold', { seat });
        }
        if (!isAllIn && requested < legal.minRaiseTo) {
          fail('INVALID_AMOUNT', `Minimum raise is to ${legal.minRaiseTo}`, {
            seat,
            requested,
            minimum: legal.minRaiseTo,
          });
        }
      }

      const chips = requested - player.committedThisStreet;
      const increment = requested - state.currentBet;
      return {
        type: action.type,
        toAmount: requested,
        chips,
        isAllIn,
        isFullRaise: increment >= state.lastRaiseSize,
      };
    }

    default:
      fail('INVALID_ACTION', `Unknown action type`, { seat, action });
  }
}

/**
 * A seat still owes action if it has not acted since the last full raise, or
 * if it has not matched the current bet. The big blind's option preflop falls
 * out of the first clause for free.
 */
export function needsToAct(state: HandState, player: SeatState): boolean {
  if (player.folded || player.allIn || player.stack <= 0) return false;
  return !player.actedSinceLastFullRaise || player.committedThisStreet < state.currentBet;
}

/** Next seat clockwise from `from` (exclusive) that still owes action. */
export function nextSeatToAct(state: HandState, from: number): number | null {
  for (let step = 1; step <= state.seatCount; step++) {
    const seat = (from + step) % state.seatCount;
    const player = state.seats[seat];
    if (player && needsToAct(state, player)) return seat;
  }
  return null;
}

/** First occupied seat clockwise from `from` (exclusive) matching `predicate`. */
export function nextSeatWhere(
  state: HandState,
  from: number,
  predicate: (player: SeatState) => boolean,
): number | null {
  for (let step = 1; step <= state.seatCount; step++) {
    const seat = (from + step) % state.seatCount;
    const player = state.seats[seat];
    if (player && predicate(player)) return seat;
  }
  return null;
}
