import { FULL_DECK, parseCards, type Card } from '../src/cards.js';
import { createShoeFromOrder, type Shoe } from '../src/deck.js';
import { applyAction, startHand } from '../src/game-state.js';
import type { EngineEvent, HandState, PlayerAction, SeatSetup } from '../src/types.js';

/** Seats in dealing order: clockwise from the button, button last. */
export function dealOrder(
  buttonSeat: number,
  occupied: readonly number[],
  seatCount: number,
): number[] {
  const sorted = [...occupied].sort(
    (a, b) =>
      ((a - buttonSeat - 1 + seatCount * 2) % seatCount) -
      ((b - buttonSeat - 1 + seatCount * 2) % seatCount),
  );
  return sorted;
}

/**
 * Builds a deck that deals exactly the cards a test asks for.
 *
 * Mirrors the real deal: one card to each player in turn for two rounds, then
 * burn + flop, burn + turn, burn + river. Anything left over pads the deck so
 * it is still a legal 52.
 */
export function stackDeck(holeCardsInDealOrder: readonly string[], board: string): Card[] {
  const hole = holeCardsInDealOrder.map((text) => parseCards(text));
  for (const cards of hole) {
    if (cards.length !== 2) throw new Error(`Each player needs exactly 2 hole cards: ${cards}`);
  }
  const boardCards = parseCards(board);
  if (boardCards.length !== 5) throw new Error('Board must be 5 cards');

  const used = new Set<Card>([...hole.flat(), ...boardCards]);
  const spare = FULL_DECK.filter((card) => !used.has(card));
  let spareIndex = 0;
  const nextSpare = (): Card => {
    const card = spare[spareIndex++];
    if (card === undefined) throw new Error('Ran out of spare cards while stacking the deck');
    return card;
  };

  const order: Card[] = [];
  for (let round = 0; round < 2; round++) {
    for (const cards of hole) order.push(cards[round]!);
  }
  order.push(nextSpare(), boardCards[0]!, boardCards[1]!, boardCards[2]!);
  order.push(nextSpare(), boardCards[3]!);
  order.push(nextSpare(), boardCards[4]!);

  const placed = new Set<Card>(order);
  for (const card of FULL_DECK) if (!placed.has(card)) order.push(card);
  return order;
}

export function stackedShoe(holeCardsInDealOrder: readonly string[], board: string): Shoe {
  return createShoeFromOrder(stackDeck(holeCardsInDealOrder, board));
}

export function players(...stacks: readonly number[]): SeatSetup[] {
  return stacks.map((stack, seat) => ({ seat, playerId: `p${seat}`, stack }));
}

export interface BeginHandOptions {
  /** Indexed by seat. A stack of 0 means the seat is empty. */
  stacks: readonly number[];
  /** Hole cards by seat, e.g. { 0: 'AsKs' }. */
  hole: Record<number, string>;
  board: string;
  button?: number;
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
  handId?: string;
  handNumber?: number;
  seatCount?: number;
}

/** Starts a hand where every card is known in advance. */
export function beginHand(options: BeginHandOptions): ReturnType<typeof startHand> {
  const seatCount = options.seatCount ?? options.stacks.length;
  const button = options.button ?? 0;
  const occupied = options.stacks
    .map((stack, seat) => ({ stack, seat }))
    .filter((entry) => entry.stack > 0)
    .map((entry) => entry.seat);

  const order = dealOrder(button, occupied, seatCount);
  const holeInDealOrder = order.map((seat) => {
    const cards = options.hole[seat];
    if (!cards) throw new Error(`No hole cards supplied for seat ${seat}`);
    return cards;
  });

  return startHand({
    handId: options.handId ?? 'test-hand',
    handNumber: options.handNumber ?? 1,
    seatCount,
    buttonSeat: button,
    smallBlind: options.smallBlind ?? 10,
    bigBlind: options.bigBlind ?? 20,
    ante: options.ante ?? 0,
    players: occupied.map((seat) => ({
      seat,
      playerId: `p${seat}`,
      stack: options.stacks[seat]!,
    })),
    shoe: stackedShoe(holeInDealOrder, options.board),
  });
}

export type Step = [seat: number, action: PlayerAction];

/** Applies a scripted sequence of actions, collecting every event. */
export function play(
  state: HandState,
  steps: readonly Step[],
): { state: HandState; events: EngineEvent[] } {
  let current = state;
  const events: EngineEvent[] = [];
  for (const [seat, action] of steps) {
    const result = applyAction(current, seat, action);
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}

export const fold: PlayerAction = { type: 'fold' };
export const check: PlayerAction = { type: 'check' };
export const call: PlayerAction = { type: 'call' };
export const allIn: PlayerAction = { type: 'allIn' };
export const betTo = (toAmount: number): PlayerAction => ({ type: 'bet', toAmount });
export const raiseTo = (toAmount: number): PlayerAction => ({ type: 'raise', toAmount });

export function stackOf(state: HandState, seat: number): number {
  const player = state.seats[seat];
  if (!player) throw new Error(`Seat ${seat} is empty`);
  return player.stack;
}

export function netOf(state: HandState, seat: number): number {
  const result = state.results.find((entry) => entry.seat === seat);
  if (!result) throw new Error(`No result for seat ${seat}`);
  return result.net;
}
