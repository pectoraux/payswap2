# PaySwap — Architectural Decisions (I1 + I2)

> These decisions close the two open invariant questions from the wiring roadmap.
> They are the foundation for the long-term direction (D1, D2).

---

## I1 — Should `RESERVE_TO_RESERVE` balance in-plan?

### Decision: **Accumulate corridor obligations, settle net on a cycle.**

The plan does **not** debit the destination reserve in-plan. Instead:
1. The sender's FIAT reserve is credited (real FIAT came in from the sender).
2. Twin tokens are minted at the destination (1:1 backed by destination FIAT reserve — the implicit obligation).
3. A corridor obligation `fromCountry → toCountry` is recorded with the amount.
4. The `CorridorBalancer` (W5) settles the obligation on a cycle, moving the **net** (not gross) between reserves.

### Why
- **Cost:** Gross settlement would move 2.35M for a balanced KE↔GH corridor that nets to 50K. Net settlement is the largest cost lever in the system.
- **Reserve stability:** In-plan debits would cause destination reserves to swing with every payment, requiring larger buffers. Net settlement smooths the swings.
- **Already wired:** `NetSettlementEngine.record()` is called from the tier-3 path in `handlers.ts`, and `CorridorBalancer.rebalance()` is invoked by `/api/treasury/rebalance`. The loop exists; we just need to monitor its drift.

### Acceptance criterion
Per-country reserve drift is a monitored number with an alarm threshold.
- Implementation: `src/protocol/treasury-v2/reserve-drift-monitor.ts`
- API: `/api/treasury/drift` — returns per-currency drift over rolling windows with alarm status.
- Alarm fires when `|drift| / startingBalance > threshold` (default 30% per 24h).

---

## I2 — What do twin tokens do on `LOCAL_RAIL`?

### Decision: **Mint-on-deposit, off payment path. Twin tokens are NOT minted during `LOCAL_RAIL`.**

Twin token supply tracks **reserve top-ups**, not payment flows.

- **Mint:** when FIAT is deposited into a PaySwap FIAT reserve (a treasury operation, e.g. customer tops up the GHS reserve via bank transfer).
- **Burn:** when FIAT is withdrawn from a PaySwap FIAT reserve (e.g. PaySwap disburses FIAT for a cross-border payout).

### What `LOCAL_RAIL` does instead
A local GHS→GHS payment is two symmetric FIAT movements against the same reserve:
- Sender pays GHS into PaySwap's GHS bank account → reserve +X
- PaySwap disburses GHS to merchant → reserve −X
- Net reserve movement: 0
- Net twin token movement: 0

The twin token mint+burn is therefore **wasteful** on `LOCAL_RAIL`. Instead:
- `LOCAL_RAIL` produces **only ledger entries** (debit customer's wallet / receivable, credit merchant's wallet / payable).
- No `twin.minted` event is emitted on the `LOCAL_RAIL` path.

### tGHS's local job (one sentence)
> `tGHS` is the auditable on-chain claim on PaySwap's GHS FIAT reserve — it moves cross-border and gets burned for FIAT at redemption; locally it is held as a savings/vault balance, not used as a transactional medium.

### What this means for the code
- **`policy-engine.ts:compileLocalRail()`** — remove the `mint_twin_tokens` action. Keep `credit_fiat_reserve` (sender's deposit) + the settlement contract.
- **`handlers.ts` tier-1 path** — remove the `twin.minted` + `twin.backed` events. Keep `treasury.account.credited` (the FIAT credit against the reserve).
- **Twin token minting stays** on the cross-border tier-3 path (real FIAT deposit at sender side → mint twin → bridge → burn at destination).

### Acceptance criterion
- A `LOCAL_RAIL` payment no longer emits `twin.minted`.
- The decision is documented (this file) with one sentence naming `tGHS`'s local job.

---

## MON-5 — One rounding policy, one site

### Decision: HALF_UP everywhere, residual to the fee earner.

**Fees** (the `mulBps` path): `Math.round(amount * bps / 10000)` — HALF_UP.
The residual (the rounding remainder) is assigned to the fee earner
(PaySwap or the LP), never to the merchant or customer. This is the
`Money.mulBps()` implementation: `(minorUnits * bps + 5000) / 10000`.

**FX** (the `convert` path): HALF_UP on the converted amount. The spread
accrues to the treasury. The `FxEngine.quote()` method applies the spread
as `midRate * (1 - spreadBps / 1e4)` — the residual goes to the treasury.

**Splits** (the `allocate` path): the largest remainder method. Parts are
computed as `floor(total * ratio / sum_ratios)`, then the remainder is
distributed one minor unit at a time to the parts with the largest
fractional remainder. The parts sum **exactly** to the total — no rounding
gap. This is the `Money.allocate()` implementation.

**The one invariant:** `fee + netAmount == grossAmount` for every payment,
exactly, in integer minor units. The property test in
`tests/money.property.test.ts` asserts this for a million random amounts.

### Why HALF_UP (not HALF_EVEN)
HALF_UP is the standard for financial calculations (it's what Stripe, Wise,
and most banks use). HALF_EVEN (banker's rounding) is better for statistics
but produces results that surprise users — a 0.5 fee rounds up, not "to the
nearest even number." Financial systems prioritize predictability over
statistical unbiasedness.
