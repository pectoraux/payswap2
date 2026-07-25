# PaySwap PRODUCTION-3 — Architecture

> **Status**: Frozen kernel + 10 production protocol modules (3-A through 3-J).
> **Build**: Tasks 3-A → 3-J (Oct–Nov 2025). Supersedes PRODUCTION-2.
> **Kernel freeze**: `src/kernel/` is FROZEN. No file under `src/kernel/` may be
> modified by any future task without an explicit kernel-amendment ticket.

## 1. The 10 priorities → module map

| #  | Priority                                              | Module path                                              | Built in |
| -- | ----------------------------------------------------- | -------------------------------------------------------- | -------- |
| 1  | Chain abstraction (Stellar-first, multi-chain ready)  | `src/protocol/chains/`                                   | 3-A      |
| 2  | Double-entry ledger + reconciliation                  | `src/protocol/ledger/`                                   | 3-B      |
| 3  | Production-grade connectors (idempotent + retried)    | `src/protocol/connectors-v2/`                            | 3-C      |
| 4  | Real liquidity network (LPs, capacity, scoring, forecast) | `src/protocol/liquidity-network/`                    | 3-D      |
| 5  | Treasury operations (limits, backing, freezes, alerts) | `src/protocol/treasury-v2/`                             | 3-E      |
| 6  | Operational readiness (metrics, tracing, SLOs)        | `src/protocol/ops/`                                      | 3-F      |
| 7  | Security (secrets, JWT, RBAC, MFA, audit)             | `src/protocol/security/`                                 | 3-G      |
| 8  | Disaster recovery (breakers, DLQ, replay, recovery)   | `src/protocol/resilience/`                               | 3-H      |
| 9  | Benchmarks + 10k TPS validation                       | `src/protocol/benchmarks/` (existing) + `BENCHMARK-REPORT.md` | 3-I |
| 10 | Tests + documentation                                 | `tests/production3/`, `docs/production3/`               | 3-J      |

## 2. The frozen-kernel boundary

```
                ┌───────────────────────────────────────────────────────────────┐
                │  src/kernel/  (FROZEN — DO NOT MODIFY)                         │
                │                                                               │
                │  evidence.ts   event.ts   types.ts   support.ts               │
                │  simulation.ts ledger.ts  twin-token.ts  treasury.ts          │
                │  planner.ts    pricing.ts reserve.ts    compliance.ts         │
                │  audit.ts      metrics.ts  ... (40+ files)                    │
                └───────────────────────────────────────────────────────────────┘
                                       ▲   ▲   ▲   ▲
                                       │   │   │   │
                  ─────────────────────┴───┴───┴───┴────────────────────────────
                  READ-ONLY kernel imports (eventEngine, createEvidence, uid, round, nowTs)
                  ─────────────────────────────────────────────────────────────
                                       │   │   │   │
                ┌──────────────────────▼───▼───▼───▼───────────────────────────┐
                │  src/protocol/  (PRODUCTION-3 layer — NEW files only)         │
                │                                                               │
                │   chains/   ledger/   connectors-v2/   liquidity-network/    │
                │   treasury-v2/   ops/   security/   resilience/              │
                │                                                               │
                │   twin-token/   wallets/   payouts/   merchant/   settlement │
                │   (existing — kept 100% intact for backward compat)         │
                └───────────────────────────────────────────────────────────────┘
```

**Kernel imports allowed from protocol modules** (read-only):
- `eventEngine` from `@/kernel/event` — emit / subscribe to events
- `createEvidence`, `Evidence`, `EvidenceSource`, `VerificationLevel` from `@/kernel/evidence`
- `uid`, `round`, `nowTs` from `@/kernel/support`
- Type-only imports from `@/kernel/types` (e.g. `SimulationEvent`)

**Protocol modules MUST NOT**:
- mutate any kernel data structure
- import kernel-only APIs marked `@internal`
- re-export kernel symbols as their own

## 3. Protocol layer composition

```
                         ┌─────────────────────────┐
                         │  chains/  (3-A)         │  Stellar adapter + future EVM stubs
                         └────────────┬────────────┘
                                      │ on-chain ops produce Evidence
                         ┌────────────▼────────────┐
                         │  ledger/  (3-B)         │  Double-entry journal + reconciliation
                         └────────────┬────────────┘
                                      │ events → journal entries (deterministic)
                         ┌────────────▼────────────┐
                         │  connectors-v2/  (3-C)  │  Open Banking / M-Pesa / Eth RPC / FX / Stellar Horizon
                         └────────────┬────────────┘
                                      │ evidence-backed attestations
                  ┌───────────────────┴────────────────────┐
                  │                                        │
        ┌─────────▼─────────┐                  ┌───────────▼──────────┐
        │ liquidity-network │                  │  treasury-v2/  (3-E) │  limits, backing, freezes, alerts
        │   (3-D)            │                  └───────────┬──────────┘
        └─────────┬─────────┘                              │
                  │ quotes + routing                       │
        ┌─────────▼────────────────────────────────────────▼──────┐
        │  ops/  (3-F)   metrics + tracing + alerts + SLOs         │
        └─────────┬─────────────────────────────────────────┬──────┘
                  │                                         │
        ┌─────────▼─────────┐                   ┌───────────▼──────────┐
        │  security/  (3-G) │                   │ resilience/  (3-H)   │  breakers, DLQ, replay
        │ secrets/JWT/RBAC  │                   └───────────┬──────────┘
        └───────────────────┘                               │
                                                            │
                                       ┌────────────────────▼────────────────────┐
                                       │   /api/protocol/* Next.js route handlers │
                                       └─────────────────────────────────────────┘
```

Each module exposes a singleton + a class for fresh instances (e.g.
`treasuryEngine` + `TreasuryEngine`). Tests should prefer fresh instances via
the `reset()` method on each singleton to avoid cross-test contamination.

## 4. The event-sourced truth model

Every state-mutating operation in PaySwap flows through the kernel's
`eventEngine.emit(type, payload, frame)`:

```
user intent → command → transition → event(s) emitted → projections updated
                                                │
                                                ▼
                                  ledger journal entry(ies)
                                  twin-token balance changes
                                  wallet balance changes
                                  merchant state changes
                                  audit log entries
```

**Why event-sourcing?** The entire ledger (and every other projection) can be
rebuilt from the event stream. `rebuildLedgerFromEvents(events)` (in
`src/protocol/ledger/projection.ts`) replays events in deterministic order
(sorted by `ts`, then `frame`, then `id`) and produces an identical ledger
every time. This is the foundation of disaster recovery (see `OPERATIONS.md`).

**Event types** emitted by protocol modules:

| Module          | Events                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `twin-token/`   | `twintoken.registered`, `twintoken.minted`, `twintoken.burned`, `twintoken.transferred`, `twintoken.escrowed`, `twintoken.released`, `twintoken.account_frozen`, `twintoken.account_unfrozen` |
| `wallets/`      | `wallet.created`, `wallet.credited`, `wallet.debited`, `wallet.locked`, `wallet.unlocked`              |
| `payouts/`      | `payout.requested`, `payout.processing`, `payout.completed`, `payout.failed`, `payout.cancelled`        |
| `merchant/`     | `merchant.onboarded`, `merchant.verified`, `merchant.api_key_created`                                   |
| `chains/`       | (none directly — Stellar adapter returns Evidence, not events)                                          |
| `ledger/`       | `ledger.posted` (on each `post`)                                                                        |
| `connectors-v2/`| `connector.audit` (per request)                                                                         |
| `liquidity-network/` | `liquidity.lp_registered`, `liquidity.route_executed`, `liquidity.route_settled`, `liquidity.lp_paused`, `liquidity.lp_resumed`, `liquidity.capacity_reserved`, `liquidity.capacity_released`, `liquidity.capacity_consumed`, `liquidity.capacity_replenished`, `liquidity.capacity_reservation_expired`, `liquidity.lp_health_updated`, `liquidity.lp_scored` |
| `treasury-v2/`  | `treasury.initialized`, `treasury.mint_recorded`, `treasury.mint_blocked`, `treasury.burn_recorded`, `treasury.burn_blocked`, `treasury.transfer_blocked`, `treasury.reserve_synced`, `treasury.reserve_low`, `treasury.backing_verified`, `treasury.backing_mismatch`, `treasury.backing_insufficient`, `treasury.alert`, `treasury.alert_resolved`, `treasury.freeze_triggered`, `treasury.freeze_lifted`, `treasury.asset_frozen`, `treasury.account_frozen`, `treasury.corridor_frozen` |
| `ops/`          | `ops.alert_fired`, `ops.alert_resolved`, `ops.metric_recorded`                                          |
| `security/`     | `security.audit`, `security.permission_denied`, `security.jwt_rotated`                                  |
| `resilience/`   | `resilience.circuit_open`, `resilience.circuit_half_open`, `resilience.circuit_closed`, `resilience.outage_declared`, `resilience.outage_resolved`, `resilience.dlq_entry`, `resilience.dlq_replayed`, `resilience.dlq_discarded`, `resilience.partial_settlement_detected`, `resilience.partial_settlement_recovered`, `resilience.partial_settlement_failed` |

## 5. How to add a new blockchain (adapter only)

The kernel never sees a concrete chain. Everything goes through the
`ChainAdapter` interface (`src/protocol/chains/adapter.ts`). To add a new
chain:

1. **Create the adapter file**: `src/protocol/chains/<chain>/adapter.ts`
2. **Implement `ChainAdapter`**: 28+ methods (`createAccount`, `fundAccount`,
   `registerAsset`, `issueAsset`, `burnAsset`, `createTrustline`, `transfer`,
   `pathPayment`, `createClaimableBalance`, `claimBalance`,
   `getClaimableBalances`, `createEscrowAccount`, `releaseEscrow`,
   `sponsorReserve`, `feeBumpTransaction`, `addSigner`, `removeSigner`,
   `setThresholds`, `verifyTransaction`, `getTransaction`, `getLatestLedger`,
   `streamLedgers`, `getLedgerEntry`, `getSequence`, `incrementSequence`,
   `getBalance`, `getBalances`, `healthCheck`).
3. **Every successful on-chain op MUST produce Evidence**: `source='on_chain_state'`,
   `verificationLevel='cryptographic'`, `reputation=1.0`, payload includes
   `txHash`, `ledger`, `operation`.
4. **Never throw** — return `{ success: false, error: '...' }` for failures so
   callers can pattern-match without try/catch.
5. **Register on module load**: in `src/protocol/chains/index.ts`, add
   `chainRegistry.register(<chain>ChainAdapter)` to the auto-registration block.
6. **Wire Stellar adapter as the default** — the registry's `default()` returns
   Stellar unless `setDefault()` is called.

**Reference implementation**: `src/protocol/chains/stellar/adapter.ts` (~1,270
lines) — production-grade in-process simulation of Stellar Horizon.

**Stub adapters** (compile cleanly, return structured errors):
`src/protocol/chains/{ethereum,base,polygon}/adapter.ts`. Each documents the
ERC-20 / EIP-1559 / L2-finality considerations in comments so a future
implementation is mechanical.

## 6. How to add a new connector (extend `ProductionConnector`)

Each connector in PaySwap extends `ProductionConnector` from
`src/protocol/connectors-v2/base.ts`. The base class wires together:
idempotency cache, token-bucket rate limiter, exponential-backoff retry,
hard timeout, health monitor, metrics collector, audit log, and signed
evidence (HMAC-SHA256). Subclasses implement three abstract methods:

```typescript
class MyConnector extends ProductionConnector {
  async doQuery(req: ConnectorRequest): Promise<{ result: Record<string, unknown>; error?: ConnectorError }> {
    // Real `fetch` call here. Return { result } on success or { result: {}, error }.
  }

  buildEvidence(req: ConnectorRequest, result: Record<string, unknown>): Evidence {
    return buildAttestationEvidence({ source: 'lp_attestation', verificationLevel: 'attested', ... });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    // GET /health on the upstream
  }
}
```

To register:
1. Add an `id` to the `ConnectorId` union in `connectors-v2/types.ts` (new file
   if you can't modify — or use an `extends` pattern).
2. Add a default `ConnectorConfig` and the `SIMULATED_SECRETS` entry in
   `connectors-v2/registry.ts` (or your own bootstrap function).
3. Add the connector to the `bootstrapProductionConnectors()` array.
4. The registry now resolves its API key + HMAC secret from the secrets vault
   and injects them at construction time.

**Reference implementations**: `open-banking.ts` (PSD2), `mpesa.ts` (Daraja),
`ethereum-rpc.ts` (Infura/Alchemy), `fx-rate.ts` (OpenExchangeRates),
`stellar-horizon.ts` (Horizon SSE).

## 7. Kernel-frozen invariants

These are properties the kernel guarantees and the protocol layer relies on:

1. **Event ordering is stable** — events sort by `(ts asc, frame asc, id asc)`.
2. **Evidence is immutable** — once issued, an `Evidence` object's fields are
   frozen. The protocol layer may attach signatures to `payload` but cannot
   rewrite history.
3. **The event stream is append-only** — `eventEngine.emit` never deletes or
   rewrites a prior event.
4. **The kernel never imports the protocol layer** — the dependency direction
   is one-way: `protocol → kernel`.

## 8. Test + docs layout

- `tests/production3/` — 10 test files, runnable with `bun run tests/production3/<file>.test.ts`.
  Each is a self-contained script using `node:assert/strict` and reporting a
  PASS/FAIL count. No test runner required.
- `docs/production3/` — this file + 5 companion docs:
  - `SETTLEMENT-NETWORK.md` — end-to-end money flow
  - `OPERATIONS.md` — operator runbook (metrics, SLOs, alerts, DR)
  - `SECURITY.md` — security model (auth, RBAC, scopes, MFA, secrets, HSM, audit, rate limits)
  - `API.md` — protocol module API reference
  - `BENCHMARKS.md` — interpretation of the benchmark report + 10k TPS attainment

## 9. Backward compatibility

PRODUCTION-3 is **additive**. The following pre-existing modules remain 100%
intact and continue to work via backward-compat shims:

- `src/protocol/blockchains/adapter.ts` — old `BlockchainAdapter` interface
  preserved; re-exports new types from `chains/`.
- `src/protocol/blockchains/stellar/adapter.ts` — legacy `StellarAdapter`
  wrapper that delegates every call to the new `stellarChainAdapter`.
- `src/protocol/connectors/` — old connector registry kept for any consumer
  that hasn't migrated to `connectors-v2/`.
- `src/protocol/treasury.ts` — old treasury module (superseded by
  `treasury-v2/` but not removed).
- `src/protocol/liquidity/marketplace.ts` — old LP selection (superseded by
  `liquidity-network/` but not removed).

No existing test, route handler, or UI component had to be modified for
PRODUCTION-3 to ship.

## 10. References

- `ARCHITECTURE.md` (root) — pre-PRODUCTION-3 architecture
- `PRODUCTION-ARCHITECTURE.md` (root) — twin-token engine + merchant platform
- `BENCHMARK-REPORT.md` (root) — 10k TPS benchmark report (Task 3-I)
- `worklog.md` — full chronological work log of every task (3-A through 3-J)
