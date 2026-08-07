# PaySwap Roadmap — the two-reserve model (adapted to actual codebase)

> **The whole system in two lines:**
> ```
> Local payments  → FIAT reserves
> Cross-border    → crypto reserves
> ```
> LPs extend reserve capacity when PaySwap's own reserves are insufficient.
> Twin tokens mirror FIAT reserves 1:1. Stablecoins are the bridge until FIAT reserves grow.

This roadmap is adapted to the ACTUAL codebase structure:
- `src/runtime/` — the main runtime (dispatcher, handlers, liquidity, events, invariants)
- `src/protocol/` — protocol-level primitives (twin-token, settlement, stellar, providers)
- `src/kernel/` — simulation engine (to be simplified/removed where duplicated)
- `src/services/` — application services (payment-service, payout-service, etc.)
- `src/live/` — real PSP + Stellar connectors

## Current state mapping

| Roadmap concept | Actual file location |
|----------------|---------------------|
| Reserve orchestration | `src/runtime/dispatcher/handlers.ts` (hardcoded RESERVE_STATES) |
| Routing/scoring | `src/runtime/liquidity/policy-engine.ts` (5-strategy model) |
| Twin token engine | `src/protocol/twin-token/engine.ts` (Stellar-backed, unused) |
| Bandwidth engine | `src/runtime/liquidity/bandwidth-engine.ts` (LP bandwidth) |
| Settlement contracts | `src/runtime/liquidity/settlement-contract-engine.ts` |
| Auction engine | `src/protocol/settlement/auctions.ts` (unused in pipeline) |
| Escrow | `src/protocol/settlement/escrow.ts` (unused in pipeline) |
| Stellar adapter | `src/protocol/chains/stellar/adapter.ts` (real, unused) |
| Live connectors | `src/live/` (Stripe, Paystack, FLW, Stellar — all working) |
| Payment handler | `src/runtime/dispatcher/handlers.ts` (emits events, no execution) |

---

## R1 — Simplify to 2-layer waterfall

### R1-1 · Replace 5-strategy policy engine with 2-layer waterfall — TODO
- **Files:** `src/runtime/liquidity/policy-engine.ts`, `src/runtime/dispatcher/handlers.ts`
- Replace `LOCAL_RAIL | RESERVE_TO_RESERVE | RESERVE_TO_MARKET | MARKET_TO_RESERVE | MARKET_TO_MARKET`
  with `LOCAL (FIAT waterfall) | CROSS_BORDER (Crypto waterfall)`
- The waterfall is 5 tiers in priority order:
  1. PaySwap FIAT reserves
  2. LP FIAT bandwidth
  3. PaySwap crypto reserves (twin token if FIAT exists, stablecoin if not)
  4. LP crypto bandwidth
  5. Marketplace auction
- Local payments use tiers 1, 2, 5. Cross-border uses 3, 4, 5.
- **Acceptance:** `selectSettlementSource()` returns `{ tier, source, skipped[], explanation }`

### R1-2 · Simplify PaymentCommandHandler to use the waterfall — TODO · **Depends:** R1-1
- **Files:** `src/runtime/dispatcher/handlers.ts`
- Remove the 5-strategy switch (lines 226-579)
- Replace with: `if (isLocal) { fiatWaterfall() } else { cryptoWaterfall() }`
- Each tier tries the next if insufficient
- Emit `routing.decision` with the waterfall tier selected + skipped tiers

### R1-3 · Delete dead code and parallel implementations — TODO
- **Files to delete:**
  - `src/runtime/settlement/adapters.ts` (stub returning fake txHashes)
  - `src/kernel/twin-token.ts` (duplicate of `protocol/twin-token/engine.ts`)
  - `src/kernel/treasury.ts` + `src/kernel/treasury-ai.ts` (simulation-only)
  - `src/protocol/treasury.ts` (old v1)
  - `src/protocol/contracts/index.ts` (unused SmartContract interfaces)
  - `src/kernel/liquidity-planner.ts` (superseded by policy engine)
  - `src/runtime/economic/marketplace.ts` (duplicate of auction engine)
  - `src/runtime/engines/liquidity-marketplace/service.ts` (read-only duplicate)
  - 13 NoOp engine stubs in `src/runtime/engines/*/types.ts`

---

## R2 — FIAT presence + isLocal()

### R2-1 · FIAT presence per country — TODO · **Depends:** R1-1
- **Files:** `src/runtime/dispatcher/handlers.ts` (where RESERVE_STATES is hardcoded)
- Replace hardcoded `RESERVE_STATES` with a real lookup
- `getFiatPresence(country)` → `{ hasFiatReserves, totalAvailable, currency }`
- Derived from the event store (treasury.account.credited events per country)
- **Acceptance:** Ghana has FIAT reserve → `hasFiatReserves: true`; Kenya doesn't → `false`

### R2-2 · isLocal() — TODO · **Depends:** R2-1
- **Files:** new `src/runtime/liquidity/locality.ts`
- `isLocal({ originCountry, destinationCountry, sourceCurrency, destinationCurrency })`
- Same country AND same currency → local. Anything else → cross-border.
- **Acceptance:** GH→GH/GHS = local; GH→NG = cross-border; GH/GHS→GH/USD = cross-border

---

## R3 — Wire real execution to the waterfall

### R3-1 · Real twin token mint/burn on Stellar — TODO · **Depends:** R1-2
- **Files:** `src/runtime/dispatcher/handlers.ts`, `src/protocol/twin-token/engine.ts`
- When handler emits `twin.minted`, also call `twinTokenEngine.mint()` on Stellar
- Twin token naming: `tGHS` for GHS, `tNGN` for NGN, `tKES` for KES, `tXOF` for XOF
- Configure `twinTokenEngine` with Stellar testnet credentials from `.env`
- **Acceptance:** a local payment in Ghana mints `tGHS` on Stellar testnet

### R3-2 · Real escrow lifecycle — TODO · **Depends:** R1-2
- **Files:** `src/runtime/dispatcher/handlers.ts`, `src/protocol/settlement/escrow.ts`
- For cross-border (tiers 3-5): `settlementEscrow.freeze()` when stablecoin is locked
- Release escrow when LP confirms settlement
- Slash escrow on dispute/fraud
- **Acceptance:** a cross-border payment freezes escrow, then releases on confirmation

### R3-3 · Real LP auction (tier 5) — TODO · **Depends:** R1-2
- **Files:** `src/runtime/dispatcher/handlers.ts`, `src/protocol/settlement/auctions.ts`
- When waterfall reaches tier 5: `auctionEngine.open()`
- LPs submit bids via new `/api/lp/bid` endpoint
- `auctionEngine.close()` selects winner(s) by greedy cheapest-first
- Multi-LP partial fills for coverage optimization
- **Acceptance:** a payment that can't be served by tiers 1-4 opens an auction

### R3-4 · Real local rail disbursement — TODO · **Depends:** R1-2
- **Files:** `src/runtime/dispatcher/handlers.ts`, `src/protocol/providers/registry.ts`
- For LOCAL_RAIL tier 1: call provider adapter to disburse
- Use `providerRegistry.getByType('mobile_money')` or `('bank_account')`
- On provider confirmation → settlement confirmed
- **Acceptance:** a local payment triggers a real (or simulated) MTN MoMo disbursement

### R3-5 · Replace stub Stellar adapter — TODO
- **Files:** `src/runtime/settlement/adapters.ts` (delete), import from `src/protocol/chains/stellar/adapter.ts`
- Remove the stub that returns `stellar_${Date.now()}` fake txHashes
- Import and use the real `stellarChainAdapter` with sim/live mode
- **Acceptance:** Stellar transactions return real tx hashes

---

## R4 — LP bandwidth system

### R4-1 · LP FIAT bandwidth (tier 2) — TODO · **Depends:** R3-1
- **Files:** `src/runtime/liquidity/bandwidth-engine.ts`, `src/runtime/dispatcher/handlers.ts`
- LPs register FIAT bandwidth: country, currency, bank authorization, capacity
- When tier 1 is insufficient, tier 2 queries `bandwidthEngine.findAvailable(country, 'fiat', currency, amount)`
- LP is auto-debited and compensated with fee share
- **Acceptance:** LP with FIAT bandwidth in Kenya serves a local payment when PaySwap's FIAT is insufficient

### R4-2 · LP crypto bandwidth (tier 4) — TODO · **Depends:** R4-1
- **Files:** `src/runtime/liquidity/bandwidth-engine.ts`, `src/runtime/dispatcher/handlers.ts`
- LPs register crypto bandwidth: USDC capacity on Stellar
- When tier 3 is insufficient, tier 4 queries `bandwidthEngine.findAvailable(country, 'stablecoin', 'USDC', amount)`
- LP is compensated with fee share
- **Acceptance:** LP with crypto bandwidth serves a cross-border payment when PaySwap's crypto is insufficient

### R4-3 · Bandwidth compensation — TODO · **Depends:** R4-1, R4-2
- **Files:** `src/runtime/dispatcher/handlers.ts`
- When LP bandwidth is used (tiers 2, 4), LP earns fee share
- Tier 2 (LP FIAT): 40% LP, 60% PaySwap
- Tier 4 (LP crypto): 80% LP, 20% PaySwap
- Tier 5 (auction): 90% LP, 10% PaySwap (market rate)
- **Acceptance:** a settlement at tier 2 books an LP fee; tier 1 books none

---

## R5 — Enforce the twin-token invariant

### R5-1 · Mint/burn = FIAT movement, atomically — TODO · **Depends:** R3-1
- **Files:** `src/runtime/dispatcher/handlers.ts`, `src/protocol/twin-token/engine.ts`
- FIAT deposited → mint twin token on Stellar (same transaction)
- FIAT withdrawn → burn twin token on Stellar (same transaction)
- Any failure rolls back both
- **Acceptance:** `circulatingSupply(tGHS) == fiatReserveBalance(GHS)` always

### R5-2 · No FIAT reserve ⇒ no mint — TODO · **Depends:** R5-1, R2-1
- **Files:** `src/runtime/dispatcher/handlers.ts`
- Reject twin token mint for a country with no FIAT reserve
- Use stablecoin (USDC) instead
- **Acceptance:** deposit into Kenya (no FIAT reserve) → uses USDC, not tKES

### R5-3 · Continuous invariant check — TODO · **Depends:** R5-1
- **Files:** new `src/runtime/reconciliation/invariant-service.ts`
- Per currency: `circulatingSupply(twin) − fiatReserveBalance` must be 0
- Publish breach event if drift detected
- Surface on admin dashboard
- **Acceptance:** corrupted reserve balance is flagged within one check cycle

---

## R6 — Marketplace auction (tier 5)

### R6-1 · Auction models + API — TODO · **Depends:** R3-3
- **Files:** new `src/app/api/lp/bid/route.ts`, `src/protocol/settlement/auctions.ts`
- LPs submit bids: amount, fee rate, settlement window
- Auction closes after timeout or full coverage
- **Acceptance:** open auction with two competing LP bids

### R6-2 · Waterfall tier 5 integration — TODO · **Depends:** R6-1
- **Files:** `src/runtime/dispatcher/handlers.ts`
- Tier 5 is asynchronous — settlement parks in `PENDING_LIQUIDITY` state
- Resumes or fails on auction close
- **Acceptance:** settlement reaching tier 5 enters pending state, resumes on bid

---

## R7 — Stablecoin → twin token migration

### R7-1 · Reserve composition metric — TODO · **Depends:** R1-1
- **Files:** `src/runtime/dispatcher/handlers.ts`, `src/app/api/showcase/route.ts`
- Report per currency: `% stablecoin` vs `% twin token` of crypto-tier capacity
- Surface on financial model dashboard
- **Acceptance:** dashboard shows the ratio and trend

### R7-2 · Rebalancer — TODO · **Depends:** R7-1, R5-1
- **Files:** new `src/runtime/treasury/rebalance-service.ts`
- When FIAT reserves cross threshold, propose converting stablecoin → twin token
- Propose, don't execute (human approval needed)
- **Acceptance:** opening NGN FIAT reserve produces proposal to shift GH→NG from USDC to tNGN

---

## R8 — Docs + dashboard

### R8-1 · Rewrite architecture docs — TODO · **Depends:** R1-1
- **Files:** `ARCHITECTURE-AUDIT.md`, `docs/architecture/` (if exists)
- Lead with two-reserve rule + waterfall
- Drop reserve-category taxonomy, stablecoin-vs-twin philosophy split
- **Acceptance:** no doc describes a reserve type that isn't `tier × ownership × assetKind`

### R8-2 · Dashboard follows the waterfall — TODO · **Depends:** R3-1, R7-1
- **Files:** `src/components/showcase/payment-flow-visualizer.tsx`, `src/components/showcase/financial-model-tab.tsx`
- Reserves panel groups by tier 1-5, in waterfall order
- Settlement detail shows tier served + tiers skipped with reasons
- **Acceptance:** operator can answer "why did this payment cost that much?" from the UI

---

## Fee model (by waterfall tier)

| Tier | Fee | Split |
|------|-----|-------|
| 1. PaySwap FIAT | 0.8% (80bps) | 100% PaySwap |
| 2. LP FIAT | 1.0% (100bps) | 60% PaySwap, 40% LP |
| 3. PaySwap crypto | 1.2% (120bps) | 100% PaySwap |
| 4. LP crypto | 1.5% (150bps) | 20% PaySwap, 80% LP |
| 5. Auction | 2.0%+ (200bps+) | 10% PaySwap, 90% LP |
