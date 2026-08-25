import { describe, expect, it } from 'vitest';
import { getLegalActions } from '../src/betting.js';
import { EngineError } from '../src/errors.js';
import { applyAction } from '../src/game-state.js';
import { beginHand, call, check, fold, play, raiseTo } from './helpers.js';

/** Button seat 0, small blind seat 1, big blind seat 2. Seat 0 acts first. */
function threeHanded(stacks: readonly number[] = [1000, 1000, 1000]) {
  return beginHand({
    stacks,
    hole: { 0: 'AsKs', 1: 'QdQh', 2: '7c2d' },
    board: '2h5s9dTcJc',
  });
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`Expected ${code} but nothing was thrown`);
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).code).toBe(code);
  }
}

describe('legal actions', () => {
  it('offers the right options to the first player preflop', () => {
    const { state } = threeHanded();
    const legal = getLegalActions(state, 0);
    expect(legal).toMatchObject({
      seat: 0,
      canFold: true,
      canCheck: false,
      canCall: true,
      callAmount: 20,
      canBet: false,
      canRaise: true,
      minRaiseTo: 40,
      maxRaiseTo: 1000,
      canAllIn: true,
      allInTo: 1000,
    });
  });

  it('lets the big blind check its option after limps', () => {
    const { state } = play(threeHanded().state, [
      [0, call],
      [1, call],
    ]);
    expect(state.actionSeat).toBe(2);
    const legal = getLegalActions(state, 2);
    expect(legal.canCheck).toBe(true);
    expect(legal.canCall).toBe(false);
    expect(legal.canRaise).toBe(true);
    expect(legal.minRaiseTo).toBe(40);
  });

  it('offers a bet, not a raise, on a fresh street', () => {
    const { state } = play(threeHanded().state, [
      [0, call],
      [1, call],
      [2, check],
    ]);
    expect(state.phase).toBe('flop');
    expect(state.actionSeat).toBe(1);
    const legal = getLegalActions(state, 1);
    expect(legal.canBet).toBe(true);
    expect(legal.minBetTo).toBe(20);
    expect(legal.canRaise).toBe(false);
    expect(legal.canCheck).toBe(true);
  });

  it('caps everything at the stack for a short stack', () => {
    const { state } = threeHanded([35, 1000, 1000]);
    const legal = getLegalActions(state, 0);
    expect(legal.callAmount).toBe(20);
    expect(legal.maxRaiseTo).toBe(35);
    expect(legal.allInTo).toBe(35);
    // 35 is less than the minimum raise to 40, so raising is off the table —
    // only calling or shoving.
    expect(legal.canRaise).toBe(false);
    expect(legal.canAllIn).toBe(true);
  });
});

describe('rejecting bad actions', () => {
  it('refuses an action from a player whose turn it is not', () => {
    const { state } = threeHanded();
    expectCode(() => applyAction(state, 1, call), 'NOT_YOUR_TURN');
    expectCode(() => applyAction(state, 2, fold), 'NOT_YOUR_TURN');
  });

  it('refuses an action from a player who already folded', () => {
    const { state } = play(threeHanded().state, [[0, fold]]);
    expectCode(() => applyAction(state, 0, call), 'NOT_YOUR_TURN');
  });

  it('refuses a check when facing a bet', () => {
    const { state } = threeHanded();
    expectCode(() => applyAction(state, 0, check), 'INVALID_ACTION');
  });

  it('refuses a call when there is nothing to call', () => {
    const { state } = play(threeHanded().state, [
      [0, call],
      [1, call],
      [2, check],
    ]);
    expectCode(() => applyAction(state, 1, call), 'INVALID_ACTION');
  });

  it('refuses an undersized raise', () => {
    const { state } = threeHanded();
    expectCode(() => applyAction(state, 0, raiseTo(30)), 'INVALID_AMOUNT');
    expectCode(() => applyAction(state, 0, raiseTo(20)), 'INVALID_AMOUNT');
  });

  it('refuses a raise beyond the stack', () => {
    const { state } = threeHanded();
    expectCode(() => applyAction(state, 0, raiseTo(1001)), 'INSUFFICIENT_CHIPS');
  });

  it('refuses negative, fractional, and missing amounts', () => {
    const { state } = threeHanded();
    expectCode(() => applyAction(state, 0, raiseTo(-50)), 'INVALID_AMOUNT');
    expectCode(() => applyAction(state, 0, raiseTo(40.5)), 'INVALID_AMOUNT');
    expectCode(() => applyAction(state, 0, { type: 'raise' }), 'INVALID_AMOUNT');
  });

  it('refuses a bet when there is already a bet, and a raise when there is none', () => {
    const preflop = threeHanded().state;
    expectCode(() => applyAction(preflop, 0, { type: 'bet', toAmount: 60 }), 'INVALID_ACTION');

    const { state: flop } = play(preflop, [
      [0, call],
      [1, call],
      [2, check],
    ]);
    expectCode(() => applyAction(flop, 1, raiseTo(60)), 'INVALID_ACTION');
  });

  it('refuses an unknown action type', () => {
    const { state } = threeHanded();
    expectCode(
      () => applyAction(state, 0, { type: 'shove' } as unknown as { type: 'fold' }),
      'INVALID_ACTION',
    );
  });
});

describe('duplicate and stale actions', () => {
  it('accepts an action matching the current sequence number', () => {
    const { state } = threeHanded();
    expect(state.seq).toBe(0);
    const next = applyAction(state, 0, call, 0);
    expect(next.state.seq).toBe(1);
  });

  it('rejects a replayed action, which is what makes a double-tap harmless', () => {
    const { state } = threeHanded();
    const afterFirst = applyAction(state, 0, call, 0).state;
    // The client resends the same command against the same seq it saw.
    expectCode(() => applyAction(afterFirst, 0, call, 0), 'STALE_ACTION');
  });

  it('rejects an action based on a stale view of the hand', () => {
    const { state } = threeHanded();
    expectCode(() => applyAction(state, 0, call, 7), 'STALE_ACTION');
  });

  it('refuses any action once the hand is over', () => {
    const { state } = play(threeHanded().state, [
      [0, fold],
      [1, fold],
    ]);
    expect(state.phase).toBe('complete');
    expectCode(() => applyAction(state, 2, check), 'HAND_ALREADY_COMPLETE');
  });
});

describe('the reopen rule', () => {
  // Seat 1 shoves for less than a full raise. Seat 2 has not acted since the
  // last full raise and may re-raise; seat 0 has, and may only call or fold.
  function shortAllInScenario() {
    const start = beginHand({
      stacks: [1000, 80, 1000],
      hole: { 0: 'AsKs', 1: 'QdQh', 2: '7c2d' },
      board: '2h5s9dTcJc',
    });
    return play(start.state, [
      [0, raiseTo(60)],
      [1, { type: 'allIn' }],
    ]);
  }

  it('lets a player who has not yet acted re-raise over a short all-in', () => {
    const { state } = shortAllInScenario();
    expect(state.currentBet).toBe(80);
    expect(state.raiseReopened).toBe(false);
    expect(state.actionSeat).toBe(2);

    const legal = getLegalActions(state, 2);
    expect(legal.canRaise).toBe(true);
    // An incomplete all-in does not become the new raise increment: the
    // minimum is still the current bet plus the last *full* raise (40).
    expect(legal.minRaiseTo).toBe(120);
    expect(state.lastRaiseSize).toBe(40);
  });

  it('locks a player who already acted into calling or folding', () => {
    const { state } = play(shortAllInScenario().state, [[2, call]]);
    expect(state.actionSeat).toBe(0);

    const legal = getLegalActions(state, 0);
    expect(legal.canCall).toBe(true);
    expect(legal.canFold).toBe(true);
    expect(legal.canRaise).toBe(false);
    expect(legal.canAllIn).toBe(false);

    expectCode(() => applyAction(state, 0, raiseTo(200)), 'INVALID_ACTION');
    expectCode(() => applyAction(state, 0, { type: 'allIn' }), 'INVALID_ACTION');
    expect(() => applyAction(state, 0, call)).not.toThrow();
    expect(() => applyAction(state, 0, fold)).not.toThrow();
  });

  it('reopens betting after a full raise', () => {
    const start = beginHand({
      stacks: [1000, 1000, 1000],
      hole: { 0: 'AsKs', 1: 'QdQh', 2: '7c2d' },
      board: '2h5s9dTcJc',
    });
    const { state } = play(start.state, [
      [0, raiseTo(60)],
      [1, raiseTo(200)],
    ]);
    expect(state.raiseReopened).toBe(true);
    expect(state.lastRaiseSize).toBe(140);

    const { state: backToSeatZero } = play(state, [[2, fold]]);
    const legal = getLegalActions(backToSeatZero, 0);
    expect(legal.canRaise).toBe(true);
    expect(legal.minRaiseTo).toBe(340);
  });
});
