import type { Card } from './cards.js';
import { getLegalActions } from './betting.js';
import type { Pot } from './pot.js';
import type { HandPhase, HandState, LegalActions, LoggedAction } from './types.js';

/**
 * The ONLY shape that may leave the server.
 *
 * `HandState` contains every player's hole cards and the undealt remainder of
 * the deck. It has no serialiser of its own and must never be sent, logged to
 * a client-visible channel, or embedded in an error. Everything a client sees
 * goes through `projectHandState`, which takes the viewer's identity as a
 * required argument so redaction cannot be forgotten by omission.
 */
export interface PublicSeat {
  readonly seat: number;
  readonly playerId: string;
  readonly stack: number;
  readonly folded: boolean;
  readonly allIn: boolean;
  readonly committedThisStreet: number;
  readonly committedTotal: number;
  readonly won: number;
  /** Face-up cards for this viewer, or null when they are face down. */
  readonly holeCards: readonly Card[] | null;
  /** Always accurate, so the client can render card backs without knowing them. */
  readonly holeCardCount: number;
}

export interface TableView {
  readonly handId: string;
  readonly handNumber: number;
  readonly phase: HandPhase;
  readonly buttonSeat: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly board: readonly Card[];
  readonly pots: readonly Pot[];
  readonly potTotal: number;
  readonly currentBet: number;
  readonly actionSeat: number | null;
  readonly seq: number;
  readonly seats: readonly PublicSeat[];
  readonly actions: readonly LoggedAction[];
  /** The viewer's seat, or null for a spectator. */
  readonly viewerSeat: number | null;
  /** Present only when it is the viewer's turn. */
  readonly legal?: LegalActions;
  readonly commitment?: string;
  /** Revealed only once the hand is complete. */
  readonly seed?: string;
}

function showdownReached(state: HandState): boolean {
  if (state.phase === 'showdown') return true;
  return state.results.some((result) => result.wentToShowdown);
}

export function projectHandState(state: HandState, viewerId: string | null): TableView {
  const revealAll = showdownReached(state);
  const viewerSeat =
    state.seats.find((seat) => seat !== null && seat.playerId === viewerId)?.seat ?? null;

  const seats: PublicSeat[] = [];
  for (const seat of state.seats) {
    if (!seat) continue;
    const isViewer = viewerId !== null && seat.playerId === viewerId;
    // Cards are shown to their owner at any time, and to everyone once a
    // showdown has actually happened. A hand won because everyone folded is
    // never shown — the winner does not have to reveal.
    const visible = isViewer || (revealAll && !seat.folded);
    seats.push({
      seat: seat.seat,
      playerId: seat.playerId,
      stack: seat.stack,
      folded: seat.folded,
      allIn: seat.allIn,
      committedThisStreet: seat.committedThisStreet,
      committedTotal: seat.committedTotal,
      won: seat.won,
      holeCards: visible ? [...seat.holeCards] : null,
      holeCardCount: seat.holeCards.length,
    });
  }

  const potTotal = seats.reduce((sum, seat) => sum + seat.committedTotal, 0);
  const isViewersTurn = viewerSeat !== null && state.actionSeat === viewerSeat;

  return {
    handId: state.handId,
    handNumber: state.handNumber,
    phase: state.phase,
    buttonSeat: state.buttonSeat,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    board: [...state.board],
    pots: state.pots.map((pot) => ({ amount: pot.amount, eligibleSeats: [...pot.eligibleSeats] })),
    potTotal,
    currentBet: state.currentBet,
    actionSeat: state.actionSeat,
    seq: state.seq,
    seats,
    actions: [...state.actions],
    viewerSeat,
    ...(isViewersTurn ? { legal: getLegalActions(state, viewerSeat) } : {}),
    ...(state.commitment === undefined ? {} : { commitment: state.commitment }),
    ...(state.phase === 'complete' && state.seed !== undefined ? { seed: state.seed } : {}),
  };
}

/** Convenience for tests and admin tooling: the view a non-player sees. */
export function projectForSpectator(state: HandState): TableView {
  return projectHandState(state, null);
}
