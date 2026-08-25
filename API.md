# API

There is no HTTP or WebSocket API yet — M4 adds it. What exists today is the
engine's programmatic interface, documented here because the server will be a
thin layer over it.

## `@apex/engine`

### Starting a hand

```ts
import { createShoe, secureRng, startHand } from '@apex/engine';

const { state, events } = startHand({
  handId: 'h_01J...',
  handNumber: 42,
  seatCount: 9,
  buttonSeat: 3,
  smallBlind: 10,
  bigBlind: 20,
  ante: 0, // optional
  players: [
    { seat: 3, playerId: 'u_abc', stack: 2000 },
    { seat: 5, playerId: 'u_def', stack: 1500 },
  ],
  shoe: createShoe(secureRng()),
  commitment: '9f86d0...', // optional, see Fairness
  seed: 'a1b2...', // optional, revealed at hand end
});
```

Throws `NOT_ENOUGH_PLAYERS`, `SEAT_TAKEN`, `INSUFFICIENT_CHIPS`,
`INVALID_AMOUNT`, or `INVALID_STATE` on a hand that cannot legally start.

### Applying an action

```ts
import { applyAction } from '@apex/engine';

const next = applyAction(state, seat, { type: 'raise', toAmount: 300 }, clientSeq);
```

`toAmount` is the total the player's street contribution becomes — "raise to
300", not "raise by 300". It is ignored by `fold`, `check`, `call`, and `allIn`.

`clientSeq` is optional but the server should always pass it: it is the `seq`
the client saw when it decided to act. A mismatch is rejected with
`STALE_ACTION`, which is what makes a duplicate submit harmless.

Returns a **new** state; the input is never mutated.

### Asking what is legal

```ts
import { getLegalActions } from '@apex/engine';

const legal = getLegalActions(state, seat);
// { canFold, canCheck, canCall, callAmount, canBet, minBetTo,
//   canRaise, minRaiseTo, maxRaiseTo, canAllIn, allInTo }
```

Drive the action bar from this. The engine re-validates everything anyway —
the UI showing only legal buttons is a courtesy, not a control.

### Projecting state for a client

```ts
import { projectHandState } from '@apex/engine';

socket.emit('TABLE_STATE', projectHandState(state, viewerId));
```

**Never send `HandState` itself.** It contains every player's hole cards and the
undealt deck. `projectHandState` is the only shape that may cross the wire; the
viewer's identity is a required argument so redaction cannot be skipped by
accident. Pass `null` for a spectator.

### Fairness

```ts
import {
  commitToShuffle,
  generateSeed,
  verifyShuffleCommitment,
  seededRng,
  createShoe,
} from '@apex/engine';

const seed = generateSeed((n) => secureRng().nextInt(n));
const { commitment } = commitToShuffle(handId, seed); // publish before the deal
const shoe = createShoe(seededRng(seed));

// after the hand, publish `seed`; anyone can check:
verifyShuffleCommitment(commitment, handId, seed); // true
```

### Hand evaluation

```ts
import { evaluate, compareHands, describeHand, parseCards } from '@apex/engine';

const hand = evaluate(parseCards('AcAd Ah7h2s9cKd')); // 5 to 7 cards
hand.value; // single comparable integer; equal means a genuine chop
hand.category; // HandCategory.ThreeOfAKind
describeHand(hand); // 'Three of a Kind, Aces'
compareHands(a, b); // <0, 0, >0
```

## Events

`startHand` and `applyAction` return the events that transition produced. The
server forwards them, projecting anything card-bearing per viewer.

| Event                                                | Emitted when                                         |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `HAND_STARTED`                                       | a hand begins; carries the shuffle commitment        |
| `BLINDS_POSTED`                                      | antes and blinds are in                              |
| `CARDS_DEALT`                                        | hole cards are dealt (seat numbers only)             |
| `ACTION_REQUIRED`                                    | it is a seat's turn; carries `seq` and legal actions |
| `PLAYER_ACTION`                                      | an action was accepted                               |
| `FLOP_REVEALED` / `TURN_REVEALED` / `RIVER_REVEALED` | a community street is dealt                          |
| `SHOWDOWN`                                           | hands are turned over                                |
| `POT_AWARDED`                                        | a pot is paid, once per winner per pot               |
| `HAND_COMPLETED`                                     | results are final; carries the revealed seed         |

Table-level events from the product spec — `TABLE_STATE`, `PLAYER_JOINED`,
`PLAYER_LEFT`, `CHAT_MESSAGE` — belong to the game server in M4. The engine has
no concept of connections, seats emptying, or chat.

## Error codes

Every rejection is an `EngineError` with a stable `code`. Use
`error.toWire()` to get a client-safe `{ code, message, details }` — no stack,
no internal state.

| Code                                                 | Meaning                                            |
| ---------------------------------------------------- | -------------------------------------------------- |
| `NOT_YOUR_TURN`                                      | acted out of turn, or for another seat             |
| `INVALID_ACTION`                                     | the action is not available in this position       |
| `INVALID_AMOUNT`                                     | bet or raise size is not legal                     |
| `INSUFFICIENT_CHIPS`                                 | more than the stack can cover                      |
| `PLAYER_NOT_FOUND`                                   | the seat is empty                                  |
| `HAND_ALREADY_COMPLETE`                              | the hand is no longer accepting actions            |
| `STALE_ACTION`                                       | based on an out-of-date view; also catches replays |
| `SEAT_TAKEN`                                         | two players assigned the same seat                 |
| `NOT_ENOUGH_PLAYERS`                                 | fewer than two seated                              |
| `INVALID_CARD` / `DUPLICATE_CARD` / `DECK_EXHAUSTED` | dealing invariants broken                          |
| `INVALID_STATE`                                      | the engine was asked for something impossible      |

Transport-level codes the spec also calls for — `TABLE_NOT_FOUND`,
`UNAUTHORIZED`, `RATE_LIMITED`, `CONNECTION_LOST` — will live in
`packages/protocol` alongside the socket schemas, since the engine has no idea
what a connection is.
