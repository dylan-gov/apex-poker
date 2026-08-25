# Apex Poker — working notes for Claude Code

Read this before changing anything. `ARCHITECTURE.md` has the reasoning;
this file has the rules.

## What this is

A mobile-first poker platform, **virtual play chips only**. M0 (monorepo) and
M1 (poker engine) are built and tested. M2 onward are not started — see the
milestone table in `README.md`.

## Hard rules

1. **No real-money functionality.** No deposits, withdrawals, cash prizes,
   sweepstakes redemption, crypto, or wagering of anything with value. No
   production KYC, AML, or geofencing. When those seams are needed they are
   unimplemented interfaces that **throw** — never stubs that return a fake
   success, which is how fake compliance ships by accident.
2. **Never claim certification.** Nothing here is audited or certified by an
   accredited lab. The shuffle commitment proves the deck was not changed
   mid-hand; it is not an RNG or RTP certification. Do not write copy, comments,
   or UI that implies otherwise.
3. **The server is authoritative.** The client is never trusted for cards,
   winners, pots, chip balances, valid actions, or game state.
4. **`HandState` never leaves the server.** It holds every player's hole cards
   and the undealt deck. The only thing that crosses the wire is
   `projectHandState(state, viewerId)`. If you find yourself serialising raw
   state — into a payload, a log a client can see, or an error — that is the bug.
5. **`packages/engine` stays pure.** No I/O, no `node:` imports, no
   dependencies, no globals beyond Web Crypto. ESLint enforces the imports.
6. **Chips are moved, never copied.** Wallet to seat on sit-down, seat to wallet
   on stand-up, one transaction, append-only ledger. Never treat both as
   independent balances.

## Before you commit

```bash
pnpm check     # typecheck + lint + test
```

All three must pass. Do not skip tests to move faster on this subsystem — a
wrong hand ranking pays the wrong player silently.

## Conventions

- **Bets are totals.** `{ type: 'raise', toAmount: 300 }` means the street
  contribution becomes 300, not that 300 is added.
- **Cards are integers.** `card = rank * 4 + suit`; rank 0 = deuce; suits are
  clubs, diamonds, hearts, spades. Use `parseCards('AsKd')` / `cardsToString`.
- **Errors are structured.** `fail('CODE', 'message', { details })`, never a bare
  `Error`. Codes are a closed union in `packages/engine/src/errors.ts`; add to
  the union rather than inventing strings.
- **State transitions are pure.** `applyAction` returns a new state and the
  events it produced. Nothing mutates in place.
- **`noUncheckedIndexedAccess` is on.** `seats[n]` really can be empty — check
  it. Use `!` only where the index is in range by construction.

## Where things go

| I want to...                  | Go to                                   |
| ----------------------------- | --------------------------------------- |
| change a poker rule           | `packages/engine/src/` — and add a test |
| add a wire type or Zod schema | `packages/protocol` (create it in M4)   |
| touch the database            | `packages/db` (create it in M2)         |
| add a page                    | `apps/web` (create it in M3)            |
| change table state handling   | `apps/game-server` (create it in M4)    |

Dependencies point one way: apps depend on packages, packages do not depend on
apps, and the engine depends on nothing.

## Building the next milestone

Work one milestone at a time and finish it. Each has a gate in the roadmap that
has to be demonstrably true before the next one starts — M4's in particular
(two headless clients play a hand, one force-disconnects mid-street and
reconnects without corrupting the hand) is worth proving before any UI exists.

Two things to design before writing M4 code, both in `ARCHITECTURE.md`:

- one authoritative owner per table with a **serialised command queue** — this,
  not database transactions, is what prevents races
- the monotonic `seq` echo, which the engine already supports via
  `applyAction(state, seat, action, clientSeq)`

## Reference

- `ARCHITECTURE.md` — system shape, security model, data model decisions
- `DEVELOPMENT.md` — how the engine is tested, and how to write hand tests
- `API.md` — the engine's public interface, events, and error codes
