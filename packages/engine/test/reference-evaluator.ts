import { rankOf, suitOf, type Card } from '../src/cards.js';

/**
 * An independent, deliberately naive hand evaluator used only by tests.
 *
 * It shares no code and no approach with src/hand-evaluator.ts: this one sorts
 * plain arrays, counts with a Map, and brute-forces all 21 five-card subsets of
 * a seven-card hand. The production evaluator uses rank bitmasks and resolves
 * flushes in a single pass. Agreement between two implementations that were
 * written differently is real evidence; agreement between an implementation and
 * itself is not.
 */
export interface RefHand {
  category: number;
  tiebreaks: number[];
}

export function refEvaluate5(cards: readonly Card[]): RefHand {
  if (cards.length !== 5) throw new Error(`refEvaluate5 needs 5 cards, got ${cards.length}`);

  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const suits = cards.map(suitOf);
  const isFlush = suits.every((suit) => suit === suits[0]);

  const unique = [...new Set(ranks)];
  let straightTop = -1;
  if (unique.length === 5) {
    if (unique[0]! - unique[4]! === 4) straightTop = unique[0]!;
    else if (unique[0] === 12 && unique[1] === 3 && unique[4] === 0) straightTop = 3;
  }

  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const rankOfGroup = (index: number): number => groups[index]![0];
  const sizeOfGroup = (index: number): number => groups[index]![1];

  if (isFlush && straightTop >= 0) return { category: 8, tiebreaks: [straightTop] };
  if (sizeOfGroup(0) === 4) return { category: 7, tiebreaks: [rankOfGroup(0), rankOfGroup(1)] };
  if (sizeOfGroup(0) === 3 && sizeOfGroup(1) === 2) {
    return { category: 6, tiebreaks: [rankOfGroup(0), rankOfGroup(1)] };
  }
  if (isFlush) return { category: 5, tiebreaks: ranks };
  if (straightTop >= 0) return { category: 4, tiebreaks: [straightTop] };
  if (sizeOfGroup(0) === 3) {
    return { category: 3, tiebreaks: [rankOfGroup(0), rankOfGroup(1), rankOfGroup(2)] };
  }
  if (sizeOfGroup(0) === 2 && sizeOfGroup(1) === 2) {
    return { category: 2, tiebreaks: [rankOfGroup(0), rankOfGroup(1), rankOfGroup(2)] };
  }
  if (sizeOfGroup(0) === 2) {
    return {
      category: 1,
      tiebreaks: [rankOfGroup(0), rankOfGroup(1), rankOfGroup(2), rankOfGroup(3)],
    };
  }
  return { category: 0, tiebreaks: ranks };
}

export function compareRef(a: RefHand, b: RefHand): number {
  if (a.category !== b.category) return a.category - b.category;
  const length = Math.max(a.tiebreaks.length, b.tiebreaks.length);
  for (let i = 0; i < length; i++) {
    const diff = (a.tiebreaks[i] ?? -1) - (b.tiebreaks[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function combinations<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, current: T[]): void => {
    if (current.length === size) {
      out.push([...current]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      current.push(items[i]!);
      pick(i + 1, current);
      current.pop();
    }
  };
  pick(0, []);
  return out;
}

/** Best five-card hand out of five, six, or seven cards, the slow way. */
export function refBest(cards: readonly Card[]): RefHand {
  let best: RefHand | null = null;
  for (const combo of combinations(cards, 5)) {
    const hand = refEvaluate5(combo);
    if (!best || compareRef(hand, best) > 0) best = hand;
  }
  if (!best) throw new Error('refBest: no five-card combination');
  return best;
}
