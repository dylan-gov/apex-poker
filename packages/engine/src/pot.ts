import { fail } from './errors.js';

export interface Pot {
  /** Chips in this pot. */
  readonly amount: number;
  /** Seats that may win it, ascending. Folded seats never appear. */
  readonly eligibleSeats: readonly number[];
}

function sameSeats(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((seat, i) => seat === b[i]);
}

/**
 * Builds the main pot and every side pot from each seat's total contribution.
 *
 * Contributions are layered at each distinct amount: every chip a player put
 * in above the previous layer belongs to the pot for that layer, and only
 * players who reached that layer and did not fold can win it. Folded players'
 * chips stay in the pots they helped build — they simply are not eligible.
 *
 * Adjacent layers with identical eligibility are merged, so a table with no
 * all-ins produces exactly one pot rather than one per betting level.
 */
export function buildPots(committed: readonly number[], folded: readonly boolean[]): Pot[] {
  if (committed.length !== folded.length) {
    fail('INVALID_STATE', 'buildPots: committed and folded must describe the same seats', {
      committed: committed.length,
      folded: folded.length,
    });
  }

  const levels = [...new Set(committed.filter((amount) => amount > 0))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previous = 0;

  for (const level of levels) {
    let amount = 0;
    const eligible: number[] = [];

    for (let seat = 0; seat < committed.length; seat++) {
      const contribution = committed[seat]!;
      if (contribution > previous) amount += Math.min(contribution, level) - previous;
      if (contribution >= level && !folded[seat]) eligible.push(seat);
    }

    previous = level;
    if (amount <= 0) continue;

    if (eligible.length === 0) {
      // Every player who reached this layer folded. Their chips join the last
      // contested pot rather than vanishing. Eligibility only ever shrinks as
      // the level rises, so this can only happen at the top of the stack of
      // layers — and if there is no contested pot at all, no one can win these
      // chips and the caller has handed us an impossible hand.
      const last = pots.pop();
      if (!last) {
        fail('INVALID_STATE', 'Every contributor folded: these chips have no possible winner', {
          amount,
          level,
        });
      }
      pots.push({ amount: last.amount + amount, eligibleSeats: last.eligibleSeats });
      continue;
    }

    const previousPot = pots[pots.length - 1];
    if (previousPot && sameSeats(previousPot.eligibleSeats, eligible)) {
      pots[pots.length - 1] = {
        amount: previousPot.amount + amount,
        eligibleSeats: previousPot.eligibleSeats,
      };
    } else {
      pots.push({ amount, eligibleSeats: eligible });
    }
  }

  return pots;
}

export function totalPot(pots: readonly Pot[]): number {
  return pots.reduce((sum, pot) => sum + pot.amount, 0);
}

/**
 * The portion of a bet nobody could match, which goes back to the bettor.
 *
 * Returned at the end of a betting round, before pots are built, so that a
 * player who bets 200 into a lone opponent holding 50 risks only 50.
 */
export function findUncalledBet(
  streetCommitted: readonly number[],
  folded: readonly boolean[],
): { seat: number; amount: number } | null {
  let bestSeat = -1;
  let best = 0;
  let second = 0;

  for (let seat = 0; seat < streetCommitted.length; seat++) {
    if (folded[seat]) continue;
    const amount = streetCommitted[seat]!;
    if (amount > best) {
      second = best;
      best = amount;
      bestSeat = seat;
    } else if (amount > second) {
      second = amount;
    }
  }

  if (bestSeat < 0 || best <= second) return null;
  return { seat: bestSeat, amount: best - second };
}
