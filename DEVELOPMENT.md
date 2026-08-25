# Development

## Requirements

- Node 20.11 or newer
- pnpm 10 (`corepack enable` will provide it)

## Commands

```bash
pnpm install
pnpm check            # typecheck + lint + test — run this before every commit
pnpm typecheck
pnpm lint             # pnpm lint:fix to autofix
pnpm format           # prettier --write
pnpm test
pnpm test:watch
pnpm test:coverage    # fails below 90% lines / 85% branches on the engine
pnpm build
```

## How the engine is tested

The engine is the one subsystem where a bug is silent and expensive: a
mis-ranked hand pays the wrong player and nobody notices until someone
reconstructs the history. So it is tested by contradiction rather than by
example.

**An independent reference evaluator.** `test/reference-evaluator.ts` is a
second, deliberately naive hand evaluator. It sorts plain arrays, counts with a
`Map`, and brute-forces all 21 five-card subsets of a seven-card hand. The
production evaluator uses rank bitmasks and resolves flushes in a single pass.
The two share no code and no approach.

They are compared on:

- every five-card hand from two exhaustive twenty-card subsets (31,008 hands) —
  deuce-to-five plus aces to cover the wheel and the steel wheel, ten-to-ace to
  cover broadway and the royal
- 30,000 random seven-card hands, on category
- 30,000 random pairs sharing a board, on **who wins** — which is the property
  that actually matters, ties included, because a disagreement about a chop is a
  disagreement about money

**A fuzzer over the state machine.** 300 random hands: random seat counts, random
occupied seats, random stacks, random antes, random legal actions until the hand
completes. Each one asserts that chips are conserved, that no stack goes
negative, and that no card was dealt twice.

**Named edge cases.** Side pots with three simultaneous all-ins. Odd-chip splits
in button order. Incomplete all-in raises not reopening the betting. Uncalled
bets returned. The big blind's option. Heads-up button order, which inverts
between preflop and postflop.

Everything is deterministic: seeded RNG, or a stacked deck built by
`test/helpers.ts` that deals exactly the cards a test asks for, in real dealing
order, burns included.

## Writing tests

`test/helpers.ts` covers most of what a hand test needs:

```ts
import { beginHand, play, call, check, fold, raiseTo, netOf } from './helpers.js';

const start = beginHand({
  stacks: [1000, 1000, 1000], // indexed by seat; 0 means empty
  hole: { 0: 'AcAd', 1: '7c7d', 2: 'QsJs' },
  board: 'Ah7h2s9cKd',
});

const { state } = play(start.state, [
  [0, call],
  [1, call],
  [2, check],
  // ...
]);

expect(netOf(state, 0)).toBe(40);
```

`beginHand` works out the dealing order from the button and stacks the deck so
those exact cards come out.

## Conventions

- **The engine stays pure.** No I/O, no `node:` imports, no dependencies. ESLint
  enforces the import rule; the rest is on review. If a change to
  `packages/engine` needs a package, it probably belongs in a different package.
- **Bets are expressed as totals.** `raiseTo(300)` means "your street
  contribution becomes 300", not "add 300". Every real poker client speaks in
  totals and it removes a whole class of off-by-one-bet bugs.
- **Cards are integers.** `card = rank * 4 + suit`, rank 0 = deuce, suit order
  clubs/diamonds/hearts/spades. They sort, serialise, and bit-twiddle for free.
  `parseCards('AsKd')` and `cardsToString` handle the human end.
- **`noUncheckedIndexedAccess` is on.** Array access is `T | undefined`. Use `!`
  where an index is in range by construction, and a real check where it is not —
  `seats[n]` genuinely can be empty.
- **Errors are structured.** Throw `fail('CODE', 'message', { details })`, never
  a bare `Error`. Codes are a closed union in `src/errors.ts`.

## What comes next

M2 adds `packages/db` with the Prisma schema. Before writing it, read the data
model section of [ARCHITECTURE.md](./ARCHITECTURE.md) — the chip ledger and the
wallet/stack relationship are decisions worth getting right the first time.
