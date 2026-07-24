# PaySwap Protocol v1 — Architecture Design Document (Phase 1)

> **Status**: Phase 1 — Architecture only. No implementation code.
> **Runtime**: v1.0.0-stable (frozen — no new architectural layers).
> **Goal**: Replace placeholder financial logic with the real PaySwap protocol.
> Every feature must execute through the existing `kernel.converge(intent)` pipeline.

---

## Table of Contents

1. [Design Constraints](#1-design-constraints)
2. [Protocol Economics Model](#2-protocol-economics-model)
3. [Smart Contract Interfaces](#3-smart-contract-interfaces)
4. [Extension Platform Architecture](#4-extension-platform-architecture)
5. [Mapping 20 Success Criteria to converge(intent)](#5-mapping-20-success-criteria-to-convergeintent)
6. [Design Challenges & Weaknesses](#6-design-challenges--weaknesses)
7. [Proposed Improvements](#7-proposed-improvements)
8. [Folder Structure](#8-folder-structure)
9. [Implementation Plan (Phase 2)](#9-implementation-plan-phase-2)

---

## 1. Design Constraints

The runtime is frozen. The protocol replacement must work within these constraints:

### What we have (immutable)
- `kernel.converge(intent)` — the single entry point
- Entity-Component model (entities have capabilities, policies, state)
- Generic Constraint Solver (queries capabilities, never hardcodes finance)
- Execution Graph DAG (Transitions with preconditions/postconditions/rollback)
- Event-sourced world (events = truth, snapshots = cache)
- State Machine Engine (9 object kinds with lifecycles)
- Constitution (43 immutable invariants, 12 sections)
- Organization Policy (configurable business rules)
- 5 Runtime Services (World, Constraint, Solver, Execution, Developer)

### What we must NOT do
- Add new runtime services or engines
- Redesign the kernel architecture
- Create special-case code for payments, loans, insurance, etc.
- Bypass `converge(intent)` for any financial operation

### What we MUST do
- Replace placeholder financial logic with real protocol semantics
- Model fiat as external state (never assume availability)
- Collateralize every manual operation
- Make LP authorization dynamic (derived from protocol state)
- Implement disputes via escrow (no insurance pool)

---

## 2. Protocol Economics Model

### 2.1 On-Chain vs Off-Chain Separation

The protocol has deterministic control over **on-chain assets only**:

| On-Chain (protocol controls) | Off-Chain (external, observable only) |
|---|---|
| Twin Tokens | LP fiat accounts |
| Liquidity Pools | Platform reserve bank accounts |
| Settlement Escrow | Financial Operator accounts |
| LP Collateral Vault | Mobile Money wallets |
| Governance | PSP wallets |
| Treasury contracts | Bank accounts |

**Principle**: Fiat is modeled as an external resource. The protocol observes it through FO attestations or LP proofs. It never assumes fiat balances are correct or accounts remain connected.

### 2.2 Replace Liquidity Pool with Three Independent Concepts

The current Liquidity Pool incorrectly mixes multiple responsibilities. Replace with:

#### 2.2.1 Liquidity Pool (on-chain)
- Contains LP Twin Tokens **only**
- Purpose: provide liquidity, mint/burn Twin Tokens, LP staking/withdrawals
- **Never** used directly to compensate users
- Entity type: `liquidity_pool` with capabilities: `canMint, canBurn, canStake`

#### 2.2.2 Settlement Escrow (on-chain)
- Every transaction reserves Twin Tokens in escrow
- Example: 25,000 GHS payment → freeze 25,000 TwinGHS
- Tokens remain frozen until: merchant confirms, timeout, dispute resolution, or cancellation
- **New state machine**: `Created → Frozen → Releasing → Released | Disputed → Slashed | Refunded`

#### 2.2.3 LP Collateral Vault (on-chain)
- Separate from liquidity (never used as routing liquidity)
- Secures manual settlement obligations
- Slashed **only** after protocol adjudication
- Entity type: `collateral_vault` with capabilities: `canLock, canSlash, canRelease`

### 2.3 Dispute Resolution (replaces insurance)

**There is no insurance pool.** The frozen Twin Tokens in Settlement Escrow ARE the guarantee.

#### Dispute flow
```
Dispute opened
    ↓
Escrow remains frozen
    ↓
Evidence collection (LP proof + merchant proof)
    ↓
Adjudication (community vote + PaySwap vote, weighted by merchant trust tier)
    ↓
Outcome:
  LP wins  → unlock escrow → return Twin Tokens to LP
  Merchant wins → merchant chooses:
    Option A: withdraw frozen Twin Tokens
    Option B: request replacement LP to complete settlement
      → new LP settles → merchant confirms
      → frozen Twin Tokens transfer to new LP
      → old LP loses access + reputation slash
```

#### Dispute state machine
```
Opened → EvidenceCollection → Voting → Adjudicated
  → (LPWins → EscrowReturned)
  → (MerchantWins → MerchantWithdraws | ReplacementRequested → ReplacementSettled)
  → (CollateralSlash → LP penalized)
```

### 2.4 Fraud Classification

| Fraud type | Consequence |
|---|---|
| Settlement timeout | Small reputation penalty |
| Unable to prove payment | Escrow remains frozen; merchant may withdraw Twin Tokens |
| Forged evidence | Collateral slash + reputation slash + temporary suspension |
| Repeated fraud | LP removed + routes closed + staking locked |

Every fraud outcome updates: reputation, exposure, routing score, authorization limit.

### 2.5 Merchant Trust Tiers

Merchants are protocol actors with trust tiers:

| Tier | Bond | Routing priority | Dispute weight | Claim speed |
|---|---|---|---|---|
| Unverified | 0 | lowest | minimal | slow |
| Verified | small | medium | standard | normal |
| Trusted | medium | high | elevated | fast |
| Premium | large | highest | maximum | instant |

Merchants can be penalized for fraudulent claims (bond slashed).

### 2.6 LP Authorized Exposure (dynamic)

Replace `authorized = stake × multiplier` with **Authorized Exposure** computed continuously:

```
AuthorizedExposure = f(
  collateral,
  liquidity,
  completed_settlements,
  active_disputes,
  fraud_history,
  country_risk,
  reserve_utilization,
  outstanding_obligations,
  manual_settlement_ratio,
  protocol_reputation
)
```

The solver **never** allocates more than Authorized Exposure.

### 2.7 LP Reputation (continuously updated)

Derived from: success rate, latency, proof quality, dispute outcomes, settlement consistency, uptime, liquidity availability.

### 2.8 Expected Cost routing (replaces fee-based)

The solver optimizes **Expected Cost**, not fee:

```
ExpectedCost = fee
  + (expected_delay × capital_cost)
  + (failure_probability × failure_cost)
  + (manual_settlement_risk × manual_cost)
  + (fx_risk × fx_volatility)
  + (reputation_risk × reputation_penalty)
  + (reserve_depletion × depletion_cost)
  + (collateral_efficiency × opportunity_cost)
```

### 2.9 Hybrid Routing Candidates

The solver compares **all** candidate route types:
1. Reserve only
2. LP only
3. Reserve + LP
4. Multiple LPs
5. Stablecoin bridge
6. Deferred settlement
7. Net settlement
8. Auction settlement

### 2.10 Liquidity Auctions

Instead of static LP selection, LPs answer liquidity requests:
```
Need: 25,000 GHS, deadline: 20s
LP1: 5,000 @ 0.4%
LP2: 12,000 @ 0.6%
LP3: 8,000 @ 0.7%
→ Solver builds optimal execution graph from auction responses
```

### 2.11 Net Settlement (corridor netting)

Instead of settling every payment individually, maintain corridor obligations:
```
Kenya → Ghana: +1.2M
Ghana → Kenya: -1.15M
→ Only 50k needs settlement
```
The solver minimizes gross liquidity movement.

### 2.12 Merchant LP Mode

Merchants can opt into becoming LPs. Settlement proceeds can:
- Enter reserves
- Purchase Twin Tokens
- Increase LP position
- Increase collateral

According to merchant preferences.

### 2.13 Treasury (not free liquidity)

When protocol reserves are insufficient, Treasury should:
- Borrow LP liquidity
- Purchase withdrawal positions
- Rebalance reserves
- Use stablecoins **only** when economically justified

Treasury is never treated as free liquidity.

---

## 3. Smart Contract Interfaces

Refactor contracts into 8 verifiable settlement primitives. The runtime **never** manipulates blockchain state directly — it generates commands; smart contracts execute them.

### 3.1 Contract Manifest

```typescript
interface SmartContract {
  contractId: string;
  type: ContractType;
  address: string;  // on-chain address (simulated in Digital Twin)
  commands: string[];  // commands this contract accepts
  verify: (transition: Transition) => boolean;  // verifiable proof
}

type ContractType =
  | 'TwinToken'
  | 'LiquidityPool'
  | 'SettlementEscrow'
  | 'CollateralVault'
  | 'Governance'
  | 'Treasury'
  | 'LPRegistry'
  | 'MerchantRegistry';
```

### 3.2 Contract Responsibilities

| Contract | Owns | Commands |
|---|---|---|
| TwinToken | mint, burn, transfer, lock, unlock | MintAsset, BurnAsset, TransferLiquidity |
| LiquidityPool | LP staking, pool accounting | StakeLP, UnstakeLP |
| SettlementEscrow | frozen tokens, release, slash | FreezeEscrow, ReleaseEscrow, SlashEscrow |
| CollateralVault | collateral lock, slash, release | LockCollateral, SlashCollateral, ReleaseCollateral |
| Governance | proposals, voting, execution | CreateProposal, Vote, ExecuteProposal |
| Treasury | vault balances, rebalance | Rebalance, Borrow, Purchase |
| LPRegistry | LP registration, authorization, reputation | RegisterLP, UpdateExposure, UpdateReputation |
| MerchantRegistry | merchant tiers, bonds, penalties | RegisterMerchant, UpdateTier, SlashBond |

### 3.3 Settlement Proof Registry

Every settlement produces a cryptographic attation recorded on-chain. The runtime generates the command; the contract records the proof. This enables:
- Independent verification
- Audit trail
- Dispute evidence
- Replay correctness

---

## 4. Extension Platform Architecture

Extensions are the mechanism for adding financial capabilities (lottery, lending, trade finance, etc.) without touching the kernel.

### 4.1 Extension Manifest

```typescript
interface ExtensionManifest {
  // Identity
  id: string;              // e.g. "payswap.lottery"
  name: string;
  version: string;
  author: string;
  description: string;

  // Capabilities this extension registers
  capabilities: CapabilityDeclaration[];

  // Commands this extension handles
  commands: CommandDeclaration[];

  // Entities this extension creates
  entities: EntityDeclaration[];

  // Policies this extension enforces
  policies: PolicyDeclaration[];

  // Event subscriptions
  events: EventSubscription[];

  // Smart contracts this extension deploys
  contracts: ContractDeclaration[];

  // State machines this extension defines
  stateMachines: StateMachineDeclaration[];

  // Permissions required
  permissions: Permission[];

  // Resource limits
  limits: {
    maxEntities: number;
    maxCommandsPerSecond: number;
    maxStorageBytes: number;
  };
}
```

### 4.2 Extension Lifecycle

```
Submitted → Reviewed → Approved → Installed → Enabled → Running
  ↓                                                ↓
Rejected                                      Disabled
                                                   ↓
                                               Suspended
                                                   ↓
                                               Removed
```

State machine transitions are governed by the State Machine Engine (no special-case code).

### 4.3 Extension Security Model

**Principle**: Extensions NEVER manipulate balances directly. They submit Intents; the kernel converges.

| Layer | Mechanism |
|---|---|
| Capability-based | Extensions can only exercise declared capabilities |
| Permission-scoped | Each command requires a specific permission |
| Resource-limited | Max entities, commands/sec, storage enforced |
| Sandboxed | Extensions run in isolated context; cannot access other extensions' state |
| Auditable | Every extension action is logged in the audit trail |
| Constitution-bound | Extensions cannot override Constitution invariants |

### 4.4 Extension SDK

```typescript
// The SDK extensions use to interact with the kernel
interface ExtensionSDK {
  // Submit an intent for convergence
  converge(intent: ConvergenceIntent): Promise<SolverOutput>;

  // Register entities
  registerEntity(entity: Entity): void;

  // Subscribe to events
  on(eventType: string, handler: (event: WorldEvent) => void): void;

  // Emit events
  emit(event: { type: string; payload: Record<string, unknown> }): void;

  // Query the world
  query(filter: (e: Entity) => boolean): Entity[];

  // Read-only access to capabilities registry
  capabilities: CapabilityRegistry;
}
```

### 4.5 Event Contracts

Extensions subscribe to a typed event stream. Every event has a contract:

```typescript
interface EventContract {
  type: string;
  schema: Record<string, SchemaField>;  // JSON schema for payload
  version: string;
  description: string;
  producer: string;  // which extension/engine emits this
  consumers: string[];  // which extensions subscribe
}
```

### 4.6 Extension Communication

Extensions communicate **only** through:
1. Events (pub/sub via the event store)
2. Intents (submitted to the solver)
3. Shared world state (read-only queries)

Extensions **never** call each other directly. This prevents tight coupling and enables independent deployment.

---

## 5. Mapping 20 Success Criteria to converge(intent)

Every workflow must execute through `converge(intent)` with no special-case code.

| # | Workflow | Intent Type | Key Transitions |
|---|---|---|---|
| 1 | Domestic payment | `TransferLiquidity` | debit buyer → credit reserve → credit merchant |
| 2 | Cross-border (reserves both) | `TransferLiquidity` | debit buyer → reserve A → escrow freeze → reserve B → credit merchant → escrow release |
| 3 | Cross-border (source reserve only) | `TransferLiquidity` | debit buyer → reserve A → LP bridge → escrow → credit merchant |
| 4 | Cross-border (dest reserve only) | `TransferLiquidity` | debit buyer → LP bridge → reserve B → credit merchant |
| 5 | LP-only | `TransferLiquidity` | debit buyer → LP auction → escrow → credit merchant |
| 6 | Reserve depletion + LP fallback | `TransferLiquidity` | reserve draw → insufficient → LP fallback (amendment) |
| 7 | Liquidity auction (multiple LPs) | `TransferLiquidity` | auction request → LP bids → solver builds graph |
| 8 | Manual settlement | `TransferLiquidity` | LP draw → WAITING_FOR_LP_SETTLEMENT → LP proof → merchant confirm |
| 9 | Merchant dispute | `CreateClaim` | escrow freeze → evidence → voting → merchant wins → withdraw |
| 10 | LP dispute | `CreateClaim` | escrow freeze → evidence → voting → LP wins → escrow return |
| 11 | Merchant withdraws frozen tokens | `TransferLiquidity` | dispute won → escrow release to merchant |
| 12 | Replacement LP settlement | `TransferLiquidity` | dispute won → merchant requests replacement → new LP settles → escrow transfers |
| 13 | LP collateral slashing | `SlashCollateral` | fraud proven → collateral vault slash → reputation slash |
| 14 | Merchant becomes LP | `StakeLP` | merchant opts in → stakes Twin Tokens → becomes LP entity |
| 15 | LP withdrawal | `UnstakeLP` | LP requests → drain → withdraw → exit |
| 16 | Treasury rebalance | `Rebalance` | reserve low → treasury borrows → rebalances |
| 17 | Net settlement | `NetSettle` | corridor obligations netted → only delta settles |
| 18 | Stablecoin-assisted | `ConvertStablecoin` | reserve unavailable → stablecoin bridge → settle |
| 19 | Mass LP exit stress | `UnstakeLP` (batch) | multiple LPs exit → solver reroutes → constitution verified |
| 20 | Complete replay | (replay) | time machine rewinds all transitions |

### Key insight: all 20 are the same problem

Every workflow is "given current world state and desired deltas, find the best sequence of valid transitions." The solver queries capabilities, the constitution validates, the executor applies transitions, the event store records truth. No special-case code needed — just different intent payloads.

---

## 6. Design Challenges & Weaknesses

### Challenge 1: Fiat observability gap
**Problem**: The protocol models fiat as external, but the solver needs to know LP fiat capacity to route. If fiat disappears, the solver may produce infeasible plans.

**Mitigation**: FO attestations and LP proofs are first-class entities. The solver queries `canBridge` entities with a `fiatAttested` flag. If an attestation expires (TTL), the entity's capability is temporarily revoked. The constitution invariant "fiat availability" checks attestations.

**Weakness**: Attestation TTL introduces a race condition. An LP may attest fiat, the solver builds a plan, but fiat disappears before execution completes.

**Improvement**: Add a "fiat confirmation" transition in the execution graph. The executor pauses at this transition until the FO confirms fiat availability. If confirmation times out, the compensation transition fires (rollback + reroute).

### Challenge 2: Escrow as insurance substitute
**Problem**: Replacing insurance with escrow works for individual transactions, but what about systemic failures (mass LP exit, country outage)?

**Mitigation**: Escrow handles per-transaction guarantees. Systemic failures are handled by the treasury (borrowing LP liquidity) and the constitution (circuit breakers that halt new transactions when reserve health drops below threshold).

**Weakness**: If treasury is also depleted, there's no backstop.

**Improvement**: Add a "protocol circuit breaker" as a constitution invariant. When aggregate exposure exceeds treasury capacity, new transactions are halted. This is a block-level invariant, not a policy.

### Challenge 3: Auction latency vs settlement speed
**Problem**: Liquidity auctions add latency (LPs need time to bid). Fastest routing preference conflicts with auctions.

**Mitigation**: Auctions are one candidate type among 8. The solver compares auction vs static. For "fastest" preference, static routing wins; for "cheapest," auctions may win.

**Weakness**: Auction deadline (20s) may be too slow for real-time payments.

**Improvement**: Support "instant" auctions with pre-authorized LPs (LPs pre-commit to providing liquidity at a declared rate). The solver treats pre-authorized LPs as static candidates but still runs the auction in parallel for potential improvement.

### Challenge 4: Net settlement complexity
**Problem**: Net settlement requires maintaining corridor obligations over time — this is stateful and temporal, unlike the current stateless converge model.

**Mitigation**: Corridor obligations are entities (type `corridor_obligation`) with balances. The solver queries these entities and produces a `NetSettle` command that only moves the delta.

**Weakness**: Netting windows introduce a timing dependency. Obligations accrue between settlement windows.

**Improvement**: Make netting windows configurable via Organization Policy. The solver includes net settlement as a candidate only when a netting window is open.

### Challenge 5: Extension sandboxing
**Problem**: Extensions run in the same process (Next.js). True sandboxing requires separate processes or WASM.

**Mitigation**: Capability-based security prevents direct balance manipulation. Resource limits prevent abuse. Audit trail detects violations.

**Weakness**: A malicious extension could still cause memory leaks or infinite loops.

**Improvement**: For production, extensions should run in WASM modules or separate worker processes. For v1, capability-based security + resource limits + audit is sufficient. Document this as a known limitation.

### Challenge 6: Reputation gaming
**Problem**: LPs could game reputation by splitting transactions or creating shell merchants.

**Mitigation**: Reputation is derived from multiple independent signals (success rate, latency, proof quality, dispute outcomes). Splitting transactions doesn't improve per-transaction success rate. Shell merchants have low trust tiers (low dispute weight).

**Weakness**: Sybil attacks (creating many LP identities) could dilute reputation penalties.

**Improvement**: LP registration requires collateral (staked Twin Tokens). The collateral creates a sybil-resistance cost. Reputation slashing affects staked collateral, making sybil attacks expensive.

### Challenge 7: Expected Cost computation
**Problem**: Expected Cost requires probabilities (failure_probability, fx_risk) that are hard to estimate for new corridors.

**Mitigation**: Use historical data from the event store. For new corridors, default to conservative estimates that relax over time as data accumulates.

**Weakness**: Cold-start problem — new LPs have no history.

**Improvement**: New LPs start with a "probationary" reputation tier. Their authorized exposure is capped until they complete N successful settlements. The solver applies a "probationary penalty" to their expected cost.

---

## 7. Proposed Improvements

### Improvement 1: Protocol Circuit Breaker
Add a constitution invariant that halts new transactions when:
- Aggregate exposure > treasury capacity × 0.8
- Reserve health < critical threshold in any corridor
- LP mass exit rate > threshold

This prevents cascading failures and protects the protocol from systemic risk.

### Improvement 2: Fiat Attestation TTL
Model FO attestations as entities with a TTL. The solver only considers LPs with valid (non-expired) attestations. The executor verifies attestation at execution time (not just planning time).

### Improvement 3: Probationary LP Tier
New LPs start probationary with capped exposure. After N successful settlements, they graduate to full LP status. This prevents sybil attacks and builds trust gradually.

### Improvement 4: Pre-authorized Liquidity
LPs can pre-commit to providing liquidity at declared rates. The solver treats these as static candidates (instant) while running auctions in parallel (potentially cheaper).

### Improvement 5: Settlement Proof Chain
Every settlement produces a cryptographic proof recorded on-chain. This creates an immutable audit trail that can be independently verified — essential for dispute resolution and regulatory compliance.

### Improvement 6: Corridor Obligation Entities
Model net settlement obligations as first-class entities. The solver queries corridor balances and produces net settlement commands. This makes netting a natural part of the capability graph.

### Improvement 7: Merchant Bond Escrow
When merchants file disputes, their bond is escrowed. If the dispute is fraudulent, the bond is slashed. This prevents frivolous disputes and aligns merchant incentives.

---

## 8. Folder Structure

```
src/
├── kernel/                          # FROZEN — no changes to runtime architecture
│   ├── (existing 43 modules)        # World, Solver, Execution, Constitution, etc.
│   └── index.ts                     # Public API (kernel.converge, etc.)
│
├── protocol/                        # NEW — PaySwap protocol economics
│   ├── contracts/                   # Smart contract interfaces (8 contracts)
│   │   ├── twin-token.ts            # Mint, burn, transfer, lock, unlock
│   │   ├── liquidity-pool.ts        # LP staking, pool accounting
│   │   ├── settlement-escrow.ts     # Freeze, release, slash (state machine)
│   │   ├── collateral-vault.ts      # Lock, slash, release
│   │   ├── governance.ts            # Proposals, voting, execution
│   │   ├── treasury.ts              # Vault balances, rebalance, borrow
│   │   ├── lp-registry.ts           # LP registration, exposure, reputation
│   │   └── merchant-registry.ts     # Merchant tiers, bonds, penalties
│   │
│   ├── economics/                   # Protocol economic models
│   │   ├── authorized-exposure.ts   # Dynamic LP exposure calculation
│   │   ├── reputation.ts            # LP + merchant reputation scoring
│   │   ├── expected-cost.ts         # Expected cost routing model
│   │   ├── trust-tiers.ts           # Merchant trust tier system
│   │   └── fraud-classification.ts  # Fraud detection + penalties
│   │
│   ├── settlement/                  # Settlement mechanisms
│   │   ├── escrow.ts                # Escrow lifecycle
│   │   ├── disputes.ts              # Dispute resolution flow
│   │   ├── auctions.ts              # Liquidity auctions
│   │   ├── net-settlement.ts        # Corridor netting
│   │   └── manual-settlement.ts     # Manual settlement workflow
│   │
│   ├── routing/                     # Protocol-specific routing candidates
│   │   ├── hybrid-router.ts         # 8 candidate types
│   │   ├── auction-router.ts        # Auction-based candidate
│   │   ├── net-router.ts            # Net settlement candidate
│   │   └── deferred-router.ts       # Deferred settlement candidate
│   │
│   └── intents/                     # Protocol intent builders
│       ├── payment.ts               # TransferLiquidity intent
│       ├── dispute.ts               # CreateClaim intent
│       ├── lp-stake.ts              # StakeLP / UnstakeLP intents
│       ├── rebalance.ts             # Rebalance intent
│       └── net-settle.ts            # NetSettle intent
│
├── extensions/                      # NEW — Extension Platform
│   ├── platform/                    # Extension runtime
│   │   ├── registry.ts              # Extension registration
│   │   ├── lifecycle.ts             # Install/enable/disable/remove
│   │   ├── sandbox.ts               # Capability-based sandboxing
│   │   ├── sdk.ts                   # Extension SDK (converge, query, emit)
│   │   └── manifest.ts              # Manifest validation
│   │
│   ├── contracts/                   # Extension event contracts
│   │   └── event-contracts.ts       # Typed event schemas
│   │
│   └── built-in/                    # Built-in extensions (protocol as extension)
│       ├── payments/                # Payment extension
│       ├── lp-operations/           # LP staking/withdrawal extension
│       ├── disputes/                # Dispute resolution extension
│       ├── treasury/                # Treasury management extension
│       └── governance/              # Governance extension
│
├── app/                             # Next.js app (unchanged structure)
│   ├── page.tsx                     # Digital Twin UI
│   └── api/                         # API routes
│       ├── simulate/                # Kernel simulation
│       └── scenarios/               # Scenario library
│
└── components/                      # UI components
    ├── simulator/                   # Existing Digital Twin panels
    └── protocol/                    # NEW — Protocol-specific panels
        ├── escrow-panel.tsx
        ├── dispute-panel.tsx
        ├── reputation-panel.tsx
        └── auction-panel.tsx
```

### Key structural principle

The `kernel/` folder is **frozen** — zero changes. The `protocol/` folder implements the real PaySwap protocol as **data and capabilities** on top of the kernel. The `extensions/` folder provides the extension platform. Everything flows through `kernel.converge(intent)`.

---

## 9. Implementation Plan (Phase 2)

Phase 2 implements incrementally, verifying each subsystem before moving to the next.

### Step 1: Protocol entities + contracts (foundation)
- Add new entity types: `settlement_escrow`, `collateral_vault`, `liquidity_pool` (refactored)
- Add new capabilities: `canFreeze, canRelease, canSlash, canLock, canAuction, canNetSettle`
- Implement 8 smart contract interfaces as entity registries
- Verify: entities + contracts register correctly

### Step 2: Settlement escrow state machine
- Add escrow state machine: `Created → Frozen → Releasing → Released | Disputed → ...`
- Implement escrow freeze/release/slash as Transitions
- Verify: escrow lifecycle transitions correctly

### Step 3: Authorized exposure + reputation
- Implement dynamic LP exposure calculation (10-factor model)
- Implement LP reputation scoring
- Implement merchant trust tiers
- Verify: exposure/reputation updates on settlement events

### Step 4: Expected cost routing
- Implement Expected Cost model (8 components)
- Replace fee-based scoring with expected cost in the solver
- Verify: solver optimizes expected cost, not just fee

### Step 5: Hybrid routing (8 candidates)
- Implement all 8 candidate generators (reserve, LP, reserve+LP, multi-LP, stablecoin, deferred, net, auction)
- Verify: solver compares all candidates

### Step 6: Liquidity auctions
- Implement auction entity + state machine
- Implement auction candidate in solver
- Verify: auction selects optimal LP combination

### Step 7: Dispute resolution
- Implement dispute state machine
- Implement evidence collection + voting + adjudication
- Implement escrow release/slash/transfer outcomes
- Verify: all dispute paths work

### Step 8: Net settlement
- Implement corridor obligation entities
- Implement net settlement candidate
- Verify: corridor netting minimizes gross movement

### Step 9: Manual settlement + collateral
- Implement WAITING_FOR_LP_SETTLEMENT state
- Implement LP proof submission + merchant confirmation
- Implement collateral vault slash
- Verify: manual settlement lifecycle

### Step 10: Extension platform
- Implement manifest validation
- Implement extension lifecycle (install/enable/disable/remove)
- Implement Extension SDK
- Implement event contracts
- Verify: extensions can register capabilities + submit intents

### Step 11: 20 success criteria verification
- Implement all 20 workflows as converge(intent) calls
- Verify each via Agent Browser
- No special-case code — all flow through the same pipeline

### Step 12: Digital Twin expansion
- Add protocol-specific UI panels (escrow, disputes, auctions, reputation)
- Add stress test scenarios (mass LP exit, country outage, stablecoin depeg)
- Verify: every scenario executes identically to production

---

## Conclusion

This design replaces placeholder financial logic with the real PaySwap protocol while keeping the frozen v1.0 runtime. The key insight is that **every protocol feature is expressed as data (entities, capabilities, policies) + intents** — no new architectural layers.

The main risks are:
1. Fiat observability gaps (mitigated by attestation TTL + execution-time verification)
2. Escrow as insurance substitute (mitigated by circuit breakers + treasury backstop)
3. Extension sandboxing (mitigated by capability-based security; WASM for production)

The 20 success criteria validate that the architecture is genuinely general-purpose. If all 20 execute through `converge(intent)` with no special-case code, the architecture is proven.

**Next**: Phase 2 — implement incrementally starting with protocol entities + contracts.
