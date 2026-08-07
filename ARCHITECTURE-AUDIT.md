# PaySwap Architecture Audit & Roadmap (v3 — Post-Wiring, Honest)

> **One-sentence vision:** A liquidity network with two reserve layers (local
> FIAT, cross-border crypto) where every observer is paired with an actuator,
> and demo + live data share one pipeline with zero contamination.

---

## The two design principles this audit measures against

1. **No orphans.** Every observer (`ReserveDriftMonitor`, `BackingVerifier`,
   `MigrationProposalEngine`, `ReserveMonitor`, `RuntimeHost`) must be wired
   to an actuator that ACTS on what the observer computes. A dashboard that
   reports a problem the system doesn't fix is worse than no dashboard —
   because the dashboard says the problem is handled.
2. **No contamination.** Demo and live data must flow through the same
   pipeline (so demo code is production-tested) but never mix at any layer
   (event store, snapshot, projection, singleton state, invariant engine).

---

## Vision vs Reality (v3 — more honest, more granular)

> Legend: ✅ done · 🟡 computed but not acted on · 🟠 computed but isolated from
> production · 🔴 missing or broken · ⚠️ partial

### A. The money path

| # | Vision | Reality | Status |
|---|---|---|---|
| A1 | One pipeline: API → `runtimeHost.execute()` → dispatcher → handler → invariant → event store → projection | Production `paymentService` / `refundService` / `payoutService` call `runtime.dispatcher.dispatch()` directly, **bypassing `RuntimeHost`**. The isolated host is only used by showcase + tests. | 🟠 |
| A2 | Sandbox + live share the pipeline but never share state | Sandbox + live share ONE bare `runtime` singleton with one EventStore, one `snapshotCache`, one InvariantEngine. `RuntimeHost.verifyIsolation()` proves isolation is *possible* — production just doesn't use it. | 🔴 |
| A3 | Stream IDs namespaced by env (`sandbox:payment:X` vs `live:payment:X`) | Handlers do namespace stream IDs by env. ✅ But the shared snapshot mixes them back together. | ⚠️ |
| A4 | Per-env event stores | `RuntimeHost` creates 2 `InMemoryEventStore`s. Bare `runtime` has 1. `PostgresEventStore` writes to one global `EventRecord` table with no env column; `hydrate()` hardcodes `environment: 'sandbox'` for ALL loaded events. | 🔴 |
| A5 | Per-env snapshot cache | `snapshotCache` is a module-level singleton shared across envs. A sandbox dispatch's invariants are verified against a snapshot containing live events. | 🔴 |
| A6 | Per-env invariant engine | `RuntimeHost` creates 2. Bare `runtime` has 1. No `EnvironmentBoundaryInvariant` exists in the 17 built-ins. | 🔴 |
| A7 | Per-env projections | All 4 primary projections (`Payment`/`Wallet`/`Treasury`/`Refund`) key by entity ID with no env prefix. `PaymentsService.list(merchantId)` returns sandbox + live together. `PaymentView` has no env field. | 🔴 |

### B. The settlement waterfall (the ONLY routing rule)

| # | Vision | Reality | Status |
|---|---|---|---|
| B1 | Waterfall routes every payment | `PaymentCommandHandler` runs `selectSettlementSource()` on every payment, emits `routing.decision` with tier + per-leg resolution. | ✅ |
| B2 | 5 tiers, deterministic priority | Tiers 1 (PaySwap FIAT) → 2 (LP FIAT) → 3 (PaySwap crypto) → 4 (LP crypto) → 5 (auction). Fee model per tier. | ✅ |
| B3 | LOCAL vs CROSS-BORDER split | `isLocal()` checks country + currency. LOCAL can only use tiers 1, 2, 5. CROSS-BORDER can only use tiers 3, 4, 5. | ✅ |
| B4 | Strategy derived from per-leg waterfall (S3) | `resolvePayment()` → `resolveLeg()` × 2 → `deriveStrategy()`. 5 strategy names produced, no hand-written branch. | ✅ |
| B5 | LP resolved at compile time (S4) | All bandwidth actions carry specific `lpId`s from `BandwidthPosition`. No `'auto_select'`. | ✅ |
| B6 | Tier 5 parks, resumes, or refunds — never hangs | `auctionEngine.open()` is called on tier 5. Auction has a deadline. But no auto-resume on fill / refund on timeout wired into the dispatcher. | 🟡 |
| B7 | Backing block triggers tier fallback | `backingVerifier.onMint()` blocks the mint, but the handler just records `treasury.backing_blocked` and **the payment continues with a missing mint**. No fallback to tier 4. | 🟡 |

### C. The core invariant (FIAT movement ↔ twin token movement)

| # | Vision | Reality | Status |
|---|---|---|---|
| C1 | FIAT deposit → twin token minted | Tier 3 cross-border path: real sender FIAT deposit → `twin.minted` event. LOCAL_RAIL does NOT mint (I2 decision). | ✅ |
| C2 | FIAT withdraw → twin token burned | `backingVerifier.recordBurn()` exists. Dispatcher does NOT call it anywhere — no `twin.burned` event is emitted on disbursement. | 🟡 |
| C3 | 1:1 backing always auditable | `backingVerifier.verifyBacking()` exists, emits `treasury.backing_verified` / `treasury.backing_mismatch`. No caller invokes it on a cycle. | 🟡 |
| C4 | Backing shortfall blocks the mint | `backingVerifier.onMint()` returns `allowed: false`. Handler emits `treasury.backing_blocked` and **continues without minting** — no tier fallback. | 🟡 |
| C5 | Twin token name = Stellar code everywhere | `twinTokenSymbol()` now aliases `twinTokenCode()` → both return `TWIN<CCY>`. UI, events, and on-chain use one name. | ✅ |

### D. Observers → Actuators (the "no orphans" principle)

| # | Observer | Computed | Acted on? | Status |
|---|---|---|---|---|
| D1 | `ReserveDriftMonitor` | per-currency drift %, alarm threshold (30%/24h) | 🟡 Alarm event fires. **Nothing listens.** No auto-rebalance. | 🟡 |
| D2 | `ReserveMonitor.alertIfLow()` | low-reserve alert | 🟡 Alert event fires. **Nothing listens.** No auto-rebalance. | 🟡 |
| D3 | `MigrationProposalEngine` | proposals on threshold crossings | 🟡 Proposals generated. **Never executed, even at `info` severity.** Operator-in-the-loop is good for `advisory`/`urgent`; `info` should auto-apply. | 🟡 |
| D4 | `BackingVerifier` block | mint blocked with shortfall named | 🟡 Block recorded. **No tier fallback** — payment continues with a missing mint. | 🟡 |
| D5 | `NetSettlementEngine` | corridor obligations recorded | 🟡 Obligations recorded. `CorridorBalancer` exists but is only called by manual `/api/treasury/rebalance`. **No cycle-based auto-net settlement.** | 🟡 |
| D6 | `FxExposureService` | per-corridor open FX position + limit | 🟡 Position opened on tier 5. **No auto-hedge or auto-block when limit breached.** Handler emits `fx.limit_breached` but the payment continues. | 🟡 |
| D7 | `LpMandateService` | per-LP mandate availability | ✅ Tier 2 checks mandate availability before recording `lp.fiat_debited`. | ✅ |
| D8 | `RuntimeHost` | per-env runtime contexts with isolation | 🟠 `verifyIsolation()` passes. **Production path bypasses it.** The host is computed but not used. | 🟠 |
| D9 | `CorridorBalancer` | rebalance moves net liquidity donor→recipient | 🟡 Only invoked manually. **No auto-trigger from drift/low alerts.** | 🟡 |
| D10 | `AuctionEngine` | opens auction on tier 5 | 🟡 Opens auction. **No auto-award on bid, no auto-refund on timeout.** | 🟡 |

### E. The treasury controllers (closed loops to build)

| # | Loop | Trigger | Action | Status |
|---|---|---|---|---|
| E1 | Drift → rebalance | `treasury.reserve_drift_alarm` (warning) | `corridorBalancer.checkAndRebalance(corridor, network, monitor)` up to a per-cycle cap | 🔴 |
| E2 | Low → rebalance | `treasury.reserve_low` | same as E1 | 🔴 |
| E3 | Critical drift → pause | `treasury.reserve_drift_alarm` (critical) | pause corridor disbursement + alert human | 🔴 |
| E4 | `info` proposal → auto-apply | migration proposal severity=`info` | execute the conversion via dispatcher, audit log | 🔴 |
| E5 | Backing block → tier fallback | `treasury.backing_blocked` | retry payment at next waterfall tier | 🔴 |
| E6 | Net settlement cycle | every N minutes | `corridorBalancer.settle()` for all corridors with obligations | 🔴 |
| E7 | FX limit breach → block + hedge | `fx.limit_breached` | block the payment (not just log) + open hedge | 🔴 |
| E8 | Auction timeout → refund | auction deadline passed | `settlementEscrow.refund()` to the payer | 🔴 |

---

## The 12 contamination risks (from the pipeline audit)

1. **Two dispatch contracts, only one is used in production.** `runtimeHost.execute()` provides isolation; `runtime.dispatcher.dispatch()` (used by `paymentService`, `refundService`, `payoutService`, `/api/runtime/dispatch`, `/api/treasury/reserves/adjust`, `/api/treasury/freeze`) does not. — `src/runtime/planner/index.ts:387`, `src/services/payment-service.ts:110`.
2. **Single shared EventStore** in the production path. — `src/runtime/index.ts:934-938`.
3. **`PostgresEventStore.hydrate()` mislabels all loaded events as `'sandbox'`.** — `src/runtime/events/postgres-event-store.ts:72`.
4. **`snapshotCache` is a module-level singleton** shared across envs. — `src/runtime/dispatcher/snapshot-cache.ts:162`.
5. **All 7 treasury/liquidity singletons mix sandbox + live state.** `backingVerifier`, `reserveMonitor`, `reserveDriftMonitor`, `migrationProposalEngine`, `netSettlementEngine`, `lpMandateService`, `fxExposureService`.
6. **All 4 primary projections mix sandbox + live state** in their `byId` maps.
7. **The runtime EventStore subscriber only listens to the bare `runtime` singleton's event store** — events dispatched through `runtimeHost.execute()` are invisible to the dashboard. — `src/services/projections/index.ts:160`.
8. **No `EnvironmentBoundaryInvariant`.** — `src/runtime/invariants/builtins.ts:688-706` (17 invariants, none env-related).
9. **`/api/treasury/reserves/adjust` hardcodes `environment: 'sandbox'`** for what should be the most live of operations. — `src/app/api/treasury/reserves/adjust/route.ts:210`.
10. **`/api/showcase` `simulatePaymentFlow` hardcodes `environment: 'sandbox'`** — fine for demo, but showcase payments and real sandbox payments share the same sandbox runtime inside the host.
11. **`live-pipeline-test.ts` makes REAL Stripe/Paystack/Flutterwave/Stellar API calls but dispatches the corresponding event as `environment: 'sandbox'`.** Real money movement, sandbox event label.
12. **The env-switcher UI toggles a cookie AND POSTs to `/api/runtime/host`** to switch the host's active environment — but since the production payment path doesn't use the host, this switch has zero effect on payment routing.

---

## Roadmap — ordered by "danger of inaction"

> The most dangerous items are NOT the missing features — they're the
> computed-but-not-acted-on observers. A dashboard that reports a problem
> the system doesn't fix is worse than no dashboard, because the dashboard
> says the problem is handled.

### Phase 0 — Close the orphan loops (HIGH danger of inaction)

These are the "computed but not acted on" gaps. Each one is a place where
the system reports a problem and then does nothing about it.

- [ ] **0.1 Drift → rebalance closed loop (E1, E3)**
  - When `reserveDriftMonitor` fires `treasury.reserve_drift_alarm` at `warning` level, auto-trigger `corridorBalancer.checkAndRebalance()` for the affected corridor up to a per-cycle cap.
  - When the alarm is `critical`, pause corridor disbursement + alert human.
  - **Acceptance:** a simulated drift over 30% triggers an auto-rebalance; the dashboard shows the rebalance event AND the drift clearing within 1 cycle.

- [ ] **0.2 Low reserve → rebalance closed loop (E2)**
  - Same as 0.1 but triggered by `treasury.reserve_low` from `reserveMonitor.alertIfLow()`.
  - **Acceptance:** a reserve dropping below 20% available triggers an auto-rebalance.

- [ ] **0.3 `info` proposal → auto-apply (E4)**
  - `MigrationProposalEngine` proposals at severity `info` auto-execute via the dispatcher (small amount, capped, audit log).
  - `advisory` and `urgent` proposals still require human approval.
  - **Acceptance:** an `info` proposal appears and is auto-applied within 1 cycle; the dashboard shows the conversion event.

- [ ] **0.4 Backing block → tier fallback (E5, B7, C4)**
  - When `backingVerifier.onMint()` blocks a mint, the handler retries the payment at the next waterfall tier (tier 3 → tier 4 → tier 5).
  - **Acceptance:** a cross-border payment with insufficient backing falls back to LP crypto (tier 4) instead of silently minting nothing.

- [ ] **0.5 FX limit breach → block + hedge (E7)**
  - When `fxExposureService.openPosition()` returns null (limit breached), the handler BLOCKS the payment (not just logs).
  - **Acceptance:** a payment that would breach the FX limit is blocked with a clear reason, not allowed to continue.

- [ ] **0.6 Auction timeout → refund (E8, B6)**
  - When an auction deadline passes with no winning bid, `settlementEscrow.refund()` returns the funds to the payer.
  - **Acceptance:** a tier-5 payment that times out is refunded, not left in PENDING_LIQUIDITY forever.

- [ ] **0.7 Net settlement cycle (E6, D5)**
  - A periodic job (default every 5 minutes) calls `corridorBalancer.settle()` for all corridors with obligations.
  - **Acceptance:** a balanced corridor (KE→GH 1.2M, GH→KE 1.15M) settles 50K net, not 2.35M gross.

### Phase 1 — Fix the contamination (HIGH danger of false confidence)

These are the "computed but isolated from production" gaps. The system
reports isolation is working (`verifyIsolation()` passes) but production
bypasses the isolated path.

- [ ] **1.1 Route production payment path through `runtimeHost.execute()`**
  - `paymentService.create()`, `refundService.create()`, `payoutService.create()` use `runtimeHost.execute()` instead of `runtime.dispatcher.dispatch()`.
  - **Acceptance:** a sandbox payment and a live payment with the same ID succeed without colliding.

- [ ] **1.2 Delete the bare `runtime` singleton** (or rename to `runtimeSandboxOnly`)
  - Prevent accidental imports. Force all callers through `runtimeHost.getRuntime(env)` or `runtimeHost.execute(cmd)`.
  - **Acceptance:** `rg "from '@/runtime'" src/services` returns 0 matches.

- [ ] **1.3 Add `EnvironmentBoundaryInvariant`**
  - Rejects any proposed event whose `metadata.environment` differs from the runtime's own environment.
  - **Acceptance:** a sandbox dispatch in the live runtime is rejected at the invariant gate.

- [ ] **1.4 Per-env snapshot cache**
  - Move `snapshotCache` from module-level singleton to per-runtime instance owned by `createRuntime()`.
  - **Acceptance:** `sandbox.snapshotCache !== live.snapshotCache`.

- [ ] **1.5 Per-env treasury/liquidity singletons**
  - Either key state maps with `${env}:${assetCode}` or make the singletons per-runtime instances.
  - **Acceptance:** a sandbox mint of TWINUSD does NOT consume the live daily mint cap.

- [ ] **1.6 Per-env projections**
  - Add `environment` field to `PaymentView` / `WalletView` / `TreasuryAccountView` / `RefundView`. Filter by env in `list()` / `get()`.
  - **Acceptance:** `PaymentsService.list(merchantId, { environment: 'live' })` returns only live payments.

- [ ] **1.7 Add `environment` column to `EventRecord` Prisma table**
  - `PostgresEventStore.hydrate()` reads it instead of hardcoding `'sandbox'`.
  - **Acceptance:** a live event loaded from Postgres has `environment: 'live'`.

- [ ] **1.8 Move the runtime EventStore subscriber to listen to BOTH host runtimes**
  - `src/services/projections/index.ts:160` subscribes to `runtimeHost.getRuntime('sandbox').eventStore` AND `runtimeHost.getRuntime('live').eventStore`.
  - **Acceptance:** a showcase payment triggers the Prisma sync projection.

### Phase 2 — The execution gaps (MEDIUM danger)

These are real execution seams that need live API wiring.

- [ ] **2.1 Real Stellar twin token mint/burn** — replace the event emission with `twinTokenEngine.mint()` / `.burn()` on Stellar.
- [ ] **2.2 Real FIAT reserve balance** — replace hardcoded `$50K Ghana` with real bank API balance.
- [ ] **2.3 Real LP bandwidth query** — replace hardcoded LP split with `BandwidthEngine.findAvailable()`.
- [ ] **2.4 Real local rail disbursement** — call provider adapter (MTN MoMo / bank) for tier 1 disbursement.
- [ ] **2.5 Real escrow lifecycle** — `settlementEscrow.freeze()` / `.release()` / `.refund()` wired into the waterfall tiers.
- [ ] **2.6 Real PSP collection** — webhook → `payment.create` dispatched through `runtimeHost.execute()`.

### Phase 3 — The dashboard tells the truth (LOW danger, HIGH value)

- [ ] **3.1 Treasury insights UI** — surface drift, composition, proposals on the admin console.
- [ ] **3.2 Action audit trail** — every auto-action (E1-E8) records an audit log entry visible to operators.
- [ ] **3.3 "Computed but not acted" alarm** — meta-monitor that fires if any observer emits an event that no actuator consumes within N seconds.

---

## Fee model (by waterfall tier) — unchanged

| Tier | Fee | Split | Description |
|------|-----|-------|-------------|
| 1 | 80bps | 100% PaySwap | PaySwap FIAT reserves |
| 2 | 100bps | 60% PS, 40% LP | LP FIAT bandwidth |
| 3 | 120bps | 100% PaySwap | PaySwap crypto (twin token or stablecoin) |
| 4 | 150bps | 20% PS, 80% LP | LP crypto bandwidth |
| 5 | 200bps+ | 10% PS, 90% LP | Marketplace auction |

---

## The simplest diagram (unchanged from v2)

```
┌─────────────────────────────────────────────────────┐
│                  Customer Payment                    │
└──────────────────────┬──────────────────────────────┘
                       ▼
              ┌────────────────┐
              │ Settlement     │
              │ Router         │
              └───────┬────────┘
                      ▼
              Is this local?
              ┌───────┴───────┐
             YES              NO
              ▼                ▼
    ┌─── FIAT Waterfall ──┐  ┌─── Crypto Waterfall ──────────────┐
    │ 1. PaySwap FIAT     │  │ Dest has FIAT reserve?            │
    │    reserve?         │  │   YES → Use TWIN<CCY> (mint/burn) │
    │    ↓ NO             │  │   NO  → Use stablecoin (USDC)     │
    │ 2. LP FIAT          │  │                                   │
    │    bandwidth?       │  │ 3. PaySwap crypto reserve?        │
    │    ↓ NO             │  │    ↓ NO                           │
    │ 3. Marketplace      │  │ 4. LP crypto bandwidth?           │
    │    auction          │  │    ↓ NO                           │
    └─────────────────────┘  │ 5. Marketplace auction            │
                             └───────────────────────────────────┘
                      ▼
    ┌─── Core Invariant ────────────────────────────┐
    │ FIAT deposit  → mint TWIN<CCY> on Stellar     │
    │ FIAT withdraw → burn TWIN<CCY> on Stellar     │
    │ 1:1 backing, always auditable                 │
    └───────────────────────────────────────────────┘
```

---

## What's different from v2

- **Twin token naming:** `tGHS` / `tNGN` etc. are GONE. One name (`TWIN<CCY>`) everywhere — UI, events, on-chain.
- **I1 + I2 + D1 + D2 are wired.** Drift monitor, migration proposals, LOCAL_RAIL twin-mint removal are all in the codebase.
- **The audit is now honest about the contamination.** v2 said "single pipeline, sandbox/live isolation" as a goal; v3 says it's a goal the system CLAIMS to meet but does NOT.
- **The audit is now honest about the orphan observers.** v2 listed the observers as "done"; v3 calls out that 7 of 10 observers compute but don't act.
- **The roadmap is now ordered by danger of inaction.** Phase 0 (close orphan loops) is the most urgent — these are the "dashboard says problem is handled" traps.
