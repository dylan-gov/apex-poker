import { describe, expect, it } from 'vitest';
import { getLegalActions } from '../src/betting.js';
import { cardsToString, findDuplicate } from '../src/cards.js';
import { createShoe } from '../src/deck.js';
import { EngineError } from '../src/errors.js';
import { applyAction, currentPot, isComplete, startHand } from '../src/game-state.js';
import { seededRng, type Rng } from '../src/rng.js';
import type { HandState, PlayerAction } from '../src/types.js';
import {
  allIn,
  beginHand,
  betTo,
  call,
  check,
  fold,
  netOf,
  play,
  raiseTo,
  stackOf,
} from './helpers.js';

describe('starting a hand', () => {
  it('posts blinds and starts the action under the gun', () => {
    const { state, events } = beginHand({
      stacks: [1000, 1000, 1000],
      hole: { 0: 'AsKs', 1: 'QdQh', 2: '7c2d' },
      board: '2h5s9dTcJc',
    });

    expect(state.phase).toBe('preflop');
    expect(stackOf(state, 1)).toBe(990);
    expect(stackOf(state, 2)).toBe(980);
    expect(state.currentBet).toBe(20);
    expect(state.lastRaiseSize).toBe(20);
    expect(state.actionSeat).toBe(0);
    expect(currentPot(state)).toBe(30);

    expect(events.map((event) => event.type)).toEqual([
      'HAND_STARTED',
      'BLINDS_POSTED',
      'CARDS_DEALT',
      'ACTION_REQUIRED',
    ]);
  });

  it('deals two hole cards to everyone and never repeats a card', () => {
    const { state } = beginHand({
      stacks: [1000, 1000, 1000],
      hole: { 0: 'AsKs', 1: 'QdQh', 2: '7c2d' },
      board: '2h5s9dTcJc',
    });
    expect(cardsToString(state.seats[0]!.holeCards)).toBe('As Ks');
    expect(cardsToString(state.seats[1]!.holeCards)).toBe('Qd Qh');
    expect(cardsToString(state.seats[2]!.holeCards)).toBe('7c 2d');
    const dealt = state.seats.flatMap((seat) => seat?.holeCards ?? []);
    expect(findDuplicate(dealt)).toBeNull();
  });

  it('puts the button on the small blind heads-up', () => {
    const { state } = beginHand({
      stacks: [500, 500],
      hole: { 0: 'AsKs', 1: 'QdQh' },
      board: '2h5s9dTcJc',
    });
    expect(stackOf(state, 0)).toBe(490); // button posted the small blind
    expect(stackOf(state, 1)).toBe(480);
    expect(state.actionSeat).toBe(0); // and acts first preflop

    const flop = play(state, [
      [0, call],
      [1, check],
    ]).state;
    expect(flop.phase).toBe('flop');
    expect(flop.actionSeat).toBe(1); // but last after the flop
  });

  it('refuses to start an impossible hand', () => {
    const base = {
      handId: 'h',
      handNumber: 1,
      seatCount: 6,
      buttonSeat: 0,
      smallBlind: 10,
      bigBlind: 20,
      shoe: createShoe(seededRng('start')),
    };
    expect(() => startHand({ ...base, players: [{ seat: 0, playerId: 'a', stack: 100 }] })).toThrow(
      /at least two/,
    );
    expect(() =>
      startHand({
        ...base,
        buttonSeat: 4,
        players: [
          { seat: 0, playerId: 'a', stack: 100 },
          { seat: 1, playerId: 'b', stack: 100 },
        ],
      }),
    ).toThrow(/button must sit on an occupied seat/i);
    expect(() =>
      startHand({
        ...base,
        players: [
          { seat: 0, playerId: 'a', stack: 0 },
          { seat: 1, playerId: 'b', stack: 100 },
        ],
      }),
    ).toThrow(EngineError);
    expect(() =>
      startHand({
        ...base,
        players: [
          { seat: 0, playerId: 'a', stack: 100 },
          { seat: 0, playerId: 'b', stack: 100 },
        ],
      }),
    ).toThrow(/already occupied/);
  });
});

describe('hands that end before showdown', () => {
  it('gives the blind back and the pot to the last player standing', () => {
    const { state } = play(
      beginHand({
        stacks: [1000, 1000, 1000],
        hole: { 0: 'AsKs', 1: 'QdQh', 2: '7c2d' },
        board: '2h5s9dTcJc',
      }).state,
      [
        [0, fold],
        [1, fold],
      ],
    );

    expect(isComplete(state)).toBe(true);
    expect(netOf(state, 0)).toBe(0);
    expect(netOf(state, 1)).toBe(-10);
    expect(netOf(state, 2)).toBe(10); // won the small blind, got its own back
    expect(state.results.every((result) => !result.wentToShowdown)).toBe(true);
  });

  it('returns a river bet nobody called', () => {
    const start = beginHand({
      stacks: [1000, 1000],
      hole: { 0: 'AsKs', 1: 'QdQh' },
      board: '2h5s9dTcJc',
    });
    const { state } = play(start.state, [
      [0, call],
      [1, check],
      [1, check],
      [0, check], // flop
      [1, check],
      [0, check], // turn
      [1, betTo(300)],
      [0, fold], // river
    ]);

    expect(isComplete(state)).toBe(true);
    expect(netOf(state, 1)).toBe(20); // the 300 came straight back
    expect(netOf(state, 0)).toBe(-20);
  });
});

describe('hands that reach showdown', () => {
  it('pays the best hand and reports what everyone held', () => {
    const start = beginHand({
      stacks: [1000, 1000, 1000],
      hole: { 0: 'AcAd', 1: '7c7d', 2: 'QsJs' },
      board: 'Ah7h2s9cKd',
    });
    const { state, events } = play(start.state, [
      [0, call],
      [1, call],
      [2, check], // preflop
      [1, check],
      [2, check],
      [0, check], // flop
      [1, check],
      [2, check],
      [0, check], // turn
      [1, check],
      [2, check],
      [0, check], // river
    ]);

    expect(state.phase).toBe('complete');
    expect(state.board).toHaveLength(5);
    expect(netOf(state, 0)).toBe(40);
    expect(netOf(state, 1)).toBe(-20);
    expect(netOf(state, 2)).toBe(-20);

    const showdown = events.find((event) => event.type === 'SHOWDOWN');
    expect(showdown).toBeDefined();
    expect(state.results.find((result) => result.seat === 0)?.handDescription).toBe(
      'Three of a Kind, Aces',
    );
    expect(state.results.find((result) => result.seat === 1)?.handDescription).toBe(
      'Three of a Kind, Sevens',
    );
    expect(events.some((event) => event.type === 'POT_AWARDED')).toBe(true);
    expect(events.at(-1)?.type).toBe('HAND_COMPLETED');
  });

  it('reveals the streets in order', () => {
    const start = beginHand({
      stacks: [1000, 1000],
      hole: { 0: 'AsKs', 1: 'QdQh' },
      board: '2h5s9dTcJc',
    });
    const { events } = play(start.state, [
      [0, call],
      [1, check],
      [1, check],
      [0, check],
      [1, check],
      [0, check],
      [1, check],
      [0, check],
    ]);
    const reveals = events.map((event) => event.type).filter((type) => type.endsWith('_REVEALED'));
    expect(reveals).toEqual(['FLOP_REVEALED', 'TURN_REVEALED', 'RIVER_REVEALED']);
  });

  it('builds a side pot the short stack cannot win', () => {
    const start = beginHand({
      stacks: [1000, 100, 1000],
      hole: { 0: 'KsKh', 1: 'AcAd', 2: '7c7d' },
      board: '2h5s9dTcJc',
    });
    const { state } = play(start.state, [
      [0, raiseTo(200)],
      [1, allIn], // short stack in for 100
      [2, call], // calls the full 200
      [2, check],
      [0, check], // flop
      [2, check],
      [0, check], // turn
      [2, check],
      [0, check], // river
    ]);

    expect(state.pots).toEqual([
      { amount: 300, eligibleSeats: [0, 1, 2] },
      { amount: 200, eligibleSeats: [0, 2] },
    ]);
    // Aces take the main pot; kings take the side pot the aces could not reach.
    expect(netOf(state, 1)).toBe(200);
    expect(netOf(state, 0)).toBe(0);
    expect(netOf(state, 2)).toBe(-200);
  });

  it('runs the board out when nobody can act any more', () => {
    const start = beginHand({
      stacks: [100, 100],
      hole: { 0: 'AcAd', 1: '7c7d' },
      board: 'Ah7h2s9cKd',
    });
    const { state, events } = play(start.state, [
      [0, allIn],
      [1, call],
    ]);

    expect(state.phase).toBe('complete');
    expect(state.board).toHaveLength(5);
    expect(netOf(state, 0)).toBe(100);
    expect(netOf(state, 1)).toBe(-100);
    // No further action was ever requested after both players were all in.
    const lastActionRequired = events.map((e) => e.type).lastIndexOf('ACTION_REQUIRED');
    const showdownIndex = events.map((e) => e.type).indexOf('SHOWDOWN');
    expect(lastActionRequired).toBeLessThan(showdownIndex);
  });

  it('gives the odd chip to the first winner left of the button', () => {
    const start = beginHand({
      stacks: [1000, 1000, 1000],
      hole: { 0: 'KcKd', 1: '2c3d', 2: '4c5d' },
      board: 'AsKsQsJd9h',
      ante: 1,
    });
    const { state } = play(start.state, [
      [0, fold],
      [1, call],
      [2, check], // preflop
      [1, check],
      [2, check], // flop
      [1, check],
      [2, check], // turn
      [1, check],
      [2, check], // river
    ]);

    // Both remaining players play the board for a 43-chip pot.
    expect(state.pots).toEqual([{ amount: 43, eligibleSeats: [1, 2] }]);
    expect(netOf(state, 1)).toBe(1); // 22 back on 21 in
    expect(netOf(state, 2)).toBe(0); // 21 back on 21 in
    expect(netOf(state, 0)).toBe(-1); // paid the ante and folded
  });
});

describe('determinism and invariants', () => {
  it('replays identically from the same seed', () => {
    const deal = (): HandState => {
      const { state } = startHand({
        handId: 'replay',
        handNumber: 9,
        seatCount: 6,
        buttonSeat: 0,
        smallBlind: 10,
        bigBlind: 20,
        players: [
          { seat: 0, playerId: 'a', stack: 1000 },
          { seat: 2, playerId: 'b', stack: 1000 },
          { seat: 4, playerId: 'c', stack: 1000 },
        ],
        shoe: createShoe(seededRng('a-fixed-seed')),
      });
      return play(state, [
        [0, call],
        [2, call],
        [4, check],
        [2, betTo(60)],
        [4, call],
        [0, fold],
      ]).state;
    };

    const first = deal();
    const second = deal();
    expect(second.board).toEqual(first.board);
    expect(second.actions).toEqual(first.actions);
    expect(second.seats.map((seat) => seat?.holeCards)).toEqual(
      first.seats.map((seat) => seat?.holeCards),
    );
  });

  it('never mutates the state it was given', () => {
    const { state } = beginHand({
      stacks: [1000, 1000],
      hole: { 0: 'AsKs', 1: 'QdQh' },
      board: '2h5s9dTcJc',
    });
    const before = JSON.stringify(state);
    applyAction(state, 0, raiseTo(60));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('conserves chips and cards across a few hundred random hands', () => {
    const rng = seededRng('fuzz');

    const randomAction = (state: HandState, source: Rng): PlayerAction => {
      const seat = state.actionSeat!;
      const legal = getLegalActions(state, seat);
      const options: PlayerAction[] = [];
      if (legal.canCheck) options.push(check);
      if (legal.canCall) options.push(call);
      if (legal.canFold) options.push(fold);
      if (legal.canBet) {
        options.push(betTo(Math.min(legal.maxRaiseTo, legal.minBetTo + source.nextInt(120))));
      }
      if (legal.canRaise) {
        options.push(raiseTo(Math.min(legal.maxRaiseTo, legal.minRaiseTo + source.nextInt(200))));
      }
      if (legal.canAllIn) options.push(allIn);
      expect(options.length).toBeGreaterThan(0);
      return options[source.nextInt(options.length)]!;
    };

    for (let hand = 0; hand < 300; hand++) {
      const seatCount = 2 + rng.nextInt(8);
      const playerCount = 2 + rng.nextInt(seatCount - 1);
      const seats = [...Array(seatCount).keys()];
      for (let i = seats.length - 1; i > 0; i--) {
        const j = rng.nextInt(i + 1);
        [seats[i], seats[j]] = [seats[j]!, seats[i]!];
      }
      const chosen = seats.slice(0, playerCount).sort((a, b) => a - b);
      const players = chosen.map((seat) => ({
        seat,
        playerId: `p${seat}`,
        stack: 20 + rng.nextInt(2000),
      }));
      const chipsBefore = players.reduce((sum, player) => sum + player.stack, 0);

      let { state } = startHand({
        handId: `fuzz-${hand}`,
        handNumber: hand,
        seatCount,
        buttonSeat: chosen[rng.nextInt(chosen.length)]!,
        smallBlind: 5,
        bigBlind: 10,
        ante: rng.nextInt(3),
        players,
        shoe: createShoe(seededRng(`fuzz-deck-${hand}`)),
      });

      let guard = 0;
      while (!isComplete(state) && guard++ < 500) {
        state = applyAction(state, state.actionSeat!, randomAction(state, rng)).state;
      }

      expect(isComplete(state)).toBe(true);
      const chipsAfter = state.results.reduce((sum, result) => sum + result.endingStack, 0);
      expect(chipsAfter).toBe(chipsBefore);
      expect(state.results.reduce((sum, result) => sum + result.net, 0)).toBe(0);
      expect(state.results.every((result) => result.endingStack >= 0)).toBe(true);

      const allCards = [
        ...state.board,
        ...state.burned,
        ...state.seats.flatMap((seat) => seat?.holeCards ?? []),
      ];
      expect(findDuplicate(allCards)).toBeNull();
    }
  });
});
