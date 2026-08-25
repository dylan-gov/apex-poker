import {
  assertNoDuplicates,
  makeCard,
  NUM_RANKS,
  NUM_SUITS,
  RANK_NAMES,
  RANK_NAMES_PLURAL,
  rankOf,
  suitOf,
  type Card,
  type Rank,
} from './cards.js';
import { fail } from './errors.js';

export const HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  ThreeOfAKind: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  FourOfAKind: 7,
  StraightFlush: 8,
} as const;

export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory];

export interface EvaluatedHand {
  /**
   * Single comparable integer. Higher wins, equal is a genuine tie (a chop),
   * so pot splitting never needs to re-inspect the hand.
   *
   * Layout: category in the top nibble-group, then five tiebreak ranks of four
   * bits each, most significant first. Unused slots are zero, which is safe
   * because every hand of a given category fills the same number of slots.
   */
  readonly value: number;
  readonly category: HandCategory;
  /** Tiebreak ranks, most significant first. */
  readonly ranks: readonly Rank[];
  /** The best five cards, in the order the hand reads. */
  readonly cards: readonly Card[];
}

function encode(category: HandCategory, ranks: readonly Rank[]): number {
  let value: number = category;
  for (let i = 0; i < 5; i++) value = value * 16 + (ranks[i] ?? 0);
  return value;
}

function build(category: HandCategory, ranks: Rank[], cards: Card[]): EvaluatedHand {
  return { value: encode(category, ranks), category, ranks, cards };
}

/** Highest rank completing a five-card straight in `mask`, or -1. */
function straightTop(mask: number): Rank {
  for (let top = NUM_RANKS - 1; top >= 4; top--) {
    const need = 0b11111 << (top - 4);
    if ((mask & need) === need) return top;
  }
  // The wheel: A-5-4-3-2, which ranks as a five-high straight.
  const wheel = (1 << 12) | 0b1111;
  if ((mask & wheel) === wheel) return 3;
  return -1;
}

function straightRanks(top: Rank): Rank[] {
  if (top === 3) return [3, 2, 1, 0, 12];
  return [top, top - 1, top - 2, top - 3, top - 4];
}

function topRanks(mask: number, count: number): Rank[] {
  const out: Rank[] = [];
  for (let r = NUM_RANKS - 1; r >= 0 && out.length < count; r--) {
    if (mask & (1 << r)) out.push(r);
  }
  return out;
}

function cardsOfRank(cards: readonly Card[], rank: Rank, limit: number): Card[] {
  const out: Card[] = [];
  for (const card of cards) {
    if (rankOf(card) === rank) {
      out.push(card);
      if (out.length === limit) break;
    }
  }
  return out;
}

function pickByRanks(cards: readonly Card[], ranks: readonly Rank[]): Card[] {
  const used = new Set<Card>();
  const out: Card[] = [];
  for (const rank of ranks) {
    for (const card of cards) {
      if (!used.has(card) && rankOf(card) === rank) {
        used.add(card);
        out.push(card);
        break;
      }
    }
  }
  return out;
}

/**
 * Evaluates the best five-card hand from five, six, or seven cards.
 *
 * Straight-flush and flush are resolved from the flush suit alone and return
 * early. That is safe rather than a shortcut: with seven cards it is
 * impossible to hold both five of one suit and quads or a full house, since
 * quads consume all four suits and a full house leaves at most four cards in
 * any single suit. test/hand-evaluator.test.ts checks this against an
 * independent brute-force evaluator over a large random sample.
 */
export function evaluate(cards: readonly Card[]): EvaluatedHand {
  if (cards.length < 5 || cards.length > 7) {
    fail('INVALID_STATE', `Hand evaluation needs 5 to 7 cards, got ${cards.length}`, {
      count: cards.length,
    });
  }
  assertNoDuplicates(cards, 'hand evaluation');

  const rankCount = new Array<number>(NUM_RANKS).fill(0);
  const suitRankMask = new Array<number>(NUM_SUITS).fill(0);
  const suitCount = new Array<number>(NUM_SUITS).fill(0);
  let rankMask = 0;

  for (const card of cards) {
    const rank = rankOf(card);
    const suit = suitOf(card);
    rankCount[rank] = rankCount[rank]! + 1;
    suitRankMask[suit] = suitRankMask[suit]! | (1 << rank);
    suitCount[suit] = suitCount[suit]! + 1;
    rankMask |= 1 << rank;
  }

  let flushSuit = -1;
  for (let suit = 0; suit < NUM_SUITS; suit++) {
    if (suitCount[suit]! >= 5) {
      flushSuit = suit;
      break;
    }
  }

  if (flushSuit >= 0) {
    const mask = suitRankMask[flushSuit]!;
    const sfTop = straightTop(mask);
    if (sfTop >= 0) {
      return build(
        HandCategory.StraightFlush,
        [sfTop],
        straightRanks(sfTop).map((rank) => makeCard(rank, flushSuit)),
      );
    }
    const best = topRanks(mask, 5);
    return build(
      HandCategory.Flush,
      best,
      best.map((rank) => makeCard(rank, flushSuit)),
    );
  }

  const quads: Rank[] = [];
  const trips: Rank[] = [];
  const pairs: Rank[] = [];
  const singles: Rank[] = [];
  for (let rank = NUM_RANKS - 1; rank >= 0; rank--) {
    switch (rankCount[rank]!) {
      case 4:
        quads.push(rank);
        break;
      case 3:
        trips.push(rank);
        break;
      case 2:
        pairs.push(rank);
        break;
      case 1:
        singles.push(rank);
        break;
      default:
        break;
    }
  }

  if (quads.length > 0) {
    const quad = quads[0]!;
    const kicker = topRanks(rankMask & ~(1 << quad), 1)[0]!;
    return build(
      HandCategory.FourOfAKind,
      [quad, kicker],
      [...cardsOfRank(cards, quad, 4), ...cardsOfRank(cards, kicker, 1)],
    );
  }

  if (trips.length > 0 && (trips.length > 1 || pairs.length > 0)) {
    const three = trips[0]!;
    const two = Math.max(trips[1] ?? -1, pairs[0] ?? -1);
    return build(
      HandCategory.FullHouse,
      [three, two],
      [...cardsOfRank(cards, three, 3), ...cardsOfRank(cards, two, 2)],
    );
  }

  const stTop = straightTop(rankMask);
  if (stTop >= 0) {
    const ranks = straightRanks(stTop);
    return build(HandCategory.Straight, [stTop], pickByRanks(cards, ranks));
  }

  if (trips.length > 0) {
    const three = trips[0]!;
    const kickers = topRanks(rankMask & ~(1 << three), 2);
    return build(
      HandCategory.ThreeOfAKind,
      [three, ...kickers],
      [...cardsOfRank(cards, three, 3), ...pickByRanks(cards, kickers)],
    );
  }

  if (pairs.length >= 2) {
    const high = pairs[0]!;
    const low = pairs[1]!;
    const kicker = topRanks(rankMask & ~(1 << high) & ~(1 << low), 1)[0]!;
    return build(
      HandCategory.TwoPair,
      [high, low, kicker],
      [
        ...cardsOfRank(cards, high, 2),
        ...cardsOfRank(cards, low, 2),
        ...cardsOfRank(cards, kicker, 1),
      ],
    );
  }

  if (pairs.length === 1) {
    const pair = pairs[0]!;
    const kickers = topRanks(rankMask & ~(1 << pair), 3);
    return build(
      HandCategory.Pair,
      [pair, ...kickers],
      [...cardsOfRank(cards, pair, 2), ...pickByRanks(cards, kickers)],
    );
  }

  const best = topRanks(rankMask, 5);
  return build(HandCategory.HighCard, best, pickByRanks(cards, best));
}

/** Negative if `a` loses, zero on a genuine chop, positive if `a` wins. */
export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  return a.value - b.value;
}

export function isRoyalFlush(hand: EvaluatedHand): boolean {
  return hand.category === HandCategory.StraightFlush && hand.ranks[0] === 12;
}

export function describeHand(hand: EvaluatedHand): string {
  const [a, b] = hand.ranks;
  switch (hand.category) {
    case HandCategory.StraightFlush:
      return isRoyalFlush(hand) ? 'Royal Flush' : `${RANK_NAMES[a!]}-high Straight Flush`;
    case HandCategory.FourOfAKind:
      return `Four of a Kind, ${RANK_NAMES_PLURAL[a!]}`;
    case HandCategory.FullHouse:
      return `Full House, ${RANK_NAMES_PLURAL[a!]} full of ${RANK_NAMES_PLURAL[b!]}`;
    case HandCategory.Flush:
      return `${RANK_NAMES[a!]}-high Flush`;
    case HandCategory.Straight:
      return `${RANK_NAMES[a!]}-high Straight`;
    case HandCategory.ThreeOfAKind:
      return `Three of a Kind, ${RANK_NAMES_PLURAL[a!]}`;
    case HandCategory.TwoPair:
      return `Two Pair, ${RANK_NAMES_PLURAL[a!]} and ${RANK_NAMES_PLURAL[b!]}`;
    case HandCategory.Pair:
      return `Pair of ${RANK_NAMES_PLURAL[a!]}`;
    case HandCategory.HighCard:
      return `${RANK_NAMES[a!]} High`;
    default:
      return 'Unknown hand';
  }
}
