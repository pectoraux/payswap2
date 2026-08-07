# PaySwap Roadmap — Unifying the Rule (v4)

> **Audit grade: B−.** Three issues pull it down. This roadmap fixes them
> in the order the auditor specified, with the "no orphans" and "no
> contamination" principles from v3 enforced throughout.

---

## The three issues (confirmed by import graph)

### Issue 1 — S3 went the wrong direction: two parallel routing rules

**Evidence:**
- `policy-engine.ts:289-312` — `selectStrategy()` is still a hand-written boolean matrix on `hasFiatReserve`. Zero imports from `settlement-waterfall.ts`.
- `handlers.ts:30,336,343` — the live dispatcher calls `selectSettlementSource()` + `resolvePayment()` from the waterfall directly. Never calls `.compile()` or `.selectStrategy()`.
- 7 call sites use the planner's `compile()`/`selectStrategy()`: `settlement-simulator.ts:179`, `economic-simulation.ts:220`, `planner/index.ts:327`, `platform/engine.ts:66,477`, `showcase/route.ts:836`, `compiler-explorer.tsx:246`.
- The `settlement-waterfall.ts:2` docstring claims "the ONLY routing rule" — that's false.

**Consequence:** the simulator and production can disagree on strategy for the same input. The I2 decision (no twin mint on LOCAL_RAIL) was applied to both paths by hand — they're kept in sync manually and will diverge.

### Issue 2 — F2 makes F3 produce wrong numbers: FX exposure at rate:1

**Evidence:**
- `handlers.ts:227` — `fxExposureService.openPosition({ rate: 1, ... })` (pre-flight, no comment).
- `handlers.ts:592` — `fxExposureService.openPosition({ rate: 1, // simplified })` (tier-5 path).
- Zero imports of `@/kernel/fx` or `@/protocol/connectors-v2/fx-rate` in `src/runtime/`.
- Rate sources DO exist: `kernel/fx.ts:35` (`fxEngine.quote()` with real USD-indexed rates) and `connectors-v2/fx-rate.ts:58` (`FxRateConnector`). They're wired into `optimization-engine` and the connector registry, just not into the dispatcher.
- The simulator/planner also hardcode `fxRate: 1` (`settlement-simulator.ts:170`, `planner/index.ts:333`).

**Consequence:** a GHS→NGN payment books FX exposure as though 1 GHS = 1 NGN. The exposure dashboard reads confidently wrong. Worse than absent FX.

### Issue 3 — W2 records but never nets; W3 doesn't persist

**Evidence:**
- Zero calls to `netSettlementEngine.settle()` anywhere in `src/`.
- `wireNetSettleInputs()` is never called → E6 closed-loop timer fires every 5 min but always records `skipped: net_settle_inputs_not_wired`.
- `corridors` Map at `net-settlement.ts:24` is in-memory only. No rehydrate.
- `corridor.obligation.recorded` events ARE written durably (`handlers.ts:517`) but nothing reads them back.
- `corridor.obligation.settled` event type does not exist.

**Consequence:** obligations accumulate but nothing settles them. Not one unit of liquidity movement has been saved. On restart, the Map is empty.

---

## The fix — in the auditor's order

### Phase A — Delete one of the two rules (S3)

**Decision: make `LiquidityPolicyEngine.selectStrategy()` delegate to `resolvePayment()` from the waterfall.**

Why this direction (not the reverse):
- The planner is the codebase's best property — pure, replayable, deterministic. Retiring it would lose that.
- Making `selectStrategy()` call `resolvePayment()` means simulators (which call `compile()` → `selectStrategy()`) now derive strategy from the waterfall. Production (which calls the waterfall directly) is unchanged. ONE rule, both paths.
- The planner's `compile()` still produces the detailed `LiquidityExecutionPlan` (treasury/liquidity/settlement actions). Only the strategy SELECTION is delegated — the rest of the plan stays as-is, keyed off the waterfall-derived strategy name.

**Acceptance:**
- `selectStrategy()` calls `resolvePayment()` — no hand-written boolean matrix.
- `policy-engine.ts` imports from `settlement-waterfall.ts`.
- Simulators and production produce the same strategy for the same input.

### Phase B — Connect a rate source or stop recording exposure (F2)

**Decision: wire `fxEngine.quote()` into the dispatcher. If no rate is available, emit `fx.rate_missing` and refuse to open the position.**

Why not "stop recording":
- Rate sources exist (`fxEngine` with real USD-indexed rates). The fix is to thread them in, not to disable the feature.
- But: if a corridor isn't in the rate table, the system must NOT open a position at rate:1. It must emit `fx.rate_missing` and skip the position opening.

**Acceptance:**
- `handlers.ts` imports `fxEngine` from `@/kernel/fx`.
- `openPosition()` calls use `fxEngine.quote(from, to).effectiveRate` — never `1`.
- If the rate isn't available (unknown currency), emit `fx.rate_missing` and don't open the position.
- The FX exposure dashboard reads real rates.

### Phase C — Call settle() on a cycle + event-source the corridor map (W2+W3)

**Decision: wire `wireNetSettleInputs()` at startup, emit `corridor.obligation.settled` events, rehydrate the Map from the event log.**

Three changes:
1. `netSettlementEngine.settle()` emits a `corridor.obligation.settled` event (via callback, since the engine is kernel-frozen and can't import the event engine directly — use a pluggable callback).
2. `wireNetSettleInputs()` is called from `instrumentation.ts` with a `settleCorridor` callback that calls `netSettlementEngine.settle()` and emits the event.
3. A projection replays `corridor.obligation.recorded` + `corridor.obligation.settled` events into the Map on startup.

**Acceptance:**
- `netSettlementEngine.settle()` is called by the E6 cycle every 5 minutes.
- `corridor.obligation.settled` events are emitted and visible in the event store.
- On restart, the corridor Map is rehydrated from the event log.
- A balanced corridor (KE→GH 1.2M, GH→KE 1.15M) settles 50K net, not 2.35M gross.

---

## Implementation order

1. **Phase A** (unify the rule) — the biggest risk, do it first.
2. **Phase B** (FX rate source) — independent of A, quick win.
3. **Phase C** (net settlement cycle + event-sourced Map) — the headline cost lever.

Each phase ends with: lint clean, test scenarios pass, browser-verified.
