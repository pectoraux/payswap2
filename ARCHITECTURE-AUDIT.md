# PaySwap Architecture Audit & Roadmap (v2 — Simplified)

## One-Sentence Vision

> A liquidity network with two reserve layers: local FIAT reserves for domestic settlement, and crypto reserves for cross-border settlement, with LPs extending reserve capacity through approved bandwidth when PaySwap's own reserves are insufficient.

---

## The Simplified Model

### Two reserve layers, one clear rule:

```
Local payments  → FIAT reserves
Cross-border    → Crypto reserves
```

### Reserve types:

| Reserve | Used for | Example |
|---------|----------|---------|
| **FIAT reserves** | Local transfers, merchant settlement, cash-out, wallet top-ups | GHS bank account in Ghana |
| **Crypto reserves** | Cross-border movement where no FIAT reserve exists | USDC (stablecoin) |
| **Twin tokens** | Cross-border where FIAT reserve DOES exist (1:1 mirror) | `tGHS` = mirror of GHS FIAT reserve |

### Evolution path:

```
stablecoin-heavy cross-border liquidity
        ↓ (as PaySwap opens more FIAT reserves)
more FIAT reserves → more twin-token reserves
        ↓
less stablecoin dependency
```

---

## LP Role: Reserve Capacity Providers

LPs are NOT a separate settlement layer — they **extend** PaySwap's reserve capacity.

### A. LP FIAT bandwidth
In countries where PaySwap doesn't yet have enough FIAT reserves, LPs let PaySwap auto-settle by withdrawing from their PSP/bank/rail accounts. LPs are compensated when their bandwidth is used.

### B. LP crypto bandwidth
In countries without FIAT reserves, LPs provide stablecoin bandwidth for cross-border settlement via blockchain rails.

---

## The Settlement Waterfall

This is the ONLY priority order — simple and predictable:

```
1. PaySwap FIAT reserves          (cheapest — our own money, 0 LP fee)
2. LP FIAT bandwidth              (LP extends our fiat capacity, LP fee)
3. PaySwap crypto reserves        (our USDC/twin tokens, 0 LP fee)
4. LP crypto bandwidth            (LP extends our crypto capacity, LP fee)
5. LP marketplace auction         (open auction — last resort, highest fee)
```

### Decision flow:

```
Customer Payment
      ↓
Settlement Router
      ↓
Is this local (same country)?

YES → Try FIAT waterfall:
        1. PaySwap FIAT reserve sufficient? → Settle, mint twin token
        2. LP FIAT bandwidth available? → Settle via LP, compensate LP
        3. Neither? → Open marketplace auction

NO → Try Crypto waterfall:
        1. Does destination have FIAT reserve? 
           YES → Use twin token (mint/burn on Stellar)
           NO  → Use stablecoin (USDC transfer on Stellar)
        2. PaySwap crypto reserve sufficient? → Settle
        3. LP crypto bandwidth available? → Settle via LP
        4. Neither? → Open marketplace auction
```

---

## The Core Invariant

```
FIAT reserve movement ↔ matching reserve asset movement
```

- FIAT deposited into reserve → matching twin token minted
- FIAT withdrawn from reserve → matching twin token burned
- This gives exact 1:1 backing for the FIAT reserve layer

---

## Current State vs Target

| Component | Current State | Target State |
|-----------|--------------|--------------|
| **FIAT reserves** | Hardcoded $50K Ghana, $0 others | Real bank accounts, real balance tracking |
| **Crypto reserves** | Hardcoded $20K USDC | Real Stellar wallet, real USDC/twin token balances |
| **Twin tokens** | 3 implementations, none wired | Single Stellar-backed engine, minted/burned on FIAT movement |
| **LP FIAT bandwidth** | Hardcoded split, no LP queried | Real LP bank authorization, auto-debit, compensation |
| **LP crypto bandwidth** | Hardcoded split | Real LP USDC bandwidth on Stellar |
| **Marketplace auction** | 3 implementations, none triggered | Single auction engine, triggered as last resort |
| **Local rails** | 13 adapters, none called | Real MTN MoMo / bank transfer for local disbursement |
| **Stellar** | Real adapter exists, stub used | Real adapter for twin token mint/burn + USDC transfer |

---

## What to Keep, Delete, Build

### KEEP (solid foundation)
- ✅ `src/runtime/dispatcher/` — event-sourced pipeline, OCC, invariants
- ✅ `src/runtime/ledger/engine.ts` — double-entry ledger
- ✅ `src/runtime/liquidity/policy-engine.ts` — strategy selection (needs simplification to 2-layer model)
- ✅ `src/runtime/host/runtime-host.ts` — sandbox/live isolation
- ✅ `src/protocol/chains/stellar/adapter.ts` — real Stellar adapter
- ✅ `src/protocol/twin-token/engine.ts` — real Stellar-backed twin token engine
- ✅ `src/protocol/settlement/escrow.ts` — real escrow lifecycle
- ✅ `src/protocol/settlement/auctions.ts` — real auction engine
- ✅ `src/protocol/providers/` — 13 provider adapters
- ✅ `src/live/` — real Stripe/Paystack/Flutterwave/Stellar connectors

### DELETE (parallel stubs, duplicates, dead code)
- ❌ `src/runtime/settlement/adapters.ts` — stub returning fake txHashes
- ❌ `src/kernel/twin-token.ts` — duplicate of `protocol/twin-token/engine.ts`
- ❌ `src/kernel/treasury.ts` + `treasury-ai.ts` — simulation-only
- ❌ `src/protocol/treasury.ts` (old v1)
- ❌ `src/protocol/contracts/index.ts` — unused SmartContract interfaces
- ❌ 13 NoOp engine stubs in `src/runtime/engines/`
- ❌ `src/kernel/liquidity-planner.ts` — superseded by policy engine
- ❌ `src/runtime/economic/marketplace.ts` — duplicate of auction engine
- ❌ `src/runtime/engines/liquidity-marketplace/service.ts` — duplicate, read-only

### BUILD (wiring + simplification)

#### A. Simplify the policy engine to 2-layer model
Replace the 5-strategy model with the 2-layer waterfall:

Current:
```
LOCAL_RAIL | RESERVE_TO_RESERVE | RESERVE_TO_MARKET | MARKET_TO_RESERVE | MARKET_TO_MARKET
```

Simplified:
```
LOCAL (same country) → FIAT waterfall
CROSS_BORDER → Crypto waterfall (twin token if FIAT reserve exists, stablecoin if not)
```

#### B. Wire real execution to the waterfall steps
Each waterfall step calls a real implementation:

| Waterfall Step | Real Implementation |
|---------------|-------------------|
| PaySwap FIAT reserve | Check real bank balance → disburse via local rail |
| LP FIAT bandwidth | Query LP bank authorization → auto-debit → compensate LP |
| PaySwap crypto reserve | Check Stellar wallet → transfer USDC or mint/burn twin token |
| LP crypto bandwidth | Query LP Stellar bandwidth → transfer → compensate LP |
| Marketplace auction | `auctionEngine.open()` → LPs bid → `auctionEngine.close()` → award |

#### C. Implement the core invariant
```
FIAT deposited → twin token minted on Stellar
FIAT withdrawn → twin token burned on Stellar
```

---

## Roadmap

### Phase 0: Simplify & Clean (~2 days)

**Goal:** Reduce to the 2-layer model, delete dead code

- [ ] **0.1 Simplify LiquidityPolicyEngine** to 2-layer waterfall
  - Replace 5 strategies with: `LOCAL` (fiat waterfall) + `CROSS_BORDER` (crypto waterfall)
  - The waterfall priority is hardcoded: FIAT reserve → LP FIAT → crypto reserve → LP crypto → auction
  - Remove `RESERVE_TO_RESERVE`, `RESERVE_TO_MARKET`, `MARKET_TO_RESERVE`, `MARKET_TO_MARKET` as separate strategies
  - The router just asks: "Is this local?" → FIAT waterfall; "Is this cross-border?" → Crypto waterfall

- [ ] **0.2 Delete dead code**
  - Stub adapters, duplicate twin token engine, old treasury, NoOp stubs, duplicate marketplace

- [ ] **0.3 Simplify PaymentCommandHandler**
  - Remove the 5-strategy switch
  - Replace with: `if (local) { fiatWaterfall() } else { cryptoWaterfall() }`
  - Each waterfall step tries the next priority if the current one is insufficient

### Phase 1: Wire Real Execution (~1 week)

**Goal:** Connect existing implementations to the waterfall

- [ ] **1.1 Real FIAT reserve balance**
  - Replace hardcoded `$50K Ghana` with real balance lookup
  - Track FIAT reserves per country in the event store
  - When FIAT is deposited/withdrawn, emit `reserve.fiat.deposited` / `reserve.fiat.withdrawn`

- [ ] **1.2 Real twin token mint/burn on Stellar**
  - When FIAT is deposited → call `twinTokenEngine.mint()` on Stellar
  - When FIAT is withdrawn → call `twinTokenEngine.burn()` on Stellar
  - This implements the core invariant: FIAT movement ↔ twin token movement

- [ ] **1.3 Real crypto reserve balance**
  - Replace hardcoded `$20K USDC` with real Stellar wallet balance
  - Query Stellar account for USDC + twin token balances
  - Use `src/live/stellar.ts` or `src/protocol/chains/stellar/adapter.ts`

- [ ] **1.4 Real LP bandwidth query**
  - Replace hardcoded LP split with real `BandwidthEngine.findAvailable()`
  - LPs register their fiat + crypto bandwidth
  - When bandwidth is consumed, update the LP's position

- [ ] **1.5 Real local rail disbursement**
  - For FIAT waterfall step 1: call provider adapter (MTN MoMo / bank) to disburse
  - Use `providerRegistry.getByType('mobile_money')` or `('bank_account')`
  - On provider confirmation → settlement confirmed

- [ ] **1.6 Real escrow for marketplace auction**
  - When waterfall reaches step 5 (auction):
    - `settlementEscrow.freeze()` — lock the stablecoin
    - `auctionEngine.open()` — open auction for LPs
    - LPs bid via `/api/lp/bid`
    - `auctionEngine.close()` — select winner(s)
    - Winner disburses → `settlementEscrow.release()`

### Phase 2: LP Bandwidth System (~2 weeks)

**Goal:** Real LP registration, bandwidth, compensation

- [ ] **2.1 LP registration API** — `/api/lp/register`
  - LP provides: country, currency, bank account authorization, stablecoin address
  - System registers LP in `BandwidthEngine`
  - LP stakes collateral (twin tokens or USDC)

- [ ] **2.2 LP fiat bandwidth** — auto-debit authorization
  - LP authorizes PaySwap to debit their PSP/bank account
  - When FIAT waterfall reaches step 2 (LP FIAT), system debits LP account
  - LP is compensated with fee share

- [ ] **2.3 LP crypto bandwidth** — Stellar bandwidth
  - LP provides USDC bandwidth on Stellar
  - When crypto waterfall reaches step 4 (LP crypto), system transfers from LP's Stellar account
  - LP is compensated with fee share

- [ ] **2.4 LP compensation** — fee distribution
  - When LP bandwidth is used, LP earns their fee share (based on waterfall step)
  - Step 2 (LP FIAT): lower fee (PaySwap's own rail, LP just provides capacity)
  - Step 4 (LP crypto): higher fee (LP provides cross-border liquidity)
  - Step 5 (auction): highest fee (market rate)

### Phase 3: Real Cross-Border Settlement (~2 weeks)

**Goal:** Actual money movement across borders

- [ ] **3.1 Twin token settlement** — when destination has FIAT reserve
  - Sender deposits FIAT in country A → mint `tA` twin token
  - Transfer `tA` on Stellar to country B
  - Burn `tA` in country B → withdraw FIAT from country B reserve
  - This is the "twin token bridge" — 1:1 backed, no slippage

- [ ] **3.2 Stablecoin settlement** — when destination has NO FIAT reserve
  - Sender deposits FIAT in country A → mint `tA` twin token
  - Swap `tA` → USDC on Stellar (or use PaySwap's USDC reserve)
  - Transfer USDC to country B
  - LP in country B provides fiat bandwidth → disburses to recipient
  - LP is compensated from the USDC

- [ ] **3.3 Stellar path payments** — optimized routing
  - Use `pathPaymentQuote` to find the cheapest path
  - May route through multiple hops (tA → USDC → tB)
  - Settlement is atomic on Stellar

### Phase 4: Marketplace Auction (~2 weeks)

**Goal:** Real LP bidding as last resort

- [ ] **4.1 Auction lifecycle in pipeline**
  - When waterfall reaches step 5: `auctionEngine.open()`
  - LPs receive notification (WebSocket or polling)
  - LPs submit bids: amount, fee rate, estimated time
  - `auctionEngine.close()` after timeout or full coverage
  - Greedy cheapest-first selection (existing logic)
  - Multi-LP partial fills for coverage optimization

- [ ] **4.2 LP reputation tracking**
  - Record: settlement speed, success rate, dispute rate
  - Adjust LP ranking in future auctions
  - Suspend LPs with poor performance

### Phase 5: PSP Collection & Real Money In (~1 week)

**Goal:** Customers actually pay into the system

- [ ] **5.1 Payment collection via PSP**
  - Customer pays via Paystack/FLW/Stripe
  - PSP webhook → `payment.create` dispatched through pipeline
  - FIAT deposited into PaySwap's bank account → twin token minted

- [ ] **5.2 QR code payments**
  - Generate dynamic QR for in-store checkout
  - On scan + pay → webhook → pipeline dispatch

---

## Simplified Fee Model

| Waterfall Step | Fee | Who Earns |
|---------------|-----|-----------|
| 1. PaySwap FIAT reserve | 0.8% (80bps) | 100% PaySwap |
| 2. LP FIAT bandwidth | 1.0% (100bps) | 60% PaySwap, 40% LP |
| 3. PaySwap crypto reserve | 1.2% (120bps) | 100% PaySwap |
| 4. LP crypto bandwidth | 1.5% (150bps) | 20% PaySwap, 80% LP |
| 5. Marketplace auction | 2.0%+ (200bps+) | 10% PaySwap, 90% LP (market rate) |

**Customer sees:** the fee from whichever waterfall step settles their payment. The waterfall is transparent — cheaper for customers when PaySwap has reserves, more expensive when LPs/marketplace are needed.

---

## The Simplest Diagram

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
    │    reserve?         │  │   YES → Use twin token (mint/burn)│
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
    │ FIAT deposit  → mint twin token on Stellar    │
    │ FIAT withdraw → burn twin token on Stellar    │
    │ 1:1 backing, always auditable                 │
    └───────────────────────────────────────────────┘
```
