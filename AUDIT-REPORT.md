# Phase 1 — Architecture Audit Report

## Executive Summary

The kernel contains **significant financial coupling**. While the 7 core primitives are conceptually generic, many kernel files contain PaySwap-specific vocabulary, types, and logic. The audit identified files that must be cleaned or moved to the protocol layer.

## Audit Methodology

Scanned all `src/kernel/*.ts` files for financial vocabulary: LP, merchant, reserve, escrow, payment, currency, settlement, fiat, twin token, treasury, collateral, auction, dispute, stablecoin, reputation.

## Findings by Severity

### CRITICAL — Files that are entirely PaySwap-specific (should be in protocol/)

| File | Financial Matches | Issue |
|------|-------------------|-------|
| `liquidity-planner.ts` | 248 | Entirely PaySwap-specific planner — superseded by `planner.ts` |
| `optimization-engine.ts` | 166 | Entirely PaySwap-specific optimizer — superseded by `planner.ts` |
| `lp-lifecycle.ts` | 75 | LP staking/slashing — PaySwap domain logic |
| `financial-graph.ts` | 53 | Financial graph with PaySwap entities — should be protocol |
| `treasury-ai.ts` | 22 | Treasury recommendations — PaySwap domain |
| `twin-token.ts` | 18 | Twin Token engine — PaySwap domain |
| `transaction.ts` | 8 | Transaction engine referencing payment/settlement — PaySwap domain |

**Action**: Delete `liquidity-planner.ts` and `optimization-engine.ts` (superseded). Move `lp-lifecycle.ts`, `financial-graph.ts`, `treasury-ai.ts`, `twin-token.ts`, `transaction.ts` to `protocol/`.

### HIGH — Files with PaySwap-specific types/logic mixed with generic kernel

| File | Matches | Issue |
|------|---------|-------|
| `simulation.ts` | 169 | References reserves, LPs, treasury, escrow — should be domain-agnostic |
| `types.ts` | 139 | Contains `Reserve`, `LiquidityProvider`, `TwinTokenRecord`, etc. |
| `plan-executor.ts` | 90 | References LP, escrow, treasury in execution logic |
| `api.ts` | 73 | Intent builders reference LP, merchant, reserve |
| `entity.ts` | 57 | `ENTITY_META` has PaySwap types (reserve, lp, merchant) |
| `constitution.ts` | 56 | Rules mention LP, escrow, treasury, reserve |
| `command.ts` | 70 | Commands like `StakeLP`, `FreezeEscrow` |
| `events.ts` | 42 | Event catalog mentions LP, escrow, settlement |
| `world-store.ts` | 31 | World state contains reserves, treasury, twin tokens |

**Action**: Move PaySwap-specific types to `protocol/types.ts`. Clean entity.ts ENTITY_META to only have generic entries. Move PaySwap-specific commands/events to protocol layer. Make constitution rules generic.

### MEDIUM — Files with minor coupling

| File | Matches | Issue |
|------|---------|-------|
| `planner.ts` | 51 | References reserves, LPs in comments and fallback logic |
| `confidence-engine.ts` | 43 | ReputationProjection references LP settlement events |
| `evidence.ts` | 39 | FiatProof references in comments |
| `reasoning-engine.ts` | 30 | References LP, reserve, treasury |
| `state-machine.ts` | 26 | LP/merchant state machines |

**Action**: Clean comments. Move LP/merchant state machines to protocol. Make ReputationProjection generic.

### CLEAN — Files with no financial coupling

| File | Status |
|------|--------|
| `entity.ts` (EntityType) | ✓ Fixed to `string` in v2.1 |
| `capabilities.ts` | ✓ Generic |
| `evidence.ts` (core) | ✓ Generic (comments mention PaySwap) |
| `proposal.ts` | ✓ Generic |
| `obligation.ts` | ✓ Moved to protocol |
| `resource-reservation.ts` | ✓ Generic |
| `confidence-service.ts` | ✓ Generic |
| `projection-engine.ts` | ✓ Generic |
| `event-sourced-world.ts` | ✓ Generic |
| `transition.ts` | ✓ Generic |
| `metrics.ts` | ✓ Generic |
| `support.ts` | ✓ Generic (CURRENCIES is PaySwap data) |

## Hidden Coupling Found

1. **`world-store.ts`** imports `Reserve`, `LiquidityProvider`, `TreasuryPosition`, `TwinTokenRecord` from types — the kernel's world state is PaySwap-shaped.

2. **`plan-executor.ts`** contains `if (entity.type === 'reserve')` and `if (entity.type === 'lp')` — hardcoded type checks instead of capability checks.

3. **`constitution.ts`** rules reference "LP capacity", "escrow conservation", "twin token backing" — domain invariants, not kernel invariants.

4. **`command.ts`** has `StakeLP`, `FreezeEscrow`, `RegisterLP`, `RegisterMerchant` — domain commands in kernel.

5. **`events.ts`** catalog has `lp.staked`, `lp.withdrawn`, `twin.minted`, `twin.burned` — domain events in kernel.

6. **`state-machine.ts`** defines LP, merchant, reserve state machines — domain lifecycles in kernel.

7. **`simulation.ts`** is deeply coupled to PaySwap — it references reserves, LPs, treasury, escrow, disputes, auctions directly.

## Recommended Actions (priority order)

1. **Delete dead files**: `liquidity-planner.ts`, `optimization-engine.ts` (superseded by `planner.ts`)
2. **Move domain files to protocol/**: `lp-lifecycle.ts`, `financial-graph.ts`, `treasury-ai.ts`, `twin-token.ts`, `transaction.ts`
3. **Split types**: Move `Reserve`, `LiquidityProvider`, `TwinTokenRecord`, `TreasuryPosition`, etc. to `protocol/types.ts`
4. **Clean world-store**: Make `WorldState` generic (entities + evidence + events, no reserves/LPs)
5. **Clean constitution**: Move domain invariants to protocol; keep only kernel invariants
6. **Move domain commands/events**: PaySwap-specific commands and events to protocol
7. **Move domain state machines**: LP, merchant, reserve state machines to protocol
8. **Clean plan-executor**: Replace `if (entity.type === 'reserve')` with capability checks

## Conclusion

The kernel has the right **primitives** but still carries PaySwap **baggage** in implementation files. The 7 primitives (Entity, Capability, Evidence, Proposal, Command, Transition, Event) are conceptually clean. The coupling is in the supporting files that haven't been fully migrated to the protocol layer.

The supply chain domain works because it uses the `ConvergencePlanner` directly, bypassing `simulation.ts` (which is PaySwap-coupled). A full cleanup would make `simulation.ts` domain-agnostic or move it to the protocol layer.
