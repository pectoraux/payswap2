# SCALE-1: Singleton Inventory — Cache vs Authority

> **Goal:** classify every module-level singleton as either a **cache**
> (rebuildable from events, safe to duplicate across instances) or an
> **authority** (holds state that must be globally unique). Only authorities
> need to move to Postgres for horizontal scale.

## Classification criteria

- **Cache**: the singleton's state can be rebuilt from the event store or
  the database. Duplicating it across instances is safe — they'll all
  converge to the same state. Examples: projections, read models, in-memory
  indexes.
- **Authority**: the singleton's state is the source of truth. If two
  instances have different state, they'll diverge. Examples: reserve
  balances, netting obligations, FX exposure positions, mandate state.
- **Timer**: a `setInterval` that must run on exactly one instance. If it
  runs on multiple instances, the work is duplicated (e.g., triple
  settlement).

## Inventory

### Authorities (must move to Postgres for SCALE-2)

| Singleton | File | State | Why it's an authority |
|---|---|---|---|
| `netSettlementEngine` | `protocol/settlement/net-settlement.ts` | `Map<corridorKey, CorridorObligation>` | Corridor balances are money owed. Two instances → divergent balances. |
| `backingVerifier` | `protocol/treasury-v2/backing.ts` | `Map<assetCode, BackingState>` (circulating supply) | The 1:1 backing invariant. Two instances → double-counting supply. |
| `reserveMonitor` | `protocol/treasury-v2/reserve-monitor.ts` | `Map<currency, ReserveAccount>` | Reserve balances are the source of truth. Two instances → divergent balances. |
| `reserveDriftMonitor` | `protocol/treasury-v2/reserve-drift-monitor.ts` | `Map<currency, DriftState>` (samples) | Drift samples are time-series state. Two instances → divergent drift calculations. |
| `fxExposureService` | `runtime/liquidity/fx-exposure-service.ts` | `Map<positionId, FxPosition>` + `Map<corridor, Limit>` | Open FX positions are money at risk. Two instances → double-counting exposure. |
| `lpMandateService` | `runtime/liquidity/lp-mandate-service.ts` | `Map<lpId:country:currency, Mandate>` | Mandate state (daily used, status). Two instances → double-counting daily limits. |
| `migrationProposalEngine` | `protocol/treasury-v2/migration-proposals.ts` | `Map<corridor, Composition[]>` + proposals | Proposals are pending actions. Two instances → duplicate proposals. |
| `corridorBalancer` | `protocol/treasury-v2/balancing.ts` | `Map<corridorKey, CorridorTarget>` | Configured corridor targets. Two instances → divergent rebalance decisions. |
| `emergencyFreezeEngine` | `protocol/treasury-v2/freezes.ts` | Freeze state | Frozen corridors must be globally consistent. |
| `closedLoopAuditLog` | `protocol/treasury-v2/closed-loop-controllers.ts` | `ClosedLoopAction[]` | Audit trail must be complete + ordered. |

### Caches (safe to duplicate — rebuildable from events)

| Singleton | File | State | Why it's a cache |
|---|---|---|---|
| `runtime` | `runtime/index.ts` | EventStore + projections | The EventStore IS the source of truth. Projections are rebuildable. But: the bare `runtime` singleton is now bypassed by `runtimeHost.execute()` in production. |
| `runtimeHost` | `runtime/index.ts` | Two isolated `Runtime` instances | Each `Runtime` is a cache of the event store. Safe to duplicate. |
| `eventEngine` | `kernel/event.ts` | In-memory event stream | The stream is rebuildable from the persisted EventStore. |
| `snapshotCache` | `runtime/dispatcher/snapshot-cache.ts` | `Map<streamId, snapshot>` | Snapshots are rebuildable from the event store. |
| `treasury` (old v1) | `protocol/treasury.ts` | In-memory positions | Legacy — superseded by treasury-v2. |
| `auctionEngine` | `protocol/settlement/auctions.ts` | `Map<auctionId, Auction>` | Auctions are event-sourced. Rebuildable. BUT: bids must be globally ordered (authority aspect). |
| All projections (`PaymentProjection`, `WalletProjection`, etc.) | `runtime/engines/*/projection.ts` | `Map<id, view>` | Projections are rebuildable from events. |
| All read-model services (`PaymentsService`, `WalletsService`, etc.) | `runtime/engines/*/service.ts` | In-memory caches | Caches of the event store. |

### Timers (must run on exactly one instance — SCALE-3)

| Timer | File | Interval | Why it must be singleton |
|---|---|---|---|
| `startNetSettlementCycle` | `closed-loop-controllers.ts` | 5 min | Three concurrent `settle()` calls = triple settlement. |
| Drift monitor scan | `instrumentation.ts` | 60 sec | Three instances → three alarm events per threshold crossing. |
| `checkpointManager` | `protocol/persistence/` | 60 sec | Three instances → three snapshots per cycle (wasteful, not incorrect). |
| `eventStore.flush` | `protocol/persistence/event-store.ts` | On demand + scheduled | Three instances → duplicate persistence attempts (idempotent, safe). |

## Summary

- **~10 authorities** need to move to Postgres for SCALE-2.
- **~20+ caches** are safe to duplicate (they're already rebuildable from events).
- **3 timers** need a leader-election mechanism for SCALE-3.

## Next steps (SCALE-2, SCALE-3)

1. **SCALE-2:** Move the 10 authorities to Postgres with optimistic locking.
   Reads may stay in-memory projections; writes go through the database.
   `rehydrateFromEvents()` already proves the pattern works for
   `netSettlementEngine`.

2. **SCALE-3:** Replace the 3 timers with a DB-backed job queue or advisory
   locks. The net settlement cycle must execute exactly once per interval.
   Options: pg-advisory-lock, a leader-elected worker, or a dedicated
   job queue (BullMQ, Temporal).
