# Architecture Reduction Report — v1.5 → v1.6

## Summary

| Metric | Before (v1.5) | After (v1.6) | Change |
|--------|---------------|--------------|--------|
| Kernel files | 48 | 49 | +1 (net: 3 added, 2 removed) |
| Protocol files | 15 | 13 | **-2** |
| Total lines | 11,726 | 11,407 | **-319** |
| Primitives | 9 | **8** | **-1** |

## Primitives: 9 → 8

### Removed: Claim + Commitment → merged into Proposal

**Before**: Evidence → Claim → Commitment → Obligation (4 steps, 2 primitives)
**After**: Evidence → Proposal → Obligation (3 steps, 1 primitive)

**Justification**: Claim and Commitment were always used together — an LP claims capacity, then commits to settling. They were two stages of the same lifecycle. Merging them into a single Proposal primitive (with states: offered → accepted → activated → completed) eliminates one concept, one file, one store, and one indirection — without losing any protocol expressiveness.

### Retained: Entity

**Justification**: The fundamental unit of the world. Everything is an entity.

### Retained: Capability

**Justification**: The user's caution was correct — the planner frequently asks "who canBridge?" / "who canSettle?" / "who canAttest?". Discoverable capabilities give the planner a simple, generic way to search the world model. Replacing them with plugin interfaces would make planning more coupled to implementation details. Capability stays.

### Retained: Evidence

**Justification**: Immutable historical truth. The foundation of all confidence. But now hidden behind the Confidence Service — the planner never queries evidence directly.

### Retained: Obligation

**Justification**: The convergence target. The world converges when no obligations remain. Settlement rights live on the obligation (currentFulfillerId, escrowId, deadline).

### Retained: Command

**Justification**: The trigger for transitions. 39 command types (FreezeEscrow, TransferSettlementRights, RegisterFiatProof, etc.).

### Retained: Transition

**Justification**: The atomic state change. Kept separate from Event because: Transition = planned action (with preconditions, postconditions, rollback), Event = completed action (immutable record). The planner produces Transitions; the executor applies them and emits Events. Merging them would conflate planning with history.

### Retained: Event

**Justification**: The source of truth. Snapshots are cache. Events are immutable. The world is rebuilt by folding events from genesis.

### New: Proposal (replaces Claim + Commitment)

**Justification**: Bilateral (SYN/SYN-ACK/ACK handshake). Contains who, what, conditions, required evidence, expiry. If accepted → activates → creates obligation. If rejected → event logged, proposal disappears. Transient — not long-lived state.

## Abstractions Removed

| Abstraction | Replaced By | Justification |
|-------------|-------------|---------------|
| `claims.ts` | `proposal.ts` | Claim was always followed by Commitment — one lifecycle, not two |
| `commitment.ts` | `proposal.ts` | Commitment was the activation step of a Claim — merged |
| `solver.ts` | `planner.ts` | Renamed for clarity (Convergence Planner, not Constraint Solver) |
| `exposure-allocation.ts` | `resource-reservation.ts` | Generic resource reservation replaces domain-specific exposure |
| `exposure-lease.ts` | `resource-reservation.ts` | Same — lease was a special case of reservation |
| `SolverCandidate` | `ConvergencePlan` | Each plan is a proof of convergence, not a "candidate" |
| `ClaimSummary` | `ProposalSummary` | Merged |
| `CommitmentSummary` | `ProposalSummary` | Merged |
| `ExposureAllocationSummary` | `ReservationSummary` | Generic |
| `LeaseSummary` | `ReservationSummary` | Generic |

## Abstractions Added

| Abstraction | Purpose | Justification |
|-------------|---------|---------------|
| `proposal.ts` | Merges Claim + Commitment | Fewer primitives, same expressiveness |
| `resource-reservation.ts` | Generic resource reservation | One abstraction for all scarce resources (exposure, capacity, escrow, nonce) |
| `confidence-service.ts` | Hides Evidence from Planner | Planner consumes confidence, not evidence sources — easier to replace sources |

## Abstractions Retained (with justification)

| Abstraction | Why it stays |
|-------------|--------------|
| Entity | Fundamental world object |
| Capability | Planner needs discoverable capabilities (user's caution was correct) |
| Evidence | Immutable historical truth |
| Proposal | Transient bilateral lifecycle (replaces Claim + Commitment) |
| Obligation | Convergence target — world converges when none remain |
| Command | Transition trigger |
| Transition | Planned action (separate from completed Event) |
| Event | Immutable record — source of truth |

## Protocol Expressiveness: No Loss

All 20 architecture-proof scenarios still execute through `kernel.converge(intent)`:
- 11/20 fully pass (9/9 invariants)
- 9/20 designed violations correctly caught by Constitution
- 50 fuzz iterations: 60% pass, 82% convergence

## Conclusion

The architecture shrunk by 1 primitive, 2 files, 319 lines — while gaining genericity (Resource Reservation replaces domain-specific Exposure Lease) and clarity (Confidence Service hides Evidence from Planner). No protocol expressiveness was lost.
