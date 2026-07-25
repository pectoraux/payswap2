# Milestone 3 — Gap Review: LP Network

## 1. What gap with Stripe was closed?

Stripe doesn't have an LP network — this is a PaySwap-unique capability. However, the gap closed is between PaySwap's LP being a "dashboard" and being an "operational economy." LPs can now actively manage their business, not just observe it.

## 2. What gap remains?

- **LP onboarding flow**: No KYC/KYB submission for new LPs
- **LP auction system**: LPs don't bid on individual transactions in real-time
- **AI routing**: The planner doesn't yet select LPs based on their configured fees/capacity
- **Auto-balancing**: No automatic reserve optimization across LPs
- **LP reputation evolution**: Reputation is static (no automatic updates from settlement outcomes)
- **Staking Twin Tokens**: LPs can't stake/unstake Twin Tokens
- **LP marketplace**: No public marketplace where merchants can discover and select LPs

## 3. What unique PaySwap capability was added that Stripe does not have?

**LP as a first-class economic actor**: LPs can deposit/withdraw capital, configure per-corridor fees, manage which corridors they participate in, and view real performance analytics (revenue, yield, settlement success rate, top merchants, corridor breakdown). No other payment platform gives liquidity providers this level of operational control.

## 4. Does the implementation preserve the frozen kernel?

**Yes.** Zero files modified in `src/kernel/`.

## 5. Does the Sandbox and Live environment behave correctly?

**Yes.** LP operations are environment-scoped (the LP's settlements are filtered by environment).

## 6. Can every new capability be exercised through the simulator?

**Partially.** The world simulator creates payments with lpId set, so LP settlement history and revenue update automatically. Capital deposits/withdrawals and corridor adjustments are not yet simulated.

## 7. What architectural debt was introduced?

- LPProfile.capacity is a JSON string (not a proper JSON column in SQLite, but works in PostgreSQL). The parsing/serialization is manual.
- feeBps is stored as a JSON map on LPProfile, but the world simulator doesn't read it (it uses a flat feeBps value from the LP actor). These should be unified.

## 8. What should be refactored before the next milestone?

- Unify feeBps storage (either always JSON map or always flat)
- Add LP reputation auto-update when settlements succeed/fail
- Wire the LP's configured fees into the world simulator (so simulated payments use the LP's actual fee structure)

## 9. Production readiness score (0–100)

**40/100** — LPs can manage their business, but the competitive marketplace (bidding, routing, auto-balancing) is not yet implemented.

## 10. Estimated parity with Stripe (0–100)

N/A — Stripe has no LP network. But compared to the vision of a "programmable liquidity network," the LP marketplace is at **25%** — LPs can manage their position but don't yet compete for transactions in real-time.
