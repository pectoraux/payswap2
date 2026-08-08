# PaySwap2 — Roadmap to A

> **The rule for this roadmap:** every ticket closes on a number I can measure from
> a clean clone. No ticket is "done" because a module exists, because a file imports
> something, or because a commit says so. Three metrics I proposed earlier were
> satisfied sideways without the underlying thing moving — importer counts, `amount:`
> field counts, and failing-file counts. Each criterion below counts the thing itself.

## Baseline — measured at `81f8e3a`

| Dimension | Grade | The number |
|---|---|---|
| Routing identity | **A** | contract 28/0; `resolvePayment()` single rule |
| Security | **B−** | 16 public routes; rate limit in-process `Map`; HSM is `SoftwareHSM` simulator |
| Money correctness | **D+** | 1601 number-typed money fields vs 87 Money = **5.2%** |
| Scale / HA | **C+** | 135 singletons; authority-store 1 importer; no multi-instance proof |
| Test & CI | **B−** | 49 failing assertions; 315 type errors; **0** integration tests against a real DB |
| Ops surface | **B−** | components present, none proven under failure |

**Overall: B−.**

---

## What A means, per dimension

A is not "better." It's a specific, checkable state:

| Dimension | A is reached when |
|---|---|
| Routing | Contract green after every ticket below. Zero routing behaviour change. |
| Money | **0** number-typed money fields on the money path. Ledger balances on integers with no rounding shim. |
| Security | Deny-by-default proven by test; shared-store rate limiting; real KMS; no secret in env. |
| Scale | **Two instances against one database agree on every balance under concurrent load** — proven by a test, not an argument. |
| Test & CI | 0 failing assertions, 0 type errors, integration tests on real Postgres, coverage gate on money + routing. |
| Ops | Every failure mode exercised: retry storm, webhook outage, reconciliation break, kill switch, restart mid-settlement. |

---

## Phase M — Money to zero (the long pole)

1601 → 0. This is the largest single piece of work on the roadmap and everything in
Phase S depends on it, because you should not design database schemas around a money
representation you're about to replace.

**Order matters: smallest blast radius first, ledger before everything.** Once the
ledger is exact it becomes the oracle that proves every later module.

### M-1 · Finish `protocol/ledger` — **56 fields**
- `LedgerEntry.debit/credit` are already `Money` (done at `81f8e3a`). The module still
  has 56 number-typed money fields around them.
- **Exit:** `grep -rhoEi '\b(amount|balance|debit|credit|fee|reserve|total|available|locked|escrow|supply|capacity|exposure|collateral)[A-Za-z]*\??: number' src/protocol/ledger | wc -l` returns **0**.

### M-2 · `runtime/ledger` — **26 fields** · depends M-1
- Includes deleting the local `sumCents` helper in `engine.ts` in favour of real
  `Money` summation.
- **Exit:** 0 in `src/runtime/ledger`; no `Math.round(x * 100)` remains in the file.

### M-3 · `runtime/dispatcher` — **23 fields** · depends M-2
- This is `handlers.ts`, the money path. Fee maths becomes `Money.mulBps` +
  `Money.allocate` so splits sum exactly to the total.
- **Exit:** `handlers.ts:140` becomes `debitSum.equals(creditSum)` on `Money` — the
  `Math.round(× 100)` interim is deleted. The comment conceding "the input amounts are
  IEEE-754 doubles" is removed because it is no longer true.

### M-4 · `runtime/liquidity` — **49 fields** · depends M-3
- `settlement-waterfall.ts` included. **Run `routing.golden` after every commit here** —
  this is the file the contract exists to protect.
- **Exit:** 0 in `src/runtime/liquidity`; `routing.golden` still 14/0.

### M-5 · `protocol/treasury-v2` — **93 fields** · depends M-3
- Backing, limits, exposure, corridor funding. The backing verifier's 1:1 invariant
  becomes an exact integer comparison.
- **Exit:** 0 in `src/protocol/treasury-v2`; `treasury-v2.test.ts` passes (see T-2).

### M-6 · `kernel` — **217 fields** · depends M-5
- Largest, and last because the kernel is declared frozen — changing it late means
  changing it once, with every consumer already migrated.
- **Exit:** 0 in `src/kernel`.

### M-7 · Sweep the remainder + lock it
- Everything not covered above (`services`, `trust`, `app`, remaining `protocol`).
- Add an ESLint rule banning `number` for any identifier matching the money-ish
  pattern, so the count cannot regress.
- **Exit:** repo-wide count **0**; lint rule active; CI fails on reintroduction.

**Phase M exit criteria — all four must hold:**
```
money-ish fields typed number  : 0        (from 1601)
Math.round(x * 100) occurrences: 0
ledger balance check           : integer equality, no tolerance, no shim
routing.golden                 : 14/0
```

---

## Phase T — Test & CI to zero

Run in parallel with M. Several of the 49 failures are stale test-to-API drift, not
product bugs — but you can't tell which until they're fixed, and neither can I.

### T-1 · Kill the 49 failing assertions — **49 → 0**
Current: `chains` 10 · `connectors-v2` 10 · `resilience` 9 · `ops` 7 · `treasury-v2` 6 ·
`property` 4 · `ledger` 3.
- Fix or delete. A test asserting behaviour you no longer want is worse than no test.
- Promote each file into the CI `gate` job as it goes green, and lower the `suite`
  budget in the same PR.
- **Exit:** `suite` budget is **0**; every test file is in `gate`.

### T-2 · Make the backing-verifier tests pass — inside T-1, but call it out
- `treasury-v2` fails *"backing verifier blocks mint that would exceed reserve"* and
  *"MIN_BACKING_RATIO is 1.0 and reserves below threshold mark backing false."*
- Those test the W1 mint gate — the mechanism enforcing 1:1 twin-token backing. The
  call site is wired (`handlers.ts:403`), but its own tests say it doesn't enforce.
- **Until this passes, the core monetary invariant is unproven.** Highest-value single
  test on the board.
- **Exit:** both pass, and a property test mints against a randomly drained reserve and
  is always blocked.

### T-3 · Type errors — **315 → 0**
- `tsconfig` includes `**/*.ts` (tests, scripts, certification, skills, examples), so
  this covers everything. Keep it that way — narrowing the include to hit zero is
  cheating.
- Ratchet down in the existing CI job; never raise.
- **Exit:** `bunx tsc --noEmit` exits 0; `typecheck` moves into `gate`.

### T-4 · Integration tests against real Postgres — **currently 0**
- The single largest coverage hole. Everything today runs against in-memory state, so
  nothing proves the Prisma layer, transactions, constraints, or concurrent access.
- Postgres service container in CI (already scaffolded in the `schema-drift` job).
- Must cover: deposit→mint→withdraw→burn, concurrent double-spend on one wallet,
  idempotent retry, saga compensation after a mid-settlement crash.
- **Exit:** ≥1 integration test per money-moving endpoint; all green in CI.

### T-5 · Coverage gate on money + routing
- Line coverage ≥90% on `src/runtime/liquidity`, `src/protocol/ledger`,
  `src/runtime/ledger`, `src/protocol/treasury-v2`. Not repo-wide — a global number
  invites padding tests where they're easy.
- **Exit:** gate enforces the threshold on those four paths.

---

## Phase S — Scale to horizontal

Depends on Phase M (M-5 at least). Do not build schemas around float money.

### S-1 · Classify all 135 singletons
- Each is a **cache** (rebuildable from events; safe to duplicate) or an **authority**
  (must be globally unique). `rehydrateFromEvents` already proves the cache pattern.
- **Exit:** a checked-in inventory; every authority has a ticket.

### S-2 · Authority state into Postgres — **authority-store: 1 → all authorities**
- Reserve balances, netting obligations, exposure positions, mandates, supply counters.
- Reads may stay in-memory projections; **writes go through the database** with
  optimistic locking or `SELECT … FOR UPDATE`. `withOptimisticLock` already exists and
  is used in exactly one place.
- **Exit:** every authority identified in S-1 persists through the store.

### S-3 · Shared-store rate limiting
- `src/lib/rate-limiter.ts` holds an in-process `Map` — its own header comment
  concedes Redis is needed for multi-instance. Today N instances means N× the limit.
- **Exit:** limits hold across instances, proven by a test hitting two instances.

### S-4 · Leader election covers every periodic job
- `withLeadership` is wired into the net-settlement cycle and closed-loop controllers.
  Audit for any remaining bare `setInterval`.
- **Exit:** with 3 instances up, each cycle executes exactly once per interval. Three
  concurrent `settle()` calls on one corridor is a triple settlement, not a slowdown.

### S-5 · The proof test — **this is what makes Scale an A**
- Spin two app instances against one Postgres. Drive concurrent payments on the same
  corridor and the same wallet. Assert: no double-spend, reserve balances identical
  from both instances, trial balance exact, netting obligations consistent.
- **Exit:** this test is in CI and green. Without it, horizontal scale is a claim.

### S-6 · Zero-downtime rolling deploy
- Kill any instance mid-settlement; the saga resumes elsewhere and completes.
- **Exit:** demonstrated in a staging game day, with the event trail as evidence.

---

## Phase P — Security to A

### P-1 · Justify all 16 public routes
- Each `PUBLIC_ROUTES` entry is an endpoint reachable without a session. Some are
  correct (webhooks authenticate by signature; recovery is a front door by design).
- **Exit:** one-line justification per entry in the file; webhook routes verify
  signatures *before* any side effect; recovery is rate-limited per identifier and IP.

### P-2 · Real KMS — `SoftwareHSM` → managed
- `src/protocol/security/hsm.ts` is an in-process RSA-2048 simulator; the remote
  provider is a stub. Fine for dev, not for production signing keys.
- **Exit:** production signing/encryption keys live in a managed KMS; no private key
  material is readable from the app process; rotation is a runbook, not a redeploy.

### P-3 · Deny-by-default proven, not assumed
- A test enumerating all 433 `route.ts` files asserting each is in `PUBLIC_ROUTES` or
  returns 401 unauthenticated.
- **Exit:** in `gate`. A new unprotected route fails CI.

### P-4 · API key lifecycle
- Scopes exist (`keyPrefix`, `keyHash`, `scopes`). Prove them: a key scoped
  `payments:read` cannot create a payout; rotation overlaps two valid keys with no
  downtime.
- **Exit:** integration tests for both.

### P-5 · Supply chain + dependency scanning in CI
- `bun audit` / Dependabot / secret scanning on every PR.
- **Exit:** in `gate`; a known-vulnerable dependency fails the build.

### P-6 · PAN never enters the system
- If cards are ever supported, tokenize at the edge. PCI scope is far cheaper to avoid
  than to satisfy.
- **Exit:** a checked-in data-flow diagram showing no cardholder data in PaySwap systems.

---

## Phase O — Ops to A

Components exist. A means each is **proven under the failure it protects against.**

| Ticket | Proof required |
|---|---|
| **O-1** Idempotency | 100 concurrent retries of one payment create exactly one payment and one journal entry |
| **O-2** Webhooks | Merchant endpoint down 60 min → zero events lost, all delivered on recovery, signatures verify |
| **O-3** Reconciliation | Injected discrepancy in ledger / PSP / chain is alarmed within one cycle, naming amount and leg |
| **O-4** Observability | A slow payment is diagnosable from a trace alone. SLOs defined (auth latency, settlement success) with burn-rate alerts |
| **O-5** Migrations | Expand/contract; every migration backward-compatible with the previous release for one deploy cycle |
| **O-6** Kill switches | On-call disables tier 4 for one corridor in under 60s without a deploy — exercised in a game day |
| **O-7** Load test | Sustained target TPS with p99 inside SLO; published number, re-run in CI weekly |

---

## Sequencing

```
        ┌─ T-1 T-2 T-3 ──────────────────────────┐   (parallel throughout)
        │  T-4 integration tests ────────────────┤
Phase M ─┼─ M-1 → M-2 → M-3 → M-4 ───────────────┤
        │              └→ M-5 → M-6 → M-7 ───────┤
        │                                         │
Phase P ─┴─ P-1 P-3 P-5 (quick) ── P-2 P-4 P-6 ──┤
                                                  │
Phase S ──────────── (after M-5) S-1 → S-2 → S-3 → S-4 → S-5 → S-6
                                                  │
Phase O ─────────────────────────────── O-1..O-7 ─┘
```

**Hard constraints:**
- `routing.golden` green after **every** commit in Phase M. It is the only thing
  standing between a 1601-field refactor and a silent routing change.
- M-5 before S-2 — don't build schemas around a money type you're replacing.
- T-4 before S-5 — you can't prove multi-instance consistency without integration
  tests against a real database.
- T-2 as early as possible — the backing gate is the core monetary invariant and it is
  currently unproven.

---

## The A scorecard

Print this. A is reached when every number is in the right column.

| Metric | Baseline `81f8e3a` | A |
|---|---|---|
| Money-ish fields typed `number` | 1601 | **0** |
| `Math.round(x * 100)` occurrences | present | **0** |
| Failing test assertions | 49 | **0** |
| Type errors | 315 | **0** |
| Integration tests on real Postgres | 0 | **≥1 per money endpoint** |
| Coverage, money + routing modules | unmeasured | **≥90%** |
| Two-instance consistency test | none | **green in CI** |
| Unjustified public routes | 16 | **0** |
| Rate limiting | in-process `Map` | **shared store** |
| Signing keys | `SoftwareHSM` simulator | **managed KMS** |
| CI `suite` budget | 8 | **0** |
| `routing.golden` | 14/0 | **14/0** (unchanged) |

---

## One caution

Phase M is 1601 fields. At the current rate — 87 in several commits — that is weeks,
not days, and there is no shortcut: it's the most invasive refactor in the plan and it
touches the money path. That's fine, and it's the right call to do it now rather than
after launch, when the count only grows.

The thing to avoid is what has happened three times already: a commit headline that
implies more completion than the number supports. **Ship against the scorecard, not
against the ticket titles.** If someone downstream is making launch decisions from
commit messages, the scorecard is the artifact to show them instead.
