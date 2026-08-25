# Architecture

## The shape of the system

```
        HTTPS
Client ────────► Next.js on Vercel ──┐
   │              lobby, profile,    │
   │              history, admin     ├──► Postgres (Supabase)
   │   WSS                           │
   └───────────► Game server (Fly.io)┘
                  authoritative table state
                  dealing, betting, timers
```

Vercel serves pages. It never holds a hand. Every live table lives in memory
inside one long-running game-server process, which is the only writer of hand
outcomes. Both services verify the same Supabase-issued JWT independently.

## Why a monorepo

The game server and the web app both need the poker rules and both need the
wire types. If those lived inside the Next.js app — as the original spec laid
out, with `lib/poker/` and `server/poker/` side by side — a plain Node service
deploying to Fly would have to import out of a Next.js build graph, which is a
bundling fight on every release.

So: a pnpm workspace.

| Package                | Contains                                      | Depends on           |
| ---------------------- | --------------------------------------------- | -------------------- |
| `packages/engine`      | Poker rules. Pure, no I/O, zero dependencies. | nothing              |
| `packages/protocol` \* | Zod schemas and socket event types            | engine (types only)  |
| `packages/db` \*       | Prisma schema and generated client            | nothing              |
| `apps/web` \*          | Next.js app                                   | engine, protocol, db |
| `apps/game-server` \*  | Socket.IO server, table manager               | engine, protocol, db |

\* Not built yet. M2 adds `db`, M4 adds `protocol` and `game-server`.

The dependency arrows only point one way. The engine knows nothing about
sockets, Prisma, or React, which is what lets it be tested exhaustively without
any of them running.

## The poker engine

`packages/engine` is pure and deterministic. It has no clock, no globals, no
platform assumptions, and no dependencies — not even for SHA-256, which is
implemented in `sha256.ts` so the package stays importable anywhere.

The only source of nondeterminism is the `Rng` the caller passes in.
Production passes `secureRng()` (Web Crypto, with rejection sampling so the
shuffle is unbiased). Tests pass `seededRng('anything')` and get a hand that
replays identically every time. That injection is what makes the subsystem
testable at all.

**State transitions are pure functions.** `startHand(options)` and
`applyAction(state, seat, action)` return a _new_ state plus the events that
transition produced. Nothing is mutated in place, so a rejected action leaves
the previous state untouched and a caller can hold a snapshot safely.

```
preflop → flop → turn → river → showdown → payout → complete
                    └──────── or ────────┘
              everyone folds → payout → complete
```

### Invariants the engine enforces at runtime, not just in tests

- **Chip conservation.** Every hand asserts that the chips that came in equal
  the chips that went out. A violation throws rather than persisting, because a
  table that quietly mints or destroys chips is worse than a table that stops.
- **No duplicate cards.** Checked on the shuffle, on the deal, and on every
  board card.
- **Server-authoritative action legality.** `resolveAction` is the single place
  a move is validated. Out of turn, wrong amount, folded, all-in, betting not
  reopened, hand already over — all rejected there, with a structured code.

### Two rules that are easy to get wrong, and are covered

- **Incomplete all-in raises do not reopen betting.** If a player shoves for
  less than a full raise, anyone who already acted may only call or fold, and
  the minimum raise stays anchored to the last _full_ raise.
- **Odd chips go left of the button.** When a pot does not divide evenly, the
  spare chips go to winners in clockwise order starting immediately left of the
  button. Over enough split pots, getting this wrong is a systematic bias.

## Security model

**The client is never trusted.** Not for cards, winners, pots, chip balances,
valid actions, or game state. All of it is decided server-side.

**Hole-card privacy is structural.** `HandState` contains every player's cards
and the undealt deck, and it has no serialiser. The only shape that may leave
the server is `projectHandState(state, viewerId)` — the viewer's identity is a
required argument, so redaction cannot be forgotten by omission. A player sees
their own cards at any time; everyone else's are `null` with an accurate
`holeCardCount` so the client can still draw card backs. At showdown, the hands
that reached it are revealed. A hand won because everyone folded is never shown.

**Race conditions are handled by serialisation, not transactions.** By the time
a transaction commits, the state has already been read — which is too late for
two players acting in the same millisecond, or a turn timer firing while an
action is in flight. The design (M4) is one authoritative owner per table with a
serialised command queue: one action processed to completion before the next
starts.

**Duplicate submits are handled by sequencing.** Table state carries a monotonic
`seq`. A client echoes the `seq` it acted on, and a stale value is rejected with
`STALE_ACTION` — which means a double-tapped Fold button is harmless, using the
same mechanism that rejects a replayed hostile request.

**Errors never leak internals.** `EngineError.toWire()` returns a code, a
message, and explicit details. No stack, no state.

## Fairness

Before a hand is dealt the server can publish `SHA-256(handId ‖ seed)`. After
the hand it publishes the seed, and any player can recompute the hash and
confirm the deck order was fixed before a single card was seen. The engine
burns cards before each street exactly as a live deal would, so a revealed seed
replays the deal card for card.

This proves the deck was not changed mid-hand. It is **not** an RNG or RTP
certification — that requires an accredited testing lab. Nothing in the product
may describe itself as certified or audited until one has signed off.

## Data model (M2, not built)

Chips are **moved**, never copied. Sitting down debits `PlayerWallet` and
credits `TablePlayer.chipStack` in one transaction; standing up reverses it. An
append-only `ChipLedger` records every movement so any balance is
reconstructible and any discrepancy is auditable. Treating both as balances is
how a crash mid-hand mints chips out of nothing.

In-memory state is the source of truth _during_ a hand. Postgres receives an
append-only `HandAction` log plus a snapshot at each street boundary and at
hand completion — enough to reconstruct any hand exactly, which is what makes
replay real rather than aspirational, and few enough writes that the table
still feels instant.

## Compliance boundaries

Money movement, age verification, geolocation, and responsible-gaming tooling
are deliberately absent. When they are added they attach at named service
interfaces that currently do not exist and, when they do, will throw rather
than return a fake success. Implementing them requires qualified gaming counsel
first; the business plan treats regulatory approval, not technology, as the
long pole.
