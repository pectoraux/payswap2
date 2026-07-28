# Multi-Region Readiness Design (M-4)

> **Status**: Design document — not yet implemented
> **Priority**: Phase 3 (scalability)
> **Effort estimate**: 40+ hours

## Current Architecture (Single-Region)

```
                    ┌─────────────────┐
                    │   Vercel (Next)  │
                    │   Single region  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Neon PostgreSQL │
                    │  Single region   │
                    │  (eu-west-2)     │
                    └─────────────────┘
```

**Limitations**:
- All reads/writes go to a single database in one region
- No failover if the region goes down
- High latency for users in other regions
- Event store is not sharded — single write bottleneck

## Target Architecture (Multi-Region)

```
                    ┌─────────────────────────────────────────┐
                    │              Global Load Balancer         │
                    │         (Vercel Edge + DNS routing)      │
                    └──────┬──────────┬──────────┬─────────────┘
                           │          │          │
                    ┌──────▼──┐ ┌─────▼───┐ ┌───▼──────┐
                    │  US-E   │ │  EU-W   │ │  AF-S    │
                    │ Vercel  │ │ Vercel  │ │ Vercel   │
                    └────┬────┘ └────┬────┘ └────┬─────┘
                         │           │           │
                    ┌────▼────┐ ┌────▼────┐ ┌────▼─────┐
                    │ Neon US │ │ Neon EU │ │ Neon AF  │
                    │ (read + │ │ (read + │ │ (read +  │
                    │  write) │ │  write) │ │  write)  │
                    └─────────┘ └─────────┘ └──────────┘
                         │           │           │
                    ┌────▼───────────▼───────────▼────┐
                    │     Cross-Region Replication     │
                    │   (logical replication + CRDT)   │
                    └──────────────────────────────────┘
```

## Design Decisions

### 1. Event Store Sharding

**Strategy**: Shard by stream ID (hash-based partitioning)

```
streamId = "sandbox:payment:pay_abc123"
                    ↓
hash("sandbox:payment:pay_abc123") % N_SHARDS = shard_number
                    ↓
shard_number → region mapping
```

- Each stream lives entirely on one shard (no cross-shard transactions within a stream)
- The dispatcher reads the stream version from the correct shard
- Events are appended to the correct shard

**Shard count**: Start with 4 shards, scale to 16 as volume grows

### 2. Read Replicas

- Each region has a local read replica of the event store
- Reads (projections, queries) use the local replica
- Writes (appends) go to the primary shard
- Replication lag is tracked — if lag > 1s, fall back to primary

### 3. Cross-Region Replication

**Strategy**: PostgreSQL logical replication (Neon supports this)

- Each region's primary replicates to all other regions' read replicas
- Conflict resolution: last-writer-wins (LWW) with HLC timestamps (M-6 fix ensures monotonicity)
- Event store is append-only — no conflicts possible for event appends
- Projection tables may conflict — use CRDTs or LWW

### 4. API Gateway Routing

```
User in Ghana → Vercel Edge → routes to nearest region
  ↓
If read: local replica (low latency)
If write: primary shard for the stream (may be cross-region)
```

**Latency optimization**: For write-heavy workloads, co-locate the stream's primary shard with the user's region.

### 5. Disaster Recovery

- **RPO (Recovery Point Objective)**: < 1 second (synchronous replication for financial events)
- **RTO (Recovery Time Objective)**: < 30 seconds (automatic failover)
- **Backup**: Daily full backup + continuous WAL archiving
- **Restore testing**: Weekly automated restore test

## Implementation Phases

### Phase A: Read Replicas (1 week)
1. Add Neon read replica in a second region
2. Route read queries to the replica
3. Monitor replication lag
4. Fall back to primary if lag > threshold

### Phase B: Event Store Sharding (2 weeks)
1. Implement shard router (hash-based)
2. Migrate existing events to shards
3. Update dispatcher to read/write from the correct shard
4. Test with 4 shards

### Phase C: Multi-Region Write (2 weeks)
1. Deploy Vercel to multiple regions
2. Route writes to the nearest primary shard
3. Implement cross-region replication
4. Test failover

### Phase D: Disaster Recovery (1 week)
1. Automated backup verification
2. Failover testing
3. Runbooks for region failure

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Cross-shard transactions | Avoid by sharding on stream ID — all events for a stream are on one shard |
| Replication lag | Synchronous replication for financial events; fall back to primary for reads if lag > 1s |
| Split-brain | Use a quorum-based leader election for each shard |
| Data consistency | Event store is append-only (no conflicts); projections use LWW with HLC |
| Cost | Start with 2 regions, scale as volume grows |

## Current Readiness Assessment

| Capability | Status |
|-----------|--------|
| Single-region | ✅ Working (Neon PostgreSQL) |
| Read replicas | ❌ Not configured |
| Event store sharding | ❌ Not implemented |
| Multi-region deployment | ❌ Single Vercel deployment |
| Cross-region replication | ❌ Not configured |
| Disaster recovery | ❌ No automated failover |
| Backup testing | ❌ Not implemented |

**Estimated time to multi-region readiness**: 6-8 weeks
