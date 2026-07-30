# PaySwap Runtime Test Scenario Catalog

> Run these scenarios from the admin runtime simulator (`/admin/runtime`).
> After each scenario, log into the involved actors' accounts to verify the
> transaction reflects correctly. All passwords: `Payswap123456`

## Setup

The demo data has:
- **100 merchants** across Ghana (GHS), Togo (XOF), Kenya (KES), Nigeria (NGN)
- **10,000 customers** with wallet balances
- **1,000 LPs** (250 per country) with bandwidth
- **Reserves**: Ghana (GHS 5M), Togo (XOF 3M), Treasury (USDC 3.5M)
- **No reserves**: Kenya, Nigeria

---

## Scenario 1: LOCAL_RAIL (Domestic Payment)

**Tests**: Same-country payment, no stablecoins, no LPs

| Field | Value |
|-------|-------|
| Merchant | merchant1@demo.payswap (Ghana, GHS) |
| Customer | customer1@demo.payswap (Ghana, GHS) |
| Amount | 500 |
| Currency | GHS |
| Corridor | GHS-GHS |

**Expected behavior**:
- Strategy: `LOCAL_RAIL`
- Events: `payment.recorded` + `payment.completed` + `treasury.account.credited` + `twin.minted` + `twin.backed` + `ledger.entry.posted`
- No stablecoins, no LPs, no settlement contracts
- Merchant wallet increases by 500 GHS
- Twin tokens minted 1:1 with reserve credit

**Verify after**:
1. Log in as `merchant1@demo.payswap` → check payments table
2. Log in as `customer1@demo.payswap` → check wallet balance decreased
3. Check admin → Treasury Control Center → Ghana reserve increased

---

## Scenario 2: RESERVE_TO_RESERVE (Cross-Border, Both Have Reserves)

**Tests**: Cross-border between two countries with fiat reserves

| Field | Value |
|-------|-------|
| Merchant | merchant1@demo.payswap (Ghana, GHS) |
| Customer | customer26@demo.payswap (Togo, XOF) |
| Amount | 1000 |
| Currency | GHS |
| Corridor | GHS-XOF |

**Expected behavior**:
- Strategy: `RESERVE_TO_RESERVE`
- Events: `payment.recorded` + `payment.completed` + `treasury.account.credited` (Ghana) + `twin.minted` (XOF) + `twin.backed` + `ledger.entry.posted`
- No stablecoins moved
- No LP bandwidth consumed
- Recipient gets XOF-denominated twin tokens

**Verify after**:
1. Log in as `merchant1@demo.payswap` → payment in GHS
2. Log in as `customer26@demo.payswap` → wallet shows XOF twin tokens
3. Check admin → Twin Token Dashboard → supply increased

---

## Scenario 3: RESERVE_TO_MARKET (Sender Has Reserve, Receiver Doesn't)

**Tests**: Cross-border to a country without fiat reserve (Kenya/Nigeria)

| Field | Value |
|-------|-------|
| Merchant | merchant1@demo.payswap (Ghana, GHS) |
| Customer | customer51@demo.payswap (Kenya, KES) |
| Amount | 500 |
| Currency | GHS |
| Corridor | GHS-KES |

**Expected behavior**:
- Strategy: `RESERVE_TO_MARKET`
- Events: `payment.recorded` + `payment.completed` + `treasury.account.credited` (Ghana) + `settlement.contract.created` + `settlement.contract.funded` + `ledger.entry.posted`
- Stablecoins locked in escrow
- Settlement contract created (pending LP claim)

**Verify after**:
1. Log in as `merchant1@demo.payswap` → payment completed
2. Check admin → Settlement Contracts → pending contract for GHS→KES
3. Log in as an eligible LP (e.g., `lp501@demo.payswap` — Kenya LP) → Settlements page → claim the order
4. After LP claims + pays recipient + recipient confirms → stablecoins released

---

## Scenario 4: MARKET_TO_RESERVE (Sender Has No Reserve, Receiver Does)

**Tests**: Cross-border from a country without reserve to one with reserve

| Field | Value |
|-------|-------|
| Merchant | merchant51@demo.payswap (Kenya, KES) |
| Customer | customer1@demo.payswap (Ghana, GHS) |
| Amount | 2000 |
| Currency | KES |
| Corridor | KES-GHS |

**Expected behavior**:
- Strategy: `MARKET_TO_RESERVE`
- Events: `payment.recorded` + `payment.completed` + `treasury.account.credited` (stablecoin) + `twin.minted` (GHS) + `twin.backed` + `ledger.entry.posted`
- Stablecoins obtained from LP/marketplace
- Twin tokens minted for Ghana recipient

**Verify after**:
1. Log in as `merchant51@demo.payswap` → payment completed
2. Log in as `customer1@demo.payswap` → wallet shows GHS twin tokens
3. Check admin → Liquidity Market → LP bandwidth consumed in Kenya

---

## Scenario 5: MARKET_TO_MARKET (Neither Has Reserve)

**Tests**: Cross-border between two countries without reserves

| Field | Value |
|-------|-------|
| Merchant | merchant51@demo.payswap (Kenya, KES) |
| Customer | customer76@demo.payswap (Nigeria, NGN) |
| Amount | 3000 |
| Currency | KES |
| Corridor | KES-NGN |

**Expected behavior**:
- Strategy: `MARKET_TO_MARKET`
- Events: `payment.recorded` + `payment.completed` + `treasury.account.credited` (stablecoin) + `settlement.contract.created` + `settlement.contract.funded` + `ledger.entry.posted`
- Stablecoins obtained + locked in escrow
- Settlement contract created for LP in Nigeria

**Verify after**:
1. Log in as `merchant51@demo.payswap` → payment completed
2. Check admin → Settlement Contracts → pending contract for KES→NGN
3. Log in as an eligible Nigeria LP (e.g., `lp751@demo.payswap`) → claim the order
4. After confirmation → stablecoins released to LP

---

## Scenario 6: Failed Payment (Value Preservation)

**Tests**: Failed payment produces no ledger entries

| Field | Value |
|-------|-------|
| Merchant | merchant1@demo.payswap |
| Customer | customer1@demo.payswap |
| Amount | 100 |
| Currency | GHS |
| Corridor | GHS-GHS |
| Success | false |

**Expected behavior**:
- Events: `payment.recorded` + `payment.failed` (NO `payment.completed`, NO `ledger.entry.posted`, NO `twin.minted`)
- Balance sheet unchanged
- No treasury movements

**Verify after**:
1. Log in as `merchant1@demo.payswap` → payment shows FAILED
2. Check admin → Treasury → no change in reserves

---

## Scenario 7: High-Value Strategic Payment

**Tests**: STRATEGIC profile (council + twin + coordinator invoked)

| Field | Value |
|-------|-------|
| Merchant | merchant1@demo.payswap |
| Customer | customer26@demo.payswap |
| Amount | 500000 |
| Currency | USD |
| Corridor | USD-USD |

**Expected behavior**:
- Profile: `STRATEGIC` (not FAST)
- Execution trace includes: council + twin + coordinator + settlement
- All pipeline stages invoked

**Verify after**:
1. Check admin → Runtime → execution trace shows STRATEGIC profile
2. All 13 stages invoked (vs 7 for FAST)

---

## Scenario 8: Refund Flow

**Tests**: Refund after successful payment

**Prerequisite**: Run Scenario 1 first (create a payment)

| Field | Value |
|-------|-------|
| Payment ID | (from Scenario 1 result) |
| Amount | 250 (partial refund) |
| Type | PARTIAL |

**Expected behavior**:
- Events: `refund.requested` + `refund.executed` + `ledger.entry.posted` (reversal)
- Merchant receivable reversed
- LP payable reversed

**Verify after**:
1. Log in as `merchant1@demo.payswap` → refunds page shows refund
2. Check admin → Ledger → reversal entries posted

---

## Scenario 9: Payout Flow

**Tests**: Merchant payout (withdrawal)

| Field | Value |
|-------|-------|
| Merchant | merchant1@demo.payswap |
| Amount | 5000 |
| Currency | GHS |
| Method | bank |

**Expected behavior**:
- Events: `payout.recorded` + `payout.completed` + `ledger.entry.posted`
- Merchant wallet decreases

**Verify after**:
1. Log in as `merchant1@demo.payswap` → payouts page
2. Wallet balance decreased by 5000 GHS + fee

---

## Scenario 10: Concurrent Payments (Stress Test)

**Tests**: Multiple simultaneous payments don't corrupt state

**Run**: 10 payments simultaneously from the runtime

| Payment | Merchant | Customer | Amount | Corridor |
|---------|----------|----------|--------|----------|
| 1 | merchant1 | customer1 | 100 | GHS-GHS |
| 2 | merchant2 | customer101 | 200 | XOF-XOF |
| 3 | merchant3 | customer201 | 150 | KES-KES |
| 4 | merchant4 | customer301 | 300 | NGN-NGN |
| 5 | merchant1 | customer2 | 100 | GHS-GHS |
| 6 | merchant2 | customer102 | 200 | XOF-XOF |
| 7 | merchant3 | customer202 | 150 | KES-KES |
| 8 | merchant4 | customer302 | 300 | NGN-NGN |
| 9 | merchant1 | customer3 | 500 | GHS-KES |
| 10 | merchant2 | customer103 | 1000 | XOF-NGN |

**Expected behavior**:
- All 10 payments succeed (or some OCC retries)
- No duplicate payment IDs
- No negative balances
- All ledger entries balanced

**Verify after**:
1. Check admin → Runtime → planner telemetry shows 10 traces
2. Each payment has unique ID
3. No invariant violations

---

## Scenario 11: LP Settlement Order Claim

**Tests**: LP claims a pending settlement order from RESERVE_TO_MARKET

**Prerequisite**: Run Scenario 3 first (creates a settlement contract)

**Steps**:
1. Log in as `lp501@demo.payswap` (Kenya LP)
2. Go to `/lp/settlements`
3. Find the pending settlement order from Scenario 3
4. Click "Claim"
5. The LP pays the recipient via local rail
6. Recipient confirms receipt
7. Stablecoins released to LP

**Expected behavior**:
- Settlement contract: `funded` → `claimed` → `accepted` → `awaiting_recipient` → `confirmed` → `released` → `closed`
- LP receives stablecoins
- Recipient receives KES

**Verify after**:
1. Log in as `lp501@demo.payswap` → settlements page shows completed order
2. Log in as `customer51@demo.payswap` → wallet shows KES received
3. Check admin → Settlement Timeline → contract lifecycle visible

---

## Scenario 12: Wallet Transfer (Customer to Customer)

**Tests**: Customer wallet transfer

| Field | Value |
|-------|-------|
| Sender | customer1@demo.payswap |
| Recipient | customer2@demo.payswap |
| Amount | 500 |
| Currency | GHS |

**Expected behavior**:
- Sender wallet debited (atomic conditional update — no negative balance)
- Recipient wallet credited
- Events: `wallet.debited` + `wallet.credited` + `treasury.account.debited` + `treasury.account.credited`

**Verify after**:
1. Log in as `customer1@demo.payswap` → wallet balance decreased
2. Log in as `customer2@demo.payswap` → wallet balance increased

---

## Scenario 13: Insufficient Funds (Wallet Withdrawal)

**Tests**: Withdrawal with insufficient balance is rejected

| Field | Value |
|-------|-------|
| Customer | customer1@demo.payswap |
| Amount | 999999999 (more than balance) |
| Currency | GHS |

**Expected behavior**:
- Returns `INSUFFICIENT_FUNDS` before dispatch
- No events produced
- No ledger entries
- Wallet balance unchanged

---

## Scenario 14: Treasury Emergency Freeze

**Tests**: Emergency freeze on a country

| Field | Value |
|-------|-------|
| Target | country |
| Target ID | KE (Kenya) |
| Reason | Regulatory investigation |
| Duration | 24 hours |

**Expected behavior**:
- Kenya frozen for 24 hours
- All Kenya payments blocked
- Admin can unfreeze manually

**Verify after**:
1. Check admin → Treasury → Emergency → active freezes
2. Try a payment involving Kenya → should fail

---

## Scenario 15: Claims/Evidence/Voting

**Tests**: Dispute a transaction and resolve it

**Steps**:
1. Log in as `merchant1@demo.payswap`
2. Go to `/dashboard/claims`
3. Create a claim against a payment
4. Submit evidence (screenshot reference)
5. Community votes
6. Admin resolves/vetoes

**Verify after**:
1. Check admin → `/admin/claims` → claim visible
2. Admin can veto the claim
3. Resolution recorded

---

## Test Matrix Summary

| # | Scenario | Strategy | Stablecoins | LPs | Escrow | Twin Tokens |
|---|----------|----------|-------------|-----|--------|-------------|
| 1 | Domestic | LOCAL_RAIL | No | No | No | Yes |
| 2 | Cross-border (both reserve) | RESERVE_TO_RESERVE | No | No | No | Yes |
| 3 | Cross-border (receiver no reserve) | RESERVE_TO_MARKET | Yes | Yes | Yes | No |
| 4 | Cross-border (sender no reserve) | MARKET_TO_RESERVE | Yes | Yes | No | Yes |
| 5 | Cross-border (neither reserve) | MARKET_TO_MARKET | Yes | Yes | Yes | No |
| 6 | Failed payment | N/A | No | No | No | No |
| 7 | High-value | STRATEGIC | Depends | Depends | Depends | Yes |
| 8 | Refund | N/A | No | No | No | Reversed |
| 9 | Payout | N/A | No | No | No | No |
| 10 | Concurrent | Mixed | Mixed | Mixed | Mixed | Mixed |
| 11 | LP claim | RESERVE_TO_MARKET | Released | Claimed | Released | No |
| 12 | Wallet transfer | N/A | No | No | No | No |
| 13 | Insufficient funds | N/A | No | No | No | No |
| 14 | Emergency freeze | N/A | N/A | N/A | N/A | N/A |
| 15 | Claims/voting | N/A | N/A | N/A | N/A | N/A |
