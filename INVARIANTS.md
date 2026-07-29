# PaySwap Production Invariant Checklist

> This is the real definition of "production ready."
> Not features implemented, not tests passed — invariants proven.
> Every invariant must be ✅ before handling real money.

## Financial Invariants

| # | Invariant | Status | Evidence |
|---|-----------|--------|----------|
| F1 | Assets = Liabilities + Equity after every operation | ✅ | SolvencyInvariant enforced on every dispatch; P2a/P2b tests pass |
| F2 | Double-entry always balances (Σ debits == Σ credits) | ✅ | DoubleEntryInvariant enforced; P1a/P1b/P10a tests pass |
| F3 | Twin token supply ≤ reserves (1:1 backing) | ✅ | TwinTokenBackingInvariant enforced; P3a/S7-2 tests pass |
| F4 | Fee + net = gross (value conservation) | ✅ | P10b test verifies per-transaction |
| F5 | Failed payments produce zero ledger entries | ✅ | P4a/P8a tests verify |
| F6 | No wallet has negative balance | ✅ | S7-6 test verifies; atomic conditional updateMany prevents |
| F7 | Every twin.minted has corresponding twin.backed | ✅ | P5a/S7-4 tests verify |
| F8 | Decimal-only monetary values | ✅ | All 41 columns migrated to Decimal(18,2); $extends auto-converts + 76 edge cases fixed; 25/25 payment tests + 14/14 replay tests pass |
| F9 | Bank reconciliation exact (ledger = DB = wallets) | ⬜ | Needs shadow ledger comparison |
| F10 | Complete audit trail (API → event → ledger → settlement → payment) | ✅ | CorrelationId propagated; audit log on every operation |

## Runtime Invariants

| # | Invariant | Status | Evidence |
|---|-----------|--------|----------|
| R1 | Zero runtime bypasses (all mutations through dispatcher) | ✅ | Stage 1 complete; 10/10 financial routes verified |
| R2 | Event replay deterministic (same events → same state) | ✅ | 14/14 replay tests pass; 2,596 events readable from DB, sequential, consistent |
| R3 | Crash-safe commits (durable before API returns) | ✅ | PostgresEventStore writes to DB before API returns; R3-1/R3-2 tests pass |
| R4 | Idempotent execution (duplicate command → one result) | ✅ | S4-1/S4-2/S4-3 tests pass (100 concurrent → unique) |
| R5 | Projection rebuild identical (delete → replay → same state) | ✅ | R5-1 through R5-6 tests pass; balance sheet derivable from events |
| R6 | No direct financial database mutations | ✅ | Stage 1 scan: 0 bypasses in financial routes |
| R7 | Constitution enforced on every state change | ✅ | InvariantEngine.verify() called on every dispatch |
| R8 | OCC prevents concurrent stream corruption | ✅ | S5-1 test: 500 concurrent → no corruption |

## Security Invariants

| # | Invariant | Status | Evidence |
|---|-----------|--------|----------|
| S1 | Authentication required on all protected routes | ✅ | Middleware + requireSession on all routes |
| S2 | Authorization enforced (RBAC per role) | ✅ | Route guards in middleware + auth-guards.ts |
| S3 | No insecure secret fallbacks | ✅ | H-3: NEXTAUTH_SECRET warns if not set |
| S4 | Input validation on financial endpoints | ✅ | H-4: Zod schemas on payments/payouts/refunds |
| S5 | Rate limiting on auth endpoints | ✅ | H-5: 10 attempts/15min/IP |
| S6 | No SQL injection (parameterized queries only) | ✅ | Prisma ORM used throughout; no raw SQL in app code |
| S7 | Sensitive fields redacted in logs | ✅ | Logger redacts passwords, tokens, card numbers |
| S8 | Penetration test passed | ⬜ | Requires independent security firm |

## Operational Invariants

| # | Invariant | Status | Evidence |
|---|-----------|--------|----------|
| O1 | Correlation ID on every financial operation | ✅ | S9-1 test verifies |
| O2 | Execution trace with per-stage timing | ✅ | S9-2/S9-3 tests verify |
| O3 | Circuit breakers on external calls | ✅ | CircuitBreaker for 10 external services |
| O4 | Proof of reserves generatable on demand | ✅ | /api/regulatory/proof-of-reserves |
| O5 | Regulator exports available | ✅ | /api/regulatory/export (AML, travel rule, audit) |
| O6 | Reconciliation process exists | ✅ | scripts/reconcile.ts (10 checks) |
| O7 | Disaster recovery tested | ⬜ | Needs backup/restore drill |
| O8 | Multi-region failover verified | ⬜ | Design documented, not implemented |
| O9 | Monitoring operational (alerts, dashboards) | ✅ | 6 flagship dashboards + planner telemetry |
| O10 | Runbooks exercised in drills | ⬜ | Runbooks exist but not drilled |

## Summary

| Category | Proven | Total | Percentage |
|----------|--------|-------|------------|
| Financial | 9 | 10 | 90% |
| Runtime | 8 | 8 | 100% |
| Security | 7 | 8 | 87.5% |
| Operational | 6 | 10 | 60% |
| **Overall** | **30** | **36** | **83.3%** |

## Critical Blockers (must fix before production)

1. **F9: Bank reconciliation** — needs shadow ledger
2. **S8: Penetration test** — needs external firm
3. **O7: Disaster recovery** — needs backup/restore drill
4. **O8: Multi-region failover** — design documented, not implemented
5. **O10: Runbook drills** — runbooks exist but not exercised
