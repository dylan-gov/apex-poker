import type { Card } from './cards.js';
import { fail } from './errors.js';
import { describeHand, evaluate, type EvaluatedHand } from './hand-evaluator.js';
import type { Pot } from './pot.js';

export interface PotAward {
  readonly potIndex: number;
  readonly seat: number;
  readonly amount: number;
}

export interface ShowdownEntry {
  readonly seat: number;
  readonly hand: EvaluatedHand;
  readonly description: string;
}

export function evaluateShowdown(
  contenders: readonly { seat: number; holeCards: readonly Card[] }[],
  board: readonly Card[],
): ShowdownEntry[] {
  return contenders.map(({ seat, holeCards }) => {
    const hand = evaluate([...holeCards, ...board]);
    return { seat, hand, description: describeHand(hand) };
  });
}

/**
 * Seats ordered clockwise starting immediately left of the button.
 *
 * This is the order odd chips are handed out in: the leftmost winner from the
 * button gets the first spare chip. It is a real rule, not a rounding detail —
 * over enough split pots it is the difference between a fair game and a
 * systematically biased one.
 */
export function seatOrderFromButton(
  seats: readonly number[],
  buttonSeat: number,
  seatCount: number,
): number[] {
  const distance = (seat: number): number => (seat - buttonSeat - 1 + seatCount * 2) % seatCount;
  return [...seats].sort((a, b) => distance(a) - distance(b));
}

export function awardPots(
  pots: readonly Pot[],
  hands: ReadonlyMap<number, EvaluatedHand>,
  buttonSeat: number,
  seatCount: number,
): PotAward[] {
  const awards: PotAward[] = [];

  pots.forEach((pot, potIndex) => {
    const contenders = pot.eligibleSeats.filter((seat) => hands.has(seat));
    if (contenders.length === 0) {
      fail('INVALID_STATE', `Pot ${potIndex} has no eligible seat with a hand`, {
        potIndex,
        eligibleSeats: [...pot.eligibleSeats],
      });
    }

    let bestValue = -1;
    let winners: number[] = [];
    for (const seat of contenders) {
      const value = hands.get(seat)!.value;
      if (value > bestValue) {
        bestValue = value;
        winners = [seat];
      } else if (value === bestValue) {
        winners.push(seat);
      }
    }

    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;

    for (const seat of seatOrderFromButton(winners, buttonSeat, seatCount)) {
      let amount = share;
      if (remainder > 0) {
        amount += 1;
        remainder -= 1;
      }
      if (amount > 0) awards.push({ potIndex, seat, amount });
    }
  });

  return awards;
}

/** Everyone else folded: one seat takes every pot, and no cards are shown. */
export function awardUncontested(pots: readonly Pot[], seat: number): PotAward[] {
  return pots
    .map((pot, potIndex) => ({ potIndex, seat, amount: pot.amount }))
    .filter((award) => award.amount > 0);
}
