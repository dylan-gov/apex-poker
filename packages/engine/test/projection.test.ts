import { describe, expect, it } from 'vitest';
import { cardsToString, type Card } from '../src/cards.js';
import { projectForSpectator, projectHandState } from '../src/projection.js';
import type { HandState } from '../src/types.js';
import { beginHand, call, check, fold, play, raiseTo } from './helpers.js';

function threeHanded() {
  return beginHand({
    stacks: [1000, 1000, 1000],
    hole: { 0: 'AcAd', 1: '7c7d', 2: 'QsJs' },
    board: 'Ah7h2s9cKd',
    handId: 'privacy-hand',
  });
}

/** Every array of numbers anywhere in the projection. */
function allNumberArrays(value: unknown, found: number[][] = []): number[][] {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'number')) found.push(value as number[]);
    for (const item of value) allNumberArrays(item, found);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) allNumberArrays(item, found);
  }
  return found;
}

function expectHidden(state: HandState, viewerId: string | null, hidden: readonly Card[]): void {
  const view = projectHandState(state, viewerId);
  for (const array of allNumberArrays(view)) {
    const containsBoth = hidden.every((card) => array.includes(card));
    expect(containsBoth && array.length <= 2).toBe(false);
  }
}

describe('hole card privacy', () => {
  it('shows a player their own cards and nobody else’s', () => {
    const { state } = threeHanded();
    const view = projectHandState(state, 'p0');

    expect(view.viewerSeat).toBe(0);
    expect(cardsToString(view.seats[0]!.holeCards!)).toBe('Ac Ad');
    expect(view.seats[1]!.holeCards).toBeNull();
    expect(view.seats[2]!.holeCards).toBeNull();
    // The client still knows how many cards to draw face down.
    expect(view.seats[1]!.holeCardCount).toBe(2);
  });

  it('never leaks another player’s cards anywhere in the payload', () => {
    const { state } = threeHanded();
    expectHidden(state, 'p0', state.seats[1]!.holeCards);
    expectHidden(state, 'p0', state.seats[2]!.holeCards);
  });

  it('shows a spectator nothing', () => {
    const { state } = threeHanded();
    const view = projectForSpectator(state);
    expect(view.viewerSeat).toBeNull();
    expect(view.seats.every((seat) => seat.holeCards === null)).toBe(true);
    expectHidden(state, null, state.seats[0]!.holeCards);
  });

  it('never includes the undealt deck', () => {
    const { state } = threeHanded();
    const view = projectHandState(state, 'p0') as unknown as Record<string, unknown>;
    expect(Object.keys(view)).not.toContain('shoe');
    expect(Object.keys(view)).not.toContain('deck');
    expect(Object.keys(view)).not.toContain('burned');
  });
});

describe('what a showdown reveals', () => {
  const showdownState = () =>
    play(threeHanded().state, [
      [0, call],
      [1, call],
      [2, fold],
      [1, check],
      [0, check],
      [1, check],
      [0, check],
      [1, check],
      [0, check],
    ]).state;

  it('turns over the hands that reached it', () => {
    const state = showdownState();
    expect(state.phase).toBe('complete');
    const view = projectForSpectator(state);
    expect(cardsToString(view.seats[0]!.holeCards!)).toBe('Ac Ad');
    expect(cardsToString(view.seats[1]!.holeCards!)).toBe('7c 7d');
  });

  it('keeps a folded hand face down', () => {
    const state = showdownState();
    const view = projectForSpectator(state);
    expect(view.seats[2]!.folded).toBe(true);
    expect(view.seats[2]!.holeCards).toBeNull();
    expectHidden(state, null, state.seats[2]!.holeCards);
  });

  it('shows nothing when the hand was won without a showdown', () => {
    const state = play(threeHanded().state, [
      [0, raiseTo(200)],
      [1, fold],
      [2, fold],
    ]).state;

    expect(state.phase).toBe('complete');
    const view = projectForSpectator(state);
    expect(view.seats.every((seat) => seat.holeCards === null)).toBe(true);
    expectHidden(state, null, state.seats[0]!.holeCards);
  });
});

describe('what the view carries', () => {
  it('offers legal actions only to the player whose turn it is', () => {
    const { state } = threeHanded();
    expect(projectHandState(state, 'p0').legal).toBeDefined();
    expect(projectHandState(state, 'p1').legal).toBeUndefined();
    expect(projectForSpectator(state).legal).toBeUndefined();
  });

  it('publishes the shuffle commitment up front and the seed only at the end', () => {
    const start = beginHand({
      stacks: [1000, 1000],
      hole: { 0: 'AcAd', 1: '7c7d' },
      board: 'Ah7h2s9cKd',
    });
    const withCommitment: HandState = {
      ...start.state,
      commitment: 'deadbeef',
      seed: 'the-seed',
    };

    const midHand = projectHandState(withCommitment, 'p0');
    expect(midHand.commitment).toBe('deadbeef');
    expect(midHand.seed).toBeUndefined();

    const finished = play(withCommitment, [[0, fold]]).state;
    const afterHand = projectHandState(finished, 'p0');
    expect(afterHand.seed).toBe('the-seed');
  });

  it('reports the pot and sequence number the client must echo', () => {
    const { state } = threeHanded();
    const view = projectHandState(state, 'p0');
    expect(view.potTotal).toBe(30);
    expect(view.seq).toBe(state.seq);
    expect(view.currentBet).toBe(20);
    expect(view.actionSeat).toBe(0);
  });
});
