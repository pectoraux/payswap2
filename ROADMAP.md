# PaySwap Roadmap — wiring the two-reserve model into the money path

> **The model, in two lines:**
> ```
> Local payments  → FIAT reserves
> Cross-border    → crypto reserves
> ```
> LPs extend reserve capacity when PaySwap's own reserves are insufficient.
> Twin tokens mirror FIAT reserves 1:1. Stablecoins bridge until FIAT reserves grow.

**This is not a build roadmap. It is a wiring roadmap.**

The components exist. They are not connected. Nearly every ticket connects something
that already exists rather than building something new.

The waterfall and the 5-strategy matrix are **the same rule at two scopes**:
- The waterfall answers: *for one leg of a payment, whose liquidity pays?*
- Tiers 1–2 = RESERVE. Tiers 3–5 = MARKET.
- The strategy names are labels on the pair of leg results.

**Keep the two-layer framing for how you describe PaySwap. Keep the matrix for how
you implement it. They are the same thing.**

## What's already right — do not disturb
- **The planner is pure.** `LiquidityPolicyEngine.compile()` — same input → same plan.
- **Fallbacks are compiled in.** `buildFallbackGraph()` attaches fallback branches.
- **Execution is a crash-safe saga.** `SettlementOrchestrator` rebuilds from events.
- **Fees follow the economics.** Reserve strategies = 100% PaySwap; market = LP split.

## What's broken
- Netting engine: only called by the simulator, not the settlement path
- Corridor balancer: called by nothing
- Backing verifier: called by nothing
- FX module: not in the settlement path
- Rebalance endpoint: returns `{ rebalanced: true }` without rebalancing

---

## W — Wiring (do this first, all of it)

### W1 · Backing verifier in front of every mint — IN PROGRESS
- **Files:** `src/protocol/treasury-v2/backing.ts`, `src/runtime/dispatcher/handlers.ts`
- `backing.ts` implements the 1:1 `TWIN<CCY>` ≥ `<CCY>` reserve invariant as a
  `preMintHook` gate. Nothing calls it. The handler emits `twin.minted` with no check.
- Route every `twin.minted` event through the verifier's hooks.
- **Acceptance:** a mint against insufficient reserves is rejected with the shortfall named.

### W2 · Netting in the settlement path — TODO · **Depends:** W1
- **Files:** `src/protocol/settlement/net-settlement.ts`, `src/runtime/dispatcher/handlers.ts`
- Cross-border plans should record corridor obligations and settle net on a cycle,
  not gross per payment. This is the largest cost lever in the system.
- **Acceptance:** balanced corridor (KE→GH 1.2M, GH→KE 1.15M) moves 50k, not 2.35M.

### W3 · Persist corridor obligations — TODO · **Depends:** W2
- **Files:** `src/protocol/settlement/net-settlement.ts`
- `NetSettlementEngine` is an in-memory `Map`. Unsettled obligations are money owed.
- **Acceptance:** kill process mid-cycle; obligations reconstruct from event log.

### W4 · Fix `netVolume()` dedupe key — TODO · **Depends:** W3
- **Files:** `src/protocol/settlement/net-settlement.ts:86-95`
- Key omits currency — multi-currency corridors collapse to one key.
- **Acceptance:** GH↔NG in GHS and USD reports two nets, not one.

### W5 · Make rebalance endpoint actually rebalance — TODO · **Depends:** W2
- **Files:** `src/app/api/treasury/rebalance/route.ts`, `src/protocol/treasury-v2/balancing.ts`
- Either invoke `CorridorBalancer` or stop returning `{ rebalanced: true }`.
- **Acceptance:** response reports amount moved + donor corridor, or `{ rebalanced: false, reason }`.

---

## F — FX (the gap the two-layer framing hides)

### F1 · Give the intent two currencies — TODO
- **Files:** `src/runtime/liquidity/types.ts`, `src/runtime/liquidity/settlement-waterfall.ts`
- Split `currency` into `sourceCurrency`/`destinationCurrency`; add `convert_fx` action.
- **Acceptance:** GHS→NGN intent compiles with explicit FX action + quoted rate.

### F2 · Wire FX modules into the planner — TODO · **Depends:** F1
- **Files:** `src/kernel/fx.ts`, `src/protocol/connectors-v2/fx-rate.ts`, `src/runtime/liquidity/settlement-waterfall.ts`
- Pass the quote in via inputs (keep planner pure — same quote → same plan).
- **Acceptance:** `compile()` stays deterministic with FX.

### F3 · FX risk owner — TODO · **Depends:** F2
- **Files:** `src/protocol/treasury-v2/limits.ts`, `src/protocol/treasury-v2/stress-test.ts`
- Decide: PaySwap wears it (limit + hedge), LP wears it (priced in fee), or sender wears it (re-quote on expiry).
- **Acceptance:** open FX exposure per corridor is a number with a limit.

---

## S — The waterfall as the per-leg resolver

### S1 · Add FIAT as an asset type — TODO
- **Files:** `src/runtime/liquidity/types.ts:49-56` (`LiquidityAction`)
- `assetType` is `'twin_token' | 'stablecoin'`. There is no FIAT. Tier 2 is unrepresentable.
- Add `'fiat'` + action semantics (external debit against LP-held account, mandate, limits, reversal).
- **Acceptance:** a plan can express "debit LP X's Ghanaian bank account for 50,000 GHS."

### S2 · Tier 2 needs a mandate — TODO · **Depends:** S1
- **Files:** new LP mandate model, `src/protocol/lp-lifecycle-manager.ts`
- Debiting external bank accounts requires standing authorisation + reversal reserve.
- **Acceptance:** LP without active mandate never appears at tier 2.

### S3 · Derive strategy from per-leg waterfall — TODO · **Depends:** S1, F1
- **Files:** `src/runtime/liquidity/settlement-waterfall.ts`, `src/runtime/dispatcher/handlers.ts`
- Replace pre-decided booleans with `resolveLeg(country, currency, amount) → { tier, source }`.
- Strategy name = label on pair of leg results. Record skipped tiers + reasons.
- **Acceptance:** five strategy names still produced, same inputs, no hand-written branch.

### S4 · Resolve LP at compile time — TODO · **Depends:** S3
- **Files:** `src/runtime/liquidity/policy-engine.ts:168,176,184,188`
- Every bandwidth action carries `lpId: 'auto_select'`. Select LP in the planner.
- **Acceptance:** identical inputs → identical `lpId`s.

### S5 · Wire tier 5 (marketplace auction) — TODO · **Depends:** S3
- **Files:** `src/protocol/settlement/auctions.ts`, `src/protocol/liquidity/marketplace.ts`
- Tier 5 is async — parks in `marketplace` state, resumes on fill, refunds on timeout.
- Consider committed facilities (pre-agreed size/price) as tier 4.5.
- **Acceptance:** settlement reaching tier 5 parks, resumes, or refunds — never hangs.

---

## I — The invariant, per location

### I1 · Should RESERVE_TO_RESERVE balance in-plan? — TODO · **Depends:** W2, W5
- **Files:** `src/runtime/liquidity/policy-engine.ts:122-126`
- Plan credits sender reserve + mints twin at destination, no debit on destination.
- Choose: settle location in-plan (simpler, more movement) or accumulate + rebalance (less movement, requires W2+W5 loop).
- **Acceptance:** per-country reserve drift is a monitored number with an alarm threshold.

### I2 · What do twin tokens do on LOCAL_RAIL? — TODO
- **Files:** `src/runtime/liquidity/policy-engine.ts:116-120`
- GHS→GHS mints tGHS — what does tGHS do locally that a ledger entry doesn't?
- Decide: mint-on-deposit (simple invariant, off payment path) vs mint-on-corridor-entry (supply tied to utility).
- **Acceptance:** written decision + if minting stays, one sentence naming tGHS's local job.

---

## D — The long-term direction

### D1 · Measure stablecoin→twin shift — TODO · **Depends:** W1
- **Files:** `src/protocol/treasury-v2/backing.ts`, `src/runtime/liquidity/types.ts:209-215`
- Surface % stablecoin vs % twin of crypto-tier capacity, per corridor.
- **Acceptance:** treasury dashboard shows the ratio + trend per corridor.

### D2 · Propose migrations, don't execute — TODO · **Depends:** D1, W5
- **Files:** `src/protocol/treasury-v2/balancing.ts`, `src/runtime/settlement-orchestrator/autonomous.ts`
- When FIAT reserves cross threshold, propose converting stablecoin → twin for that corridor.
- **Acceptance:** opening NGN FIAT reserve produces a proposal with corridor, amount, composition.

---

## Ordering

**W1–W5 first.** Small wiring tickets. Until they land, the system reports outcomes
it doesn't produce — making every later measurement untrustworthy.

**F1–F3 next.** FX changes the shape of `LiquidityIntent` and `TreasuryAction`.
Every S ticket touches those types. Doing S first means doing it twice.

**S1–S5 then.** Waterfall is a refactor of a working planner, provable by snapshot
equality against today's plans.

**I and D last.** Decisions, easier once W and F make consequences visible.

---

## Fee model (by waterfall tier)

| Tier | Fee | Split | Description |
|------|-----|-------|-------------|
| 1 | 80bps | 100% PaySwap | PaySwap FIAT reserves |
| 2 | 100bps | 60% PS, 40% LP | LP FIAT bandwidth |
| 3 | 120bps | 100% PaySwap | PaySwap crypto (twin token or stablecoin) |
| 4 | 150bps | 20% PS, 80% LP | LP crypto bandwidth |
| 5 | 200bps+ | 10% PS, 90% LP | Marketplace auction |
