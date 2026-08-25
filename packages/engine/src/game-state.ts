import { assertNoDuplicates, type Card } from './cards.js';
import {
  actingSeats,
  getLegalActions,
  liveSeats,
  nextSeatToAct,
  occupiedSeats,
  resolveAction,
  seatAt,
} from './betting.js';
import { burn, draw } from './deck.js';
import { fail } from './errors.js';
import type { EvaluatedHand } from './hand-evaluator.js';
import { buildPots, findUncalledBet } from './pot.js';
import { awardPots, awardUncontested, evaluateShowdown, type ShowdownEntry } from './showdown.js';
import type {
  EngineEvent,
  HandResult,
  HandState,
  LoggedActionType,
  PlayerAction,
  SeatState,
  StartHandOptions,
  Street,
} from './types.js';

const HOLE_CARDS_PER_PLAYER = 2;

// ---------------------------------------------------------------------------
// Small state helpers
// ---------------------------------------------------------------------------

function committedStreetArray(state: HandState): number[] {
  return Array.from(
    { length: state.seatCount },
    (_, i) => state.seats[i]?.committedThisStreet ?? 0,
  );
}

function committedTotalArray(state: HandState): number[] {
  return Array.from({ length: state.seatCount }, (_, i) => state.seats[i]?.committedTotal ?? 0);
}

function foldedArray(state: HandState): boolean[] {
  return Array.from({ length: state.seatCount }, (_, i) => {
    const seat = state.seats[i];
    return !seat || seat.folded;
  });
}

/**
 * Explicit clone rather than structuredClone: the engine declares no ambient
 * globals, and being deliberate about what is copied keeps the hot path
 * predictable. `shoe.cards` is shared by reference because it is never
 * mutated after the shuffle — only the cursor moves.
 */
export function cloneState(state: HandState): HandState {
  return {
    ...state,
    seats: state.seats.map((seat) => (seat ? { ...seat, holeCards: [...seat.holeCards] } : null)),
    shoe: { cards: state.shoe.cards, index: state.shoe.index },
    burned: [...state.burned],
    board: [...state.board],
    pots: state.pots.map((pot) => ({ amount: pot.amount, eligibleSeats: [...pot.eligibleSeats] })),
    awards: [...state.awards],
    actions: [...state.actions],
    results: state.results.map((result) => ({ ...result, holeCards: [...result.holeCards] })),
  };
}

function logAction(
  state: HandState,
  street: Street,
  player: SeatState,
  type: LoggedActionType,
  amount: number,
  toAmount: number,
): void {
  const potAfter = occupiedSeats(state).reduce((sum, seat) => sum + seat.committedTotal, 0);
  state.actions.push({
    index: state.actions.length,
    street,
    seat: player.seat,
    playerId: player.playerId,
    type,
    amount,
    toAmount,
    potAfter,
  });
}

function nextOccupied(seats: readonly (SeatState | null)[], from: number): number {
  for (let step = 1; step <= seats.length; step++) {
    const seat = (from + step) % seats.length;
    if (seats[seat]) return seat;
  }
  fail('NOT_ENOUGH_PLAYERS', 'No occupied seat found');
}

// ---------------------------------------------------------------------------
// Starting a hand
// ---------------------------------------------------------------------------

export function startHand(options: StartHandOptions): {
  state: HandState;
  events: EngineEvent[];
} {
  const { handId, handNumber, seatCount, buttonSeat, smallBlind, bigBlind, shoe } = options;
  const ante = options.ante ?? 0;

  if (!Number.isInteger(seatCount) || seatCount < 2 || seatCount > 10) {
    fail('INVALID_STATE', `Table must have 2 to 10 seats, got ${seatCount}`, { seatCount });
  }
  if (!Number.isInteger(smallBlind) || smallBlind <= 0) {
    fail('INVALID_AMOUNT', 'Small blind must be a positive whole number', { smallBlind });
  }
  if (!Number.isInteger(bigBlind) || bigBlind < smallBlind) {
    fail('INVALID_AMOUNT', 'Big blind must be a whole number at least the small blind', {
      smallBlind,
      bigBlind,
    });
  }
  if (!Number.isInteger(ante) || ante < 0) {
    fail('INVALID_AMOUNT', 'Ante must be a non-negative whole number', { ante });
  }

  const seats: (SeatState | null)[] = new Array<SeatState | null>(seatCount).fill(null);
  for (const player of options.players) {
    if (!Number.isInteger(player.seat) || player.seat < 0 || player.seat >= seatCount) {
      fail('INVALID_STATE', `Seat ${player.seat} is outside a ${seatCount}-seat table`, {
        seat: player.seat,
        seatCount,
      });
    }
    if (seats[player.seat]) {
      fail('SEAT_TAKEN', `Seat ${player.seat} is already occupied`, { seat: player.seat });
    }
    if (!Number.isInteger(player.stack) || player.stack <= 0) {
      fail('INSUFFICIENT_CHIPS', `Seat ${player.seat} must sit with a positive whole stack`, {
        seat: player.seat,
        stack: player.stack,
      });
    }
    seats[player.seat] = {
      seat: player.seat,
      playerId: player.playerId,
      stack: player.stack,
      startingStack: player.stack,
      holeCards: [],
      folded: false,
      allIn: false,
      committedThisStreet: 0,
      committedTotal: 0,
      actedSinceLastFullRaise: false,
      won: 0,
    };
  }

  const occupied = seats.filter((seat): seat is SeatState => seat !== null);
  if (occupied.length < 2) {
    fail('NOT_ENOUGH_PLAYERS', 'A hand needs at least two seated players', {
      seated: occupied.length,
    });
  }
  if (!seats[buttonSeat]) {
    fail('INVALID_STATE', `The button must sit on an occupied seat, got ${buttonSeat}`, {
      buttonSeat,
    });
  }

  const state: HandState = {
    handId,
    handNumber,
    seatCount,
    buttonSeat,
    smallBlind,
    bigBlind,
    ante,
    phase: 'preflop',
    seats,
    shoe,
    burned: [],
    board: [],
    currentBet: 0,
    lastRaiseSize: bigBlind,
    raiseReopened: true,
    actionSeat: null,
    aggressorSeat: null,
    pots: [],
    awards: [],
    actions: [],
    results: [],
    seq: 0,
    ...(options.commitment === undefined ? {} : { commitment: options.commitment }),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  };

  const events: EngineEvent[] = [
    {
      type: 'HAND_STARTED',
      handId,
      handNumber,
      buttonSeat,
      smallBlind,
      bigBlind,
      ...(options.commitment === undefined ? {} : { commitment: options.commitment }),
    },
  ];

  const headsUp = occupied.length === 2;
  const smallBlindSeat = headsUp ? buttonSeat : nextOccupied(seats, buttonSeat);
  const bigBlindSeat = nextOccupied(seats, smallBlindSeat);

  const posts: { seat: number; kind: 'ante' | 'smallBlind' | 'bigBlind'; amount: number }[] = [];

  if (ante > 0) {
    for (const player of occupied) {
      const amount = Math.min(ante, player.stack);
      if (amount <= 0) continue;
      player.stack -= amount;
      // Antes are dead money: they build the pot but are not part of the
      // street's bet, so nobody has to "match" an ante to stay in.
      player.committedTotal += amount;
      if (player.stack === 0) player.allIn = true;
      posts.push({ seat: player.seat, kind: 'ante', amount });
      logAction(state, 'preflop', player, 'postAnte', amount, 0);
    }
  }

  const postBlind = (seat: number, blind: number, kind: 'smallBlind' | 'bigBlind'): void => {
    const player = seatAt(state, seat);
    const amount = Math.min(blind, player.stack);
    player.stack -= amount;
    player.committedThisStreet += amount;
    player.committedTotal += amount;
    if (player.stack === 0) player.allIn = true;
    posts.push({ seat, kind, amount });
    logAction(
      state,
      'preflop',
      player,
      kind === 'smallBlind' ? 'postSmallBlind' : 'postBigBlind',
      amount,
      player.committedThisStreet,
    );
  };

  postBlind(smallBlindSeat, smallBlind, 'smallBlind');
  postBlind(bigBlindSeat, bigBlind, 'bigBlind');
  events.push({ type: 'BLINDS_POSTED', posts });

  // A short all-in blind does not lower the price of the round: the bet to
  // match is still a full big blind.
  state.currentBet = bigBlind;
  state.lastRaiseSize = bigBlind;
  state.raiseReopened = true;

  // Deal one card at a time, starting left of the button, exactly as a live
  // deal would — so a revealed seed replays the deal card for card.
  const dealOrder: SeatState[] = [];
  let cursor = buttonSeat;
  for (let i = 0; i < occupied.length; i++) {
    cursor = nextOccupied(seats, cursor);
    dealOrder.push(seatAt(state, cursor));
  }
  for (let round = 0; round < HOLE_CARDS_PER_PLAYER; round++) {
    for (const player of dealOrder) player.holeCards.push(draw(state.shoe));
  }
  assertNoDuplicates(
    dealOrder.flatMap((player) => player.holeCards),
    'hole cards',
  );
  events.push({ type: 'CARDS_DEALT', seats: dealOrder.map((player) => player.seat) });

  const first = nextSeatToAct(state, bigBlindSeat);
  state.actionSeat = first;
  if (first === null) {
    // Everyone is all-in from blinds and antes. Nothing left to decide.
    advance(state, events);
  } else {
    events.push({
      type: 'ACTION_REQUIRED',
      seat: first,
      seq: state.seq,
      legal: getLegalActions(state, first),
    });
  }

  return { state, events };
}

// ---------------------------------------------------------------------------
// Applying an action
// ---------------------------------------------------------------------------

export function applyAction(
  state: HandState,
  seat: number,
  action: PlayerAction,
  expectedSeq?: number,
): { state: HandState; events: EngineEvent[] } {
  if (state.phase === 'showdown' || state.phase === 'payout' || state.phase === 'complete') {
    fail('HAND_ALREADY_COMPLETE', `Hand ${state.handId} is no longer accepting actions`, {
      handId: state.handId,
      phase: state.phase,
    });
  }
  if (expectedSeq !== undefined && expectedSeq !== state.seq) {
    fail('STALE_ACTION', 'This action was based on an out-of-date view of the hand', {
      expectedSeq,
      currentSeq: state.seq,
    });
  }

  const resolved = resolveAction(state, seat, action);
  const street = state.phase as Street;
  const next = cloneState(state);
  const player = seatAt(next, seat);
  const events: EngineEvent[] = [];

  if (resolved.type === 'fold') {
    player.folded = true;
  } else if (resolved.chips > 0) {
    player.stack -= resolved.chips;
    player.committedThisStreet += resolved.chips;
    player.committedTotal += resolved.chips;
    if (player.stack === 0) player.allIn = true;
  }
  player.actedSinceLastFullRaise = true;

  if (resolved.toAmount > next.currentBet) {
    const increment = resolved.toAmount - next.currentBet;
    next.currentBet = resolved.toAmount;
    next.aggressorSeat = seat;
    if (resolved.isFullRaise) {
      next.lastRaiseSize = increment;
      next.raiseReopened = true;
      for (const other of occupiedSeats(next)) {
        if (other.seat !== seat && !other.folded && !other.allIn) {
          other.actedSinceLastFullRaise = false;
        }
      }
    } else {
      // A short all-in caps the action: anyone who has already acted may only
      // call or fold from here.
      next.raiseReopened = false;
    }
  }

  next.seq += 1;
  logAction(next, street, player, resolved.type, resolved.chips, resolved.toAmount);
  events.push({
    type: 'PLAYER_ACTION',
    seat,
    action: resolved.type,
    amount: resolved.chips,
    toAmount: resolved.toAmount,
  });

  advance(next, events);
  return { state: next, events };
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

function advance(state: HandState, events: EngineEvent[]): void {
  const live = liveSeats(state);
  if (live.length === 1) {
    settleUncalledBet(state);
    finishUncontested(state, live[0]!, events);
    return;
  }

  const from = state.actionSeat ?? state.buttonSeat;
  const next = nextSeatToAct(state, from);
  if (next !== null) {
    state.actionSeat = next;
    events.push({
      type: 'ACTION_REQUIRED',
      seat: next,
      seq: state.seq,
      legal: getLegalActions(state, next),
    });
    return;
  }

  settleUncalledBet(state);

  if (actingSeats(state).length < 2) {
    runOutBoard(state, events);
    goToShowdown(state, events);
    return;
  }

  if (state.phase === 'river') {
    goToShowdown(state, events);
    return;
  }

  openNextStreet(state, events);
}

/** Chips nobody could match go back to the player who put them in. */
function settleUncalledBet(state: HandState): void {
  const uncalled = findUncalledBet(committedStreetArray(state), foldedArray(state));
  if (!uncalled) return;
  const player = seatAt(state, uncalled.seat);
  player.stack += uncalled.amount;
  player.committedThisStreet -= uncalled.amount;
  player.committedTotal -= uncalled.amount;
  if (player.stack > 0) player.allIn = false;
}

function dealNextStreet(state: HandState, events: EngineEvent[]): void {
  state.burned.push(burn(state.shoe));
  switch (state.phase) {
    case 'preflop': {
      state.phase = 'flop';
      const cards: Card[] = [draw(state.shoe), draw(state.shoe), draw(state.shoe)];
      state.board.push(...cards);
      events.push({ type: 'FLOP_REVEALED', cards });
      break;
    }
    case 'flop': {
      state.phase = 'turn';
      const card = draw(state.shoe);
      state.board.push(card);
      events.push({ type: 'TURN_REVEALED', card });
      break;
    }
    case 'turn': {
      state.phase = 'river';
      const card = draw(state.shoe);
      state.board.push(card);
      events.push({ type: 'RIVER_REVEALED', card });
      break;
    }
    default:
      fail('INVALID_STATE', `Cannot deal a street from phase ${state.phase}`, {
        phase: state.phase,
      });
  }
  assertNoDuplicates([...state.board, ...state.burned], 'board and burns');
}

function openNextStreet(state: HandState, events: EngineEvent[]): void {
  for (const player of occupiedSeats(state)) {
    player.committedThisStreet = 0;
    player.actedSinceLastFullRaise = false;
  }
  state.currentBet = 0;
  state.lastRaiseSize = state.bigBlind;
  state.raiseReopened = true;
  state.aggressorSeat = null;

  dealNextStreet(state, events);

  const first = nextSeatToAct(state, state.buttonSeat);
  state.actionSeat = first;
  if (first === null) {
    runOutBoard(state, events);
    goToShowdown(state, events);
    return;
  }
  events.push({
    type: 'ACTION_REQUIRED',
    seat: first,
    seq: state.seq,
    legal: getLegalActions(state, first),
  });
}

/** Nobody can bet again: deal whatever is left of the board and show down. */
function runOutBoard(state: HandState, events: EngineEvent[]): void {
  for (const player of occupiedSeats(state)) player.committedThisStreet = 0;
  state.currentBet = 0;
  state.actionSeat = null;
  while (state.phase !== 'river') dealNextStreet(state, events);
}

function goToShowdown(state: HandState, events: EngineEvent[]): void {
  state.phase = 'showdown';
  state.actionSeat = null;

  const contenders = liveSeats(state);
  const entries: ShowdownEntry[] = evaluateShowdown(
    contenders.map((player) => ({ seat: player.seat, holeCards: player.holeCards })),
    state.board,
  );

  events.push({
    type: 'SHOWDOWN',
    entries: entries.map((entry) => ({
      seat: entry.seat,
      holeCards: [...seatAt(state, entry.seat).holeCards],
      description: entry.description,
    })),
  });

  const hands = new Map<number, EvaluatedHand>(entries.map((entry) => [entry.seat, entry.hand]));
  state.pots = buildPots(committedTotalArray(state), foldedArray(state));
  state.awards = awardPots(state.pots, hands, state.buttonSeat, state.seatCount);
  payAwards(state, events);
  finalise(state, events, entries);
}

function finishUncontested(state: HandState, winner: SeatState, events: EngineEvent[]): void {
  state.phase = 'payout';
  state.actionSeat = null;

  // Everyone else folded, so there is nothing to layer: the last player
  // standing takes every chip left in the middle. Building side pots here
  // would strand the dead money, because once the winner's own uncalled bet
  // has been returned they may have contributed nothing to the level the
  // folded players' chips sit at.
  const total = committedTotalArray(state).reduce((sum, amount) => sum + amount, 0);
  state.pots = total > 0 ? [{ amount: total, eligibleSeats: [winner.seat] }] : [];
  state.awards = awardUncontested(state.pots, winner.seat);
  payAwards(state, events);
  finalise(state, events, []);
}

function payAwards(state: HandState, events: EngineEvent[]): void {
  state.phase = 'payout';
  for (const award of state.awards) {
    const player = seatAt(state, award.seat);
    player.stack += award.amount;
    player.won += award.amount;
    events.push({
      type: 'POT_AWARDED',
      potIndex: award.potIndex,
      seat: award.seat,
      amount: award.amount,
    });
  }
}

function finalise(
  state: HandState,
  events: EngineEvent[],
  entries: readonly ShowdownEntry[],
): void {
  const shown = new Map(entries.map((entry) => [entry.seat, entry]));
  const wentToShowdown = entries.length > 0;

  const results: HandResult[] = occupiedSeats(state).map((player) => {
    const entry = shown.get(player.seat);
    return {
      seat: player.seat,
      playerId: player.playerId,
      holeCards: [...player.holeCards],
      startingStack: player.startingStack,
      endingStack: player.stack,
      net: player.stack - player.startingStack,
      folded: player.folded,
      wentToShowdown: wentToShowdown && !player.folded,
      ...(entry ? { hand: entry.hand, handDescription: entry.description } : {}),
    };
  });

  state.results = results;
  state.phase = 'complete';

  // Chips are conserved, always. If this ever trips, the pot maths is wrong
  // and the hand must not be persisted — better a loud failure than a table
  // that quietly mints or destroys play chips.
  const before = results.reduce((sum, result) => sum + result.startingStack, 0);
  const after = results.reduce((sum, result) => sum + result.endingStack, 0);
  if (before !== after) {
    fail('INVALID_STATE', `Chip conservation violated: ${before} in, ${after} out`, {
      handId: state.handId,
      before,
      after,
    });
  }

  events.push({
    type: 'HAND_COMPLETED',
    results,
    ...(state.seed === undefined ? {} : { seed: state.seed }),
  });
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export function isComplete(state: HandState): boolean {
  return state.phase === 'complete';
}

export function currentPot(state: HandState): number {
  return occupiedSeats(state).reduce((sum, seat) => sum + seat.committedTotal, 0);
}
