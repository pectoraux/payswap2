# PaySwap Architecture Audit & Roadmap

## Executive Summary

PaySwap has every component needed to deliver the product vision — Stellar adapter, twin token engine, escrow, auctions, 13 provider connectors, live Stripe/Paystack/Flutterwave integration. **The single missing ingredient is wiring**: the production dispatcher emits events but calls none of these real implementations.

**Current state:** Events-only pipeline (emits `twin.minted`, `settlement.contract.created`, `liquidity.resolved` — but nothing actually executes)

**Target state:** Real execution pipeline (mints twin tokens on Stellar, freezes escrow, runs LP auctions, disburses via local rails)

---

## Product Vision vs Current State

| Vision Point | Status | What Exists | What's Broken |
|---|---|---|---|
| **1. Stablecoins for cross-border** | 🔴 BROKEN | Policy engine plans stablecoin usage; Fireblocks connector exists | Hardcoded $20K USDC; no real custody; no actual USDC lock/release |
| **2. Twin tokens as bridge** | 🟡 SIM-ONLY | 3 implementations (kernel, protocol/Stellar-backed, runtime projection) | None wired to dispatcher; no on-chain mint in payment flow |
| **3. Local rails for domestic** | 🔴 BROKEN | 13 provider adapters (MTN MoMo, Airtel, Stripe, Paystack, FLW, etc.) | LOCAL_RAIL is just an event label; no real disbursement |
| **4. LP auction system** | 🟡 SIM-ONLY | 3 implementations (AuctionEngine, EconomicMarketplace, LiquidityMarketplaceService) | None triggered by `payment.create`; LPs never queried |
| **5. Stellar integration** | 🔴 BROKEN | Real adapter (1638 lines), real live connector (testnet txs work) | Stub adapter returns fake txHashes; real adapter unused |

---

## The Core Problem

```
CURRENT (events-only):
  payment.create → emit events → store in EventStore → projections update
  (nothing actually moves — no USDC, no twin tokens, no bank transfers)

TARGET (real execution):
  payment.create →
    1. LiquidityPolicyEngine compiles plan (✅ works)
    2. If LOCAL_RAIL: disburse via local rail (MTN MoMo / bank) ← MISSING
    3. If cross-border:
       a. Lock stablecoin in escrow ← MISSING
       b. Mint twin tokens on Stellar ← MISSING
       c. Open LP auction for settlement ← MISSING
       d. LPs bid → winner selected ← MISSING
       e. Winner disburses to recipient via local rail ← MISSING
       f. Release escrow → burn twin tokens ← MISSING
    4. Post ledger entries (✅ works)
```

---

## Architecture: What to Keep, Delete, Build

### KEEP (solid foundation, works correctly)
- ✅ `src/runtime/dispatcher/` — event-sourced, OCC, invariant engine, transaction coordinator
- ✅ `src/runtime/invariants/` — economic integrity checks (14 invariants)
- ✅ `src/runtime/events/` — event store with Postgres/InMemory backing
- ✅ `src/runtime/ledger/engine.ts` — double-entry ledger
- ✅ `src/runtime/liquidity/policy-engine.ts` — strategy selection (correct logic)
- ✅ `src/runtime/host/runtime-host.ts` — sandbox/live isolation
- ✅ `src/protocol/chains/stellar/adapter.ts` — real Stellar adapter (1638 lines, sim/live mode)
- ✅ `src/protocol/twin-token/engine.ts` — real Stellar-backed twin token engine
- ✅ `src/protocol/settlement/escrow.ts` — real escrow lifecycle (freeze → release/dispute)
- ✅ `src/protocol/settlement/auctions.ts` — real auction engine (open → bid → close → award)
- ✅ `src/protocol/providers/` — 13 real provider adapters
- ✅ `src/live/` — real Stripe/Paystack/Flutterwave/Stellar live connectors

### DELETE (parallel stubs, duplicates, dead code)
- ❌ `src/runtime/settlement/adapters.ts` — stub StellarAdapter returning fake txHashes
- ❌ `src/kernel/twin-token.ts` — duplicate of `protocol/twin-token/engine.ts`
- ❌ `src/kernel/treasury.ts` + `treasury-ai.ts` — simulation-only duplicates
- ❌ `src/protocol/treasury.ts` (old v1) — superseded by treasury-v2
- ❌ `src/protocol/contracts/index.ts` — SmartContract interfaces never used
- ❌ 13 NoOp engine stubs in `src/runtime/engines/`
- ❌ `src/runtime/liquidity/engines.ts` — duplicate BandwidthEngine/SettlementContractEngine (already deleted)

### BUILD (missing wiring — no new business logic needed)
1. Wire `stellarChainAdapter` → replace stub in `runtime/settlement/adapters.ts`
2. Wire `twinTokenEngine.mint()` → call from `PaymentCommandHandler` when emitting `twin.minted`
3. Wire `settlementEscrow.freeze()` → call from `RESERVE_TO_MARKET` / `MARKET_TO_MARKET` branches
4. Wire `auctionEngine.open/bid/close` → call from `liquidity.resolved` step
5. Wire `providerRegistry` → call from `LOCAL_RAIL` branch for real disbursement
6. Wire `settlementContractEngine.apply(events)` → make it event-sourced projection
7. Add `/api/lp/bid` endpoint → LPs submit bids in response to auctions
8. Add Fireblocks/Circle custody → real USDC lock/release

---

## Roadmap

### Phase 0: Cleanup (~2 days)
**Goal:** Remove dead code and parallel implementations

- [ ] Delete stub `runtime/settlement/adapters.ts` (replace with real adapter import)
- [ ] Delete `kernel/twin-token.ts` (use `protocol/twin-token/engine.ts` instead)
- [ ] Delete `kernel/treasury.ts` + `kernel/treasury-ai.ts` (simulation-only)
- [ ] Delete `protocol/treasury.ts` (old v1, superseded)
- [ ] Delete `protocol/contracts/index.ts` (unused SmartContract interfaces)
- [ ] Delete 13 NoOp engine stubs in `runtime/engines/`
- [ ] Delete `kernel/liquidity-planner.ts` (superseded by `runtime/liquidity/policy-engine.ts`)

### Phase 1: Wire Real Execution (~1 week)
**Goal:** Connect existing implementations to the payment pipeline

This is the highest-leverage phase — no new business logic, just wiring.

- [ ] **1.1 Real Stellar adapter** — replace stub with `stellarChainAdapter` from `protocol/chains/stellar/adapter.ts`
  - Configure with testnet credentials (already in `.env`)
  - Set mode to 'live' for production, 'simulation' for sandbox

- [ ] **1.2 Real twin token minting** — call `twinTokenEngine.mint()` from `PaymentCommandHandler`
  - When handler emits `twin.minted`, also call `protocol/twin-token/engine.ts` to mint on Stellar
  - Twin token = `TWIN<CCY>` credit asset (e.g. `TWINGHS`, `TWINKES`)
  - Register assets on Stellar testnet first

- [ ] **1.3 Real escrow lifecycle** — call `settlementEscrow.freeze()` from handler
  - For `RESERVE_TO_MARKET` and `MARKET_TO_MARKET`: freeze escrow when stablecoin is locked
  - Release escrow when LP confirms settlement
  - Slash escrow on dispute/fraud

- [ ] **1.4 Real LP auction** — call `auctionEngine.open()` from handler
  - When `liquidity.resolved` determines LP bandwidth is needed, open an auction
  - LPs submit bids via `/api/lp/bid` endpoint
  - Auction closes after timeout or when enough bids cover the amount
  - Winner is selected by greedy cheapest-first (existing logic in `auctions.ts`)
  - Coverage optimization: multiple LPs can partially fill (existing logic)

- [ ] **1.5 Real local rail disbursement** — call provider adapters from `LOCAL_RAIL` branch
  - For domestic payments: use MTN MoMo / Airtel / bank transfer
  - Use `providerRegistry.getByType('mobile_money')` or `providerRegistry.getByType('bank_account')`
  - Confirm settlement when provider returns success

- [ ] **1.6 Event-sourced settlement contracts** — make `SettlementContractEngine` consume events
  - Add `apply(event)` method that processes `settlement.contract.created/funded/claimed/confirmed/released/closed`
  - Register as a projection in `ProjectionRunner`
  - Now `/api/runtime/settlement-contracts` will show real contracts

### Phase 2: Real Stablecoin Custody (~2-4 weeks)
**Goal:** Actual USDC movement for cross-border settlement

- [ ] **2.1 Fireblocks integration** — real USDC custody
  - Lock USDC in Fireblocks vault when `settlement.contract.funded` is emitted
  - Release USDC to LP when `settlement.contract.released` is emitted
  - Use existing `protocol/providers/fireblocks.ts` connector

- [ ] **2.2 Stellar USDC path payments** — cross-border USDC transfer
  - Use `pathPaymentQuote` (already exists in `src/live/stellar.ts`)
  - Send USDC from sender country to receiver country via Stellar path
  - Settle recipient in local currency via LP fiat bandwidth

- [ ] **2.3 Twin token redemption** — burn twin tokens for fiat
  - When recipient redeems twin tokens, burn on Stellar
  - Disburse fiat from local reserve via local rail
  - This closes the cross-border settlement loop

### Phase 3: LP Marketplace & Auction Optimization (~2-4 weeks)
**Goal:** Real LP bidding, coverage optimization, cost optimization

- [ ] **3.1 LP bidding API** — `/api/lp/bid`
  - LPs subscribe to auction events (WebSocket or polling)
  - LPs submit bids with: amount, fee rate, estimated time, coverage area
  - Bids are signed and timestamped

- [ ] **3.2 Coverage optimization** — multi-LP partial fills
  - If one LP can't cover the full amount, split across multiple LPs
  - Greedy cheapest-first selection (existing logic in `auctions.ts`)
  - Track partial fill ratios

- [ ] **3.3 Cost optimization** — minimize total cost
  - Sort LPs by effective fee rate (fee + estimated FX cost + time cost)
  - Prefer LPs with bandwidth in the destination country (avoid extra hops)
  - Use `EconomicMarketplace.requestOffers` (existing logic) for ranking

- [ ] **3.4 LP reputation system** — track performance
  - Record settlement speed, success rate, dispute rate per LP
  - Adjust LP scoring weights based on historical performance
  - Suspend LPs with poor performance

### Phase 4: Real PSP Integration (~1-2 weeks)
**Goal:** Actual payment collection from customers

- [ ] **4.1 Payment collection** — customer pays via Paystack/FLW/Stripe
  - When customer initiates payment, create PaymentIntent on Stripe / initialize on Paystack
  - On webhook confirmation, dispatch `payment.create` through the pipeline
  - This connects the live PSP test (which works) to the actual pipeline

- [ ] **4.2 QR code payments** — in-store checkout
  - Generate dynamic QR code with payment reference
  - On scan + payment, webhook triggers pipeline dispatch

### Phase 5: Dispute & Compliance (~2-4 weeks)
**Goal:** Real dispute resolution and compliance checks

- [ ] **5.1 Wire DisputeEngineV2** — dispute escalation on escrow timeout
  - When escrow expires without LP settlement, auto-open dispute
  - Evidence submission from both parties
  - Community voting + admin adjudication

- [ ] **5.2 Real KYC/AML** — integrate Smile ID / TRM Labs
  - KYC check before first payment
  - AML screening on every payment above threshold
  - Sanctions screening via Chainalysis

---

## Target Architecture (Post-Roadmap)

```
Customer pays →
  ┌─────────────────────────────────────────────────────┐
  │ 1. PAYMENT COLLECTION                                │
  │    Paystack/FLW/Stripe collects from customer        │
  │    Webhook → payment.create dispatched               │
  └──────────────────────┬──────────────────────────────┘
                         ▼
  ┌─────────────────────────────────────────────────────┐
  │ 2. ROUTING (LiquidityPolicyEngine)                   │
  │    Domestic? → LOCAL_RAIL                            │
  │    Cross-border? → RESERVE_TO_MARKET / MARKET_*      │
  └──────────────────────┬──────────────────────────────┘
                         ▼
  ┌──────────────┬───────────────────────────────────────┐
  │ LOCAL_RAIL   │ CROSS-BORDER                          │
  │              │                                       │
  │ 3a. Disburse │ 3b. Lock USDC in escrow (Fireblocks)  │
  │ via local    │ 3c. Mint TWIN<CCY> on Stellar         │
  │ rail (MTN    │ 3d. Open LP auction                   │
  │ MoMo/bank)   │ 3e. LPs bid → winner selected         │
  │              │ 3f. Winner disburses via local rail   │
  │ 3a'. Confirm │ 3g. Release escrow → burn twin tokens │
  │ settlement   │ 3h. Confirm settlement                │
  └──────────────┴───────────────────────────────────────┘
                         ▼
  ┌─────────────────────────────────────────────────────┐
  │ 4. LEDGER (double-entry, balanced)                   │
  │    Post debit/credit entries                         │
  │    Update projections (payment, wallet, treasury)    │
  └─────────────────────────────────────────────────────┘
```

---

## Key Files to Modify (Phase 1)

| File | Change | Priority |
|------|--------|----------|
| `src/runtime/dispatcher/handlers.ts` | Wire all real implementations (Stellar, twin tokens, escrow, auctions, providers) | P0 |
| `src/runtime/settlement/adapters.ts` | Replace stub with real `stellarChainAdapter` | P0 |
| `src/runtime/liquidity/settlement-contract-engine.ts` | Add `apply(events)` method for event sourcing | P1 |
| `src/protocol/twin-token/engine.ts` | Configure with Stellar testnet credentials | P1 |
| `src/protocol/settlement/auctions.ts` | Wire to dispatcher's `liquidity.resolved` step | P1 |
| `src/protocol/providers/registry.ts` | Wire to `LOCAL_RAIL` branch for disbursement | P1 |
| New: `src/app/api/lp/bid/route.ts` | LP bidding endpoint | P2 |

---

## Summary

The architecture is sound — the event-sourced pipeline, invariant engine, policy engine, and all the real implementations (Stellar, twin tokens, escrow, auctions, providers) exist and work correctly in isolation. The gap is **wiring**: the dispatcher emits events but doesn't call the real implementations.

**Phase 1 (1 week)** closes most of the gap by wiring existing code — no new business logic needed. This would make PaySwap a real cross-border settlement network with:
- Real Stellar twin token minting
- Real escrow lifecycle
- Real LP auctions
- Real local rail disbursement
- Real stablecoin custody (via Fireblocks)

**Phase 2-5** add the remaining production features (real USDC custody, LP marketplace, PSP collection, dispute resolution).
