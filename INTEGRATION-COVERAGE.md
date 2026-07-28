# PaySwap Integration Coverage Matrix

> **Status**: Verified by code audit on 2028-01-28
> This matrix shows which runtime components are ACTUALLY invoked for each
> transaction type — based on tracing the real code paths, not claims.

## Legend

- ✅ = Component is invoked in the execution path
- ❌ = Component is NOT invoked (bypassed)
- ⚠️ = Component is invoked but only partially (e.g., skeleton handler)

## Execution Path (Verified)

The standard payment flow now goes through the runtime kernel:

```
API Route (/api/payments/create)
    ↓
paymentService.create()  (src/services/payment-service.ts)
    ↓
runtime.dispatcher.dispatch({ type: 'payment.create', payload })
    ↓
┌─────────────────────────────────────────────────────────┐
│ RuntimeDispatcher.dispatchOnce()                         │
│  1. Look up handler (CommandRegistry)                   │
│  2. Build snapshot (load stream versions for OCC)        │
│  3. Compile — handler produces events                    │
│     ├── payment.recorded   (status PENDING)              │
│     ├── payment.completed  (if success)                   │
│     └── ledger.entry.posted (balanced double-entry)      │
│  4. Verify invariants (InvariantEngine / Constitution)   │
│  5. Append to EventStore (with OCC)                      │
│  6. Projections update Prisma read models                │
└─────────────────────────────────────────────────────────┘
    ↓
EventBus.emit (application-level notification: webhooks, audit log)
```

## Matrix

| Transaction Type | API Endpoint | Service | Dispatcher | Event Store | Invariants (Constitution) | Ledger | Intent Engine | Economic Compiler | Liquidity Policy | Economic Council | Tx Coordinator | Settlement Orchestrator | Digital Twin | Economic Memory | Marketplace | Liquidity Composer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Domestic Payment** | /api/payments/create | paymentService | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Cross-border Payment** | /api/payments/create | paymentService | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Payout** | /api/payouts/create | payoutService | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Refund** | /api/refunds/create | refundService | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Wallet Credit** | /api/customer/wallet/deposit | (direct) | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Wallet Debit** | /api/customer/wallet/withdraw | (direct) | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Wallet Transfer** | /api/customer/wallet/transfer | (direct) | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Reserve→Reserve** | (admin) | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Reserve→Market** | (admin) | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Market→Reserve** | (admin) | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Market→Market** | (admin) | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Chargeback** | — | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Dispute** | /api/disputes | (direct) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Redemption** | — | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **LP Onboarding** | /api/lp/capital | (direct) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **LP Slashing** | (admin) | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Stablecoin Acquisition** | — | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Reserve Expansion** | /api/runtime/expansion | expansionEngine | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |

## Summary

### Well-Integrated (✅)
- **Payments, Payouts, Refunds, Wallet operations** — all go through the runtime dispatcher, produce events + ledger entries, and are verified by the constitution (invariant engine). The event store is the source of truth. Projections update Prisma read models.

### Not Integrated (❌)
- **Intent Engine** — the services call `dispatch()` directly, not through the intent compiler. The intent engine exists but is only used by the simulator.
- **Economic Compiler** — the dispatcher's command handlers produce events directly, not through the financial compiler. The compiler exists but is only used by the simulator.
- **Liquidity Policy Engine** — no policy evaluation before dispatch. The policy engine exists but is not invoked.
- **Economic Council** — no council debate for routine transactions. The council exists but is only used by the simulator.
- **Transaction Coordinator** — no saga coordination. The coordinator exists but is not invoked.
- **Settlement Orchestrator** — no settlement contract lifecycle. The orchestrator exists but is not invoked.
- **Digital Twin** — not updated after payments. The twin is built on-demand from the control plane, not reactively.
- **Economic Memory** — not updated. The eco-intelligence engine exists but is not invoked.
- **Marketplace** — LP marketplace exists but is not invoked during payment routing.
- **Liquidity Composer** — multi-hop routing exists but is not used for real payments.

### Not Implemented (❌)
- **Reserve→Reserve, Reserve→Market, Market→Reserve, Market→Market** — these treasury operations don't have API endpoints or service functions. They exist as concepts in the runtime but are not exposed.
- **Chargeback** — not implemented (disputes exist but don't produce chargebacks).
- **Redemption** — not implemented (twin token redemption flow doesn't exist).
- **LP Onboarding** — LPs are created via direct Prisma writes, not through the dispatcher.
- **LP Slashing** — not implemented (collateral liquidation flow doesn't exist).
- **Stablecoin Acquisition** — not implemented (stablecoin minting flow doesn't exist).

## Recommendations (Priority Order)

1. **Wire the Intent Engine** — paymentService should call `runtime.intentEngine.compile()` before dispatch, producing an intent that the dispatcher processes. This enables the full Intent → Compiler → Dispatch pipeline.

2. **Wire the Liquidity Policy Engine** — after the intent is compiled, the policy engine should evaluate the execution plan before dispatch. This prevents policy violations (e.g., exceeding limits).

3. **Wire the Digital Twin** — after a payment is dispatched, the digital twin should be updated reactively (not just on-demand). This enables real-time network visibility.

4. **Wire the Settlement Orchestrator** — for cross-border payments, the settlement orchestrator should manage the escrow → LP assignment → confirmation lifecycle.

5. **Wire the Economic Council** — for high-value or complex payments, the council should debate the strategy before dispatch.

6. **Implement missing transaction types** — Reserve operations, Redemption, LP onboarding/slashing, Stablecoin acquisition.

7. **Wire the Marketplace** — for payments that need LP liquidity, the marketplace should run an auction to select the best LP.

8. **Wire the Liquidity Composer** — for payments without a direct corridor, the composer should find a multi-hop route.
