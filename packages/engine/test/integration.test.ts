import { describe, expect, it } from 'vitest';
import { cardsToString } from '../src/cards.js';
import { createShoe } from '../src/deck.js';
import { commitToShuffle, generateSeed, verifyShuffleCommitment } from '../src/fairness.js';
import { applyAction, isComplete, startHand } from '../src/game-state.js';
import { projectHandState } from '../src/projection.js';
import { seededRng } from '../src/rng.js';
import type { HandState } from '../src/types.js';
import { beginHand, betTo, call, check, fold, netOf, play, raiseTo } from './helpers.js';

/**
 * The end-to-end sequence spec §22 asks for:
 *   create table → seat players → start hand → deal → betting → flop →
 *   betting → turn → betting → river → betting → showdown → payout → new hand
 */
describe('a full hand, street by street', () => {
  const table = () =>
    beginHand({
      stacks: [2000, 2000, 2000, 2000],
      hole: { 0: 'AcAd', 1: '2c3d', 2: 'KcKd', 3: '7c8d' },
      board: 'Ah7h2s9cKs',
      handId: 'hand-1',
      handNumber: 1,
      button: 0,
    });

  it('plays preflop through showdown and pays the right player', () => {
    const start = table();
    expect(start.state.actionSeat).toBe(3); // four-handed: under the gun is left of the big blind

    const preflop = play(start.state, [
      [3, call],
      [0, raiseTo(60)],
      [1, fold],
      [2, call],
      [3, call],
    ]).state;
    expect(preflop.phase).toBe('flop');
    expect(cardsToString(preflop.board)).toBe('Ah 7h 2s');
    expect(preflop.actionSeat).toBe(2); // first live seat left of the button

    const flop = play(preflop, [
      [2, check],
      [3, check],
      [0, betTo(100)],
      [2, call],
      [3, fold],
    ]).state;
    expect(flop.phase).toBe('turn');
    expect(cardsToString(flop.board)).toBe('Ah 7h 2s 9c');

    const turn = play(flop, [
      [2, check],
      [0, check],
    ]).state;
    expect(turn.phase).toBe('river');
    expect(cardsToString(turn.board)).toBe('Ah 7h 2s 9c Ks');

    const final = play(turn, [
      [2, betTo(150)],
      [0, raiseTo(400)],
      [2, call],
    ]).state;

    expect(final.phase).toBe('complete');
    expect(final.pots).toEqual([{ amount: 1190, eligibleSeats: [0, 2] }]);
    expect(netOf(final, 0)).toBe(630);
    expect(netOf(final, 2)).toBe(-560);
    expect(netOf(final, 3)).toBe(-60);
    expect(netOf(final, 1)).toBe(-10);
    expect(final.results.reduce((sum, result) => sum + result.net, 0)).toBe(0);

    const winner = final.results.find((result) => result.seat === 0);
    expect(winner?.handDescription).toBe('Three of a Kind, Aces');
    expect(winner?.wentToShowdown).toBe(true);
    expect(final.results.find((result) => result.seat === 3)?.wentToShowdown).toBe(false);
  });

  it('records every action in order for the hand history', () => {
    const start = table();
    const final = play(start.state, [
      [3, call],
      [0, raiseTo(60)],
      [1, fold],
      [2, call],
      [3, call],
      [2, check],
      [3, check],
      [0, betTo(100)],
      [2, call],
      [3, fold],
      [2, check],
      [0, check],
      [2, betTo(150)],
      [0, raiseTo(400)],
      [2, call],
    ]).state;

    expect(final.actions.map((action) => action.type).slice(0, 4)).toEqual([
      'postSmallBlind',
      'postBigBlind',
      'call',
      'raise',
    ]);
    expect(final.actions.map((action) => action.index)).toEqual(
      final.actions.map((_, index) => index),
    );
    expect(final.actions.at(-1)?.potAfter).toBe(1190);

    const streets = [...new Set(final.actions.map((action) => action.street))];
    expect(streets).toEqual(['preflop', 'flop', 'turn', 'river']);
  });

  it('carries the stacks into the next hand with the button moved on', () => {
    const first = play(table().state, [
      [3, call],
      [0, raiseTo(60)],
      [1, fold],
      [2, call],
      [3, call],
      [2, check],
      [3, check],
      [0, betTo(100)],
      [2, call],
      [3, fold],
      [2, check],
      [0, check],
      [2, betTo(150)],
      [0, raiseTo(400)],
      [2, call],
    ]).state;

    const carried = first.results.map((result) => ({
      seat: result.seat,
      playerId: result.playerId,
      stack: result.endingStack,
    }));
    expect(carried.map((entry) => entry.stack)).toEqual([2630, 1990, 1440, 1940]);

    const second = startHand({
      handId: 'hand-2',
      handNumber: 2,
      seatCount: 4,
      buttonSeat: 1,
      smallBlind: 10,
      bigBlind: 20,
      players: carried,
      shoe: createShoe(seededRng('hand-2')),
    });
    expect(second.state.actionSeat).toBe(0); // under the gun with the button on seat 1

    const done = play(second.state, [
      [0, fold],
      [1, fold],
      [2, fold], // folds the small blind through to the big blind
    ]).state;

    expect(isComplete(done)).toBe(true);
    expect(netOf(done, 3)).toBe(10);
    const chipsAfterTwoHands = done.results.reduce((sum, result) => sum + result.endingStack, 0);
    expect(chipsAfterTwoHands).toBe(8000);
  });
});

describe('shuffle verification end to end', () => {
  it('lets a player prove the deck was fixed before the deal', () => {
    const entropy = seededRng('entropy-source');
    const seed = generateSeed((bound) => entropy.nextInt(bound));
    const { commitment } = commitToShuffle('verifiable-hand', seed);

    const deal = (): HandState =>
      startHand({
        handId: 'verifiable-hand',
        handNumber: 1,
        seatCount: 3,
        buttonSeat: 0,
        smallBlind: 10,
        bigBlind: 20,
        players: [
          { seat: 0, playerId: 'a', stack: 500 },
          { seat: 1, playerId: 'b', stack: 500 },
          { seat: 2, playerId: 'c', stack: 500 },
        ],
        shoe: createShoe(seededRng(seed)),
        commitment,
        seed,
      }).state;

    // During the hand the seed is withheld; the commitment is public.
    const live = deal();
    expect(projectHandState(live, 'a').commitment).toBe(commitment);
    expect(projectHandState(live, 'a').seed).toBeUndefined();

    const finished = play(live, [
      [0, fold],
      [1, fold],
    ]).state;

    // Afterwards the seed is published and anyone can check it.
    const revealed = projectHandState(finished, 'a').seed;
    expect(revealed).toBe(seed);
    expect(verifyShuffleCommitment(commitment, 'verifiable-hand', revealed!)).toBe(true);
    expect(verifyShuffleCommitment(commitment, 'verifiable-hand', `${revealed}x`)).toBe(false);

    // And replaying the seed reproduces the exact same deal.
    expect(deal().seats.map((seat) => seat?.holeCards)).toEqual(
      live.seats.map((seat) => seat?.holeCards),
    );
  });
});

describe('what a hostile client cannot do', () => {
  it('cannot act for another player, out of turn, or twice', () => {
    const { state } = beginHand({
      stacks: [1000, 1000, 1000],
      hole: { 0: 'AcAd', 1: '7c7d', 2: 'QsJs' },
      board: 'Ah7h2s9cKd',
    });

    expect(() => applyAction(state, 1, call)).toThrow(/out of turn/);
    expect(() => applyAction(state, 0, check)).toThrow(/Cannot check/);
    expect(() => applyAction(state, 0, raiseTo(999_999))).toThrow(/cannot commit/);

    const after = applyAction(state, 0, call, state.seq).state;
    expect(() => applyAction(after, 0, call, state.seq)).toThrow(/out-of-date/);
  });

  it('reports errors without leaking internal state', () => {
    const { state } = beginHand({
      stacks: [1000, 1000],
      hole: { 0: 'AcAd', 1: '7c7d' },
      board: 'Ah7h2s9cKd',
    });

    try {
      applyAction(state, 1, call);
      throw new Error('expected a rejection');
    } catch (error) {
      const wire = (error as { toWire: () => Record<string, unknown> }).toWire();
      expect(wire).toHaveProperty('code', 'NOT_YOUR_TURN');
      expect(JSON.stringify(wire)).not.toContain('holeCards');
      expect(wire).not.toHaveProperty('stack');
    }
  });
});
