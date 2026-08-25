# Apex Poker

A mobile-first social poker platform. **Virtual play chips only** — no deposits, no
withdrawals, no prize redemption, no real-money wagering.

## Status

Two of ten milestones are built. This is a working, tested poker engine and the
repository scaffolding around it; there is no UI, database, or server yet.

| Milestone | Scope                                        | State       |
| --------- | -------------------------------------------- | ----------- |
| M0        | Monorepo, TypeScript, lint, tests            | Done        |
| M1        | Poker engine (`@apex/engine`)                | Done        |
| M2        | Prisma schema, Supabase Postgres             | Not started |
| M3        | Supabase Auth, profile, app shell            | Not started |
| M4        | Socket.IO game server                        | Not started |
| M5        | Lobby and table UI                           | Not started |
| M6        | Profiles, leaderboards, private tables, chat | Not started |
| M7        | Hand history                                 | Not started |
| M8        | Admin and trust dashboard                    | Not started |
| M9        | Polish, accessibility, deployment            | Not started |

## Tech stack

- **Language** — TypeScript, strict, across every package
- **Web** (M3+) — Next.js App Router, React, Tailwind, shadcn/ui, deployed to Vercel
- **Game server** (M4+) — Node + Socket.IO on Fly.io, holding authoritative table state
- **Database** (M2+) — Postgres on Supabase, accessed through Prisma
- **Auth** (M3+) — Supabase Auth; the game server verifies the JWT itself
- **Tests** — Vitest, with Playwright once there is a UI worth walking through

Vercel's serverless functions cannot hold a live poker table in memory, so the
game server is a separate long-running process. See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Layout

```
packages/
  engine/          @apex/engine — pure poker rules. No I/O, no dependencies.
apps/              (M3+) web and game-server live here
```

## Local setup

Requires Node 20.11+ and pnpm 10.

```bash
pnpm install
pnpm check          # typecheck + lint + test
```

There is nothing to run yet — no dev server exists until M3. The engine is a
library; exercise it through the test suite.

## Testing

```bash
pnpm test              # full suite
pnpm test:watch        # watch mode
pnpm test:coverage     # with coverage thresholds enforced
```

The engine has 112 tests. The evaluator is cross-checked against a separate
brute-force implementation over every five-card hand in two exhaustive
twenty-card subsets plus 30,000 random seven-card deals, and the state machine
is fuzzed across 300 random hands asserting that chips are conserved and no
card is ever dealt twice. See [DEVELOPMENT.md](./DEVELOPMENT.md).

## Environment variables

Copy `.env.example` and fill in what the milestones you are running need. The
engine itself needs none — every source of randomness is injected by the caller.

## Deployment

Not yet applicable. The intended shape (M9) is Next.js on Vercel, the game
server on Fly.io, and managed Postgres on Supabase.

## Scope and compliance

This MVP implements play-chip poker only. `PaymentService`,
`ComplianceService`, `AgeVerificationService`, `GeolocationService`, and
`ResponsibleGamingService` will exist as unimplemented interfaces that throw —
never as stubs that quietly return success.

Nothing in this product is certified or independently audited, and no part of
it may describe itself that way. The shuffle commitment in
`packages/engine/src/fairness.ts` proves the deck was not changed mid-hand; it
is not an RNG certification. Real-money or sweepstakes functionality requires
qualified gaming counsel and accredited testing before any of it is built.
