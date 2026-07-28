# PaySwap Architecture Reference v1

> **Status**: M-PLATFORM-39 (Capability SDK & Extension Runtime)
> **Last updated**: 2028-01
> **Purpose**: The definitive reference for the PaySwap architecture. Every major subsystem, its responsibilities, key files, and how it connects to the rest of the system.

---

## Table of Contents

1. [Overview](#1-overview)
2. [System Architecture](#2-system-architecture)
3. [Runtime Kernel](#3-runtime-kernel)
4. [Financial Kernel](#4-financial-kernel)
5. [Economic Kernel](#5-economic-kernel)
6. [Governance](#6-governance)
7. [Platform Layer](#7-platform-layer)
8. [Trust & Transparency](#8-trust--transparency)
9. [Capability SDK](#9-capability-sdk-m-platform-39)
10. [Data Layer](#10-data-layer)
11. [API Layer](#11-api-layer)
12. [UI Layer](#12-ui-layer)
13. [Security Model](#13-security-model)
14. [Deployment Architecture](#14-deployment-architecture)
15. [Glossary](#15-glossary)

---

## 1. Overview

PaySwap is a **Financial Operating System (FOS)** — an event-sourced platform for cross-border settlement that unifies payments, payouts, liquidity provision, treasury management, compliance, and governance behind a single runtime kernel.

### The Vision

Traditional fintech systems are built as monoliths or microservices with duplicated business logic across surfaces (web, mobile, API, webhooks). PaySwap inverts this: **the runtime is the product**. Every client — dashboard, admin console, developer API, mobile app, extension, AI agent — enters through the same `dispatch()` entry point. There is one source of truth, one set of invariants, one audit trail.

### Key Principles

1. **Runtime First** — The runtime (`src/runtime/`) is the single source of truth. Every mutation flows through `runtime.dispatcher.dispatch(command)`. Direct database writes are forbidden (enforced by ESLint rule `payswap-read-models/no-direct-prisma-write`).

2. **Event Sourcing** — All state changes are captured as immutable events in an event store. Current state is a projection of events. This enables replay, time travel, and audit.

3. **Invariant Protection** — The Constitution Engine enforces financial invariants (solvency, reserve coverage, twin token backing) on every state change. No transaction can violate an invariant.

4. **Frozen Kernel** — The runtime kernel is feature-complete and frozen. New capabilities are added via the Capability SDK (plugins), not by modifying the kernel.

5. **Multi-Role, Multi-Tenant** — One user can hold multiple roles (Merchant, LP, Customer, Developer, Treasury, Compliance, Support, Operations, Admin). Each role has its own shell, navigation, and permissions.

6. **Sandbox/Live Isolation** — Every subsystem runs in both sandbox and live environments with complete isolation (separate event stores, treasuries, ledgers, LPs, wallets).

### Scale

- **41 Prisma models** (User, Merchant, Customer, Payment, Payout, Wallet, LPProfile, Extension, etc.)
- **37 runtime subdirectories** (events, ledger, treasury, council, constitution, marketplace, control-plane, expansion, platform, trust, etc.)
- **9 role-based UI shells** (merchant, admin, developer, customer, LP, treasury, compliance, support, ops)
- **10+ protocol modules** (persistence, resilience, security, connectors, compliance, webhooks, etc.)
- **300+ API endpoints** across all role surfaces

---

## 2. System Architecture

### Layering

```
┌─────────────────────────────────────────────────────────────────────┐
│                        UI Layer (Next.js App Router)                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Merchant │ │  Admin   │ │Developer │ │ Customer │ │   LP     │ │
│  │ Dashboard│ │ Console  │ │ Console  │ │  Portal  │ │ Console  │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       │             │            │             │             │       │
│       └─────────────┴────────────┴─────────────┴─────────────┘       │
│                              │                                       │
├──────────────────────────────┼───────────────────────────────────────┤
│                        API Layer (Next.js Route Handlers)            │
│  /api/payments  /api/payouts  /api/developer  /api/sdk  /api/runtime │
│                              │                                       │
├──────────────────────────────┼───────────────────────────────────────┤
│                    Platform Layer (Unified Shell)                    │
│  RBAC · Environment Switching · Extensions · Developer Console      │
│                              │                                       │
├──────────────────────────────┼───────────────────────────────────────┤
│                     Capability SDK (M-PLATFORM-39)                   │
│  Plugin Loader · Capability Registry · Sandbox · Builtin Plugins    │
│                              │                                       │
├──────────────────────────────┼───────────────────────────────────────┤
│                    Runtime Kernel (FROZEN — src/runtime/)            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Dispatcher → Pipeline → Intent Engine → Policy Engine     │   │
│  │       ↓                                                     │   │
│  │  Event Store (append-only, OCC)                             │   │
│  │       ↓                                                     │   │
│  │  Projections (Payments, Refunds, Wallets, Treasury, ...)    │   │
│  │       ↓                                                     │   │
│  │  Invariant Engine (Constitution)                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
├──────────────────────────────┼───────────────────────────────────────┤
│              Protocol Layer (src/protocol/)                          │
│  Persistence · Resilience · Security · Connectors · Compliance      │
│                              │                                       │
├──────────────────────────────┼───────────────────────────────────────┤
│                      Data Layer (Prisma + SQLite/PG)                 │
│  41 models · Event Records · Projections · Snapshots · Checkpoints  │
└─────────────────────────────────────────────────────────────────────┘
```

### The Golden Rule

```
Every screen → API → Runtime → Dispatcher → Event Store → Projections
```

No screen reads from the database directly. No API mutates state without going through the dispatcher. No projection is rebuilt from anything but events. This guarantees:

- **Auditability**: Every state change has an event trail
- **Replayability**: Any point in time can be reconstructed
- **Consistency**: Invariants are always enforced
- **Extensibility**: New capabilities plug in via the SDK

---

## 3. Runtime Kernel

The runtime kernel (`src/runtime/`) is the event-sourced core. It is **frozen** — no new business logic is added here. New capabilities go through the Capability SDK (Section 9).

### 3.1 Event Store

**Files**: `src/runtime/events/`

The event store is an append-only log of domain events. Every state change produces one or more events.

```typescript
interface StoredEvent {
  eventId: string;
  type: string;           // e.g., "PaymentRecorded", "WalletCredited"
  payload: Record<string, unknown>;
  ts: number;             // timestamp
  frame: number;          // logical frame (for deterministic replay)
  seq: number;            // monotonically increasing sequence number
}
```

**Key properties**:
- **Optimistic Concurrency Control (OCC)**: Each append checks the expected version. Conflicts are rejected.
- **Deterministic**: Same events + same projections = same state. Enables replay.
- **Checkpoints**: `src/runtime/migration/` provides snapshot + incremental replay for fast recovery.

**Implementation**: `InMemoryEventStore` (dev) with a Prisma-backed `EventRecord` table for persistence.

### 3.2 Command Dispatcher

**Files**: `src/runtime/dispatcher/`

The dispatcher is the **only** way to mutate state. It validates commands, routes them to handlers, enforces invariants, and appends events.

```typescript
interface RuntimeDispatcher {
  dispatch(command: RuntimeCommand, ctx: RuntimeContext): Promise<DispatchResult>;
}

interface DispatchResult {
  ok: boolean;
  events: StoredEvent[];
  result?: unknown;
  error?: string;
  trace: DecisionTrace;
}
```

**Command Registry** (`src/runtime/dissector/` — `CommandRegistry`): Maps command types to handlers. Built-in handlers cover: `CreatePayment`, `CreateRefund`, `ExecuteRefund`, `ReserveLiquidity`, `ReleaseLiquidity`, `WalletCredit`, `WalletDebit`, `WalletReserve`, `WalletRelease`.

**Retry Policy**: `RetryPolicyOptions` with exponential backoff. `RetryOutcome` tracks success/failure.

### 3.3 Projections & Read Models

**Files**: `src/runtime/read-models/`, `src/runtime/migration/`

Projections transform events into queryable read models. The `ProjectionRunner` replays events through projections.

**Projections**:
- **Payments** (`src/runtime/engines/payments/`): Payment views with status, amount, currency, method, corridor
- **Refunds** (`src/runtime/engines/refunds/`): Refund views linked to payments
- **Wallets** (`src/runtime/engines/wallets/`): Wallet balances and transactions
- **Treasury** (`src/runtime/engines/treasury/`): Treasury accounts by country/currency
- **Twin Tokens** (`src/runtime/economic/`): Twin token mint/burn tracking
- **LP Runtime** (`src/runtime/economic/`): LP positions, bandwidth, reputation

**Migration Manager** (`src/runtime/migration/migration-manager.ts`): Centralized backfill ownership. On startup, `triggerAll()` imports existing database rows into projections. Each capability registers its backfill function. `MigrationRecord` tracks: capability, version, startedAt, completedAt, checkpoint, eventsImported, canonicalRows, verified, status.

**Projection Health**: `ProjectionHealthRegistry` tracks per-projection: eventsApplied, rows, lag, healthy, lastReplayMs, checkpoint, canonicalRows. Exposed via `/api/runtime/projections`.

### 3.4 Invariant Engine

**Files**: `src/runtime/invariants/`

The Constitution Engine enforces financial invariants. Every command is checked before execution.

```typescript
interface Invariant {
  section: string;         // e.g., "Solvency", "Reserve Coverage"
  name: string;
  check(state: RuntimeState): { passed: boolean; reason?: string };
}
```

**Built-in invariants** (`BUILTIN_INVARIANTS`): Solvency (assets ≥ liabilities), Reserve Coverage (every twin token is backed), Twin Token Backing (1:1 with reserves), LP Collateral (sufficient stake for bandwidth).

If any invariant fails, the command is rejected and the event is NOT appended. This guarantees the system can never enter an invalid state.

### 3.5 Runtime Host

**Files**: `src/runtime/host/`

The `RuntimeHost` manages sandbox and live runtime instances.

```typescript
class RuntimeHost {
  getRuntime(env: Environment): Runtime;
  getActiveEnvironment(): Environment;
  setActiveEnvironment(env: Environment): void;
}
```

Both environments share the same code but have separate event stores, treasuries, ledgers, and projections. The active environment is switched via `POST /api/runtime/host`.

### 3.6 Clock

**Files**: `src/runtime/clock/`

- `LiveClock`: Real wall-clock time (1× speed)
- `VirtualClock`: Deterministic time for simulations (can fast-forward)

Both implement `RuntimeClock`. The pipeline uses the clock for timestamps and frame numbers.

---

## 4. Financial Kernel

The financial kernel handles the mechanics of money movement: intent compilation, liquidity routing, transaction coordination, treasury, settlement, marketplace, and ledger.

### 4.1 Intent Compiler

**Files**: `src/runtime/compiler/`, `src/runtime/intent/`

The compiler transforms high-level intents (e.g., "send 100 GHS from Ghana to Nigeria") into execution plans.

```typescript
interface FinancialCompiler {
  compile(intent: MerchantIntent, ctx: CompilerContext): ExecutionPlan;
}
```

The `RealFinancialCompiler` uses the capability graph, route graph, and liquidity graph to find candidate strategies. The `NoOpFinancialCompiler` is a stub for testing.

### 4.2 Liquidity Policy Engine

**Files**: `src/runtime/policy/`

The policy engine evaluates execution plans against business rules before they're allowed to proceed.

```typescript
interface PolicyEngine {
  evaluate(plan: ExecutionPlan, ctx: RuntimeContext): PolicyResult;
}

interface PolicyResult {
  passed: boolean;
  findings: PolicyFinding[];   // block | warn | info
}
```

`DefaultPolicyEngine` enforces: max transaction limits, corridor restrictions, LP tier requirements, risk thresholds.

### 4.3 Transaction Coordinator

**Files**: `src/runtime/transaction/`

Coordinates multi-step transactions (reserve → settle → release) with rollback on failure.

```typescript
class TransactionCoordinator {
  async execute(plan: ExecutionPlan): Promise<CoordinationResult>;
  async rollback(txId: string): Promise<void>;
}
```

Implements the saga pattern: each step has a compensating action. If any step fails, all prior steps are rolled back.

### 4.4 Treasury

**Files**: `src/runtime/ledger/` (ledger), `src/protocol/treasury-v2/` (reserve management)

The treasury manages fiat and stablecoin reserves by country/currency.

```typescript
interface TreasuryService {
  getBalanceSheet(): BalanceSheet;
  getReserves(country: string): ReserveBreakdown;
  adjustReserve(country: string, amount: number, reason: string): Promise<void>;
}
```

**Reserve Maturity Progression**: Countries evolve from `stablecoin_only` → `hybrid` → `mostly_fiat` → `fully_fiat` as fiat reserves grow. The control plane tracks and recommends maturity upgrades.

**Balance Sheet**:
```
Assets:                    Liabilities:
  Fiat Reserves (by ccy)     Twin Tokens Outstanding
  Stablecoin Reserves        Wallet Balances
  LP Collateral              Pending Settlements
  Settlement Receivables     Escrow
```

### 4.5 Settlement Orchestrator

**Files**: `src/runtime/settlement-orchestrator/`, `src/runtime/settlement/`

Manages the lifecycle of settlement contracts: creation → escrow lock → LP assignment → confirmation → ledger update → completion.

```typescript
interface SettlementContract {
  id: string;
  status: 'pending' | 'escrowed' | 'assigned' | 'confirmed' | 'completed' | 'rolled_back';
  sender: Actor;
  recipient: Actor;
  amount: number;
  currency: string;
  lpId?: string;
  escrow: EscrowState;
  stages: SettlementStage[];
}
```

### 4.6 Marketplace

**Files**: `src/runtime/economic/` (EconomicMarketplace), `src/runtime/engines/liquidity-marketplace/`

The LP marketplace matches liquidity demand with LP supply. LPs offer bandwidth (capacity) on corridors at a fee (bps). The marketplace runs auctions to select the best LP for each settlement.

```typescript
interface EconomicMarketplace {
  getOffers(corridor: string, amount: number): LPOffer[];
  selectOffer(offers: LPOffer[], criteria: SelectionCriteria): LPOffer;
  recordSettlement(offer: LPOffer, amount: number): void;
}
```

### 4.7 Ledger

**Files**: `src/runtime/ledger/`

Double-entry ledger. Every financial event produces journal entries.

```typescript
interface Ledger {
  post(entries: JournalEntry[]): void;
  getBalanceSheet(): BalanceSheet;
  getAccount(accountId: string): Account;
  getEntries(filter?: EntryFilter): JournalEntry[];
}

interface JournalEntry {
  entryId: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  currency: string;
  memo: string;
  frame: number;
}
```

### 4.8 Liquidity Composer (Multi-hop)

**Files**: `src/runtime/engines/liquidity-composer/`

Composes multi-hop and split routing plans. When no direct corridor exists, the composer finds paths through intermediate currencies (up to 4 hops). When a single path can't handle the full amount, it splits across multiple paths.

```typescript
class LiquidityComposer {
  compose(request: CompositionRequest, graph: LiquidityGraph): ComposedExecutionPlan;
}
```

**Pure**: The composer never executes, never emits events, never mutates state. It only recommends. The compiler then decides whether to use the composed plan.

**Components**:
- `graph.ts`: Builds a liquidity graph from LP offers + reserve bridges
- `pathfinder.ts`: Bounded DFS (max 4 hops, no cycles) to find paths
- `optimizer.ts`: Cost decomposition + scoring (cost + latency + risk + reliability)
- `splitter.ts`: Greedy allocation across paths when capacity-constrained or cost-beneficial

---

## 5. Economic Kernel

The economic kernel handles higher-level economic intelligence: the Economic Council, Constitution, Digital Twin, and Network Expansion.

### 5.1 Economic Council

**Files**: `src/runtime/council/`

The Economic Council debates and votes on strategy selection. Each "director" represents an economic objective (cost, speed, risk, solvency, liquidity).

```typescript
interface EconomicCouncil {
  deliberate(input: CouncilInput): CouncilDecision;
}

interface CouncilDecision {
  strategy: string;
  weightedScore: number;
  objectiveScores: ObjectiveScore[];
  directorOpinions: DirectorOpinion[];
  confidence: number;
  alternatives: Alternative[];
}
```

**Directives**: Each director has a weighted vote. The council produces a recommendation with confidence and rationale. The Transaction Coordinator uses the winning strategy.

### 5.2 Constitution

**Files**: `src/runtime/invariants/`

The Constitution is the set of inviolable rules. It's enforced by the Invariant Engine (Section 3.4) on every command.

**Sections**:
- **Solvency**: Assets ≥ Liabilities at all times
- **Reserve Coverage**: Every twin token is 1:1 backed by reserves
- **LP Collateral**: LPs must have sufficient stake for their bandwidth
- **Settlement Finality**: Once confirmed, a settlement cannot be reversed except via explicit refund
- **Audit Trail**: Every mutation produces an immutable event

### 5.3 Digital Twin (Control Plane)

**Files**: `src/runtime/control-plane/`

The Digital Twin is a real-time model of the entire network: countries, reserves, LPs, corridors, flows.

```typescript
interface LiquidityDigitalTwin {
  countries: CountryState[];
  corridors: CorridorState[];
  totalReserves: number;
  totalBandwidth: number;
  networkDensity: number;
}

interface CountryState {
  country: string;
  currency: string;
  fiatReserves: number;
  stablecoinReserves: number;
  maturity: 'stablecoin_only' | 'hybrid' | 'mostly_fiat';
  activeLPs: number;
  bandwidth: number;
}
```

The control plane also manages:
- **Reserve Evolution**: Tracks maturity progression and recommends upgrades
- **Network Optimization**: Analyzes network density and recommends new corridors/LPs
- **Inspection**: `src/runtime/inspector/` provides deep state inspection for debugging

### 5.4 Network Expansion Engine

**Files**: `src/runtime/expansion/`

Plans autonomous network expansion: new country launches, corridor openings, reserve launches, LP recruitment.

```typescript
class NetworkExpansionEngine {
  planCountryLaunches(): CountryLaunchPlan[];
  planCorridorExpansions(): CorridorExpansionPlan[];
  planReserveLaunches(): ReserveLaunchPlan[];
  planLPRecruitment(): LPRecruitmentPlan[];
  simulateExpansion(years: number): ExpansionSimulation;
}
```

The 5-year simulation projects: new countries, reserves, LPs, corridors, twin token supply, profit, ROI, risk. Each plan includes prerequisites, readiness classification, and approval class.

### 5.5 Economic Compiler

**Files**: `src/runtime/economic/` (EconomicCompiler)

Compiles economic objectives into concrete treasury and marketplace actions. Bridges the Economic Council's strategic decisions with the Financial Kernel's execution.

### 5.6 Directorate

**Files**: `src/runtime/directorate/`

The Global Economic Directorate provides strategic intelligence: risk assessment, crisis management, sovereign operations. Higher-level than the Council (which handles per-transaction decisions).

### 5.7 Eco-Intelligence

**Files**: `src/runtime/eco-intelligence/`

Aggregates economic signals, runs counterfactual analysis, and produces recommendations for the Directorate.

---

## 6. Governance

### 6.1 Governance Council

**Files**: `src/protocol/governance/`

Separate from the Economic Council (which handles per-transaction strategy), the Governance Council handles platform-level decisions: approving new countries, changing policies, managing incidents.

### 6.2 Approval Classes

Every command has an approval class:
- **Automatic**: No human approval needed (e.g., standard payment under limits)
- **Operator**: Operations team approval (e.g., large payout)
- **Treasury**: Treasury team approval (e.g., reserve adjustment)
- **Governance**: Full governance council vote (e.g., new country launch)

### 6.3 Audit Log

**Model**: `AuditLog` (Prisma)

Every action — API call, admin action, runtime dispatch, login — is recorded in the audit log with: userId, action, resourceType, resourceId, result, timestamp.

Exposed via:
- `/admin/audit` — admin audit log viewer
- `/api/activity` — unified activity feed
- `/developers/logs` — developer-specific logs

### 6.4 Incidents

**Models**: `Incident`, `IncidentUpdate`

Incidents track operational issues. Created by:
- The AI Director's "Escalate Issue" button on the runtime page
- Automated alerts from the ops monitoring
- Manual creation by ops/support

Each incident has: title, severity (LOW/MEDIUM/HIGH/CRITICAL), status (OPEN/INVESTIGATING/RESOLVED/CLOSED), component, assignee, timeline of updates.

---

## 7. Platform Layer

### 7.1 Unified Shell

**Files**: `src/components/unified-shell.tsx`, `src/components/role-shell.tsx`

All 9 role layouts use the UnifiedShell (or its thin wrapper RoleShell). The shell provides:
- **Sidebar**: Role-specific navigation (defined in `src/lib/nav-config.tsx`)
- **Header**: Role switcher, environment switcher, notification center, command palette
- **Main content area**: Scrollable with proper height calculation

### 7.2 Role-Based Access Control

**Models**: `User`, `UserRole`

A user can have multiple roles. The current role is derived from the URL (e.g., `/admin/*` → ADMIN, `/dashboard/*` → MERCHANT).

**Auth Guards** (`src/lib/auth-guards.ts`):
- `requireMerchant()` — redirects to /unauthorized if not MERCHANT
- `requireCustomer()` — redirects to /unauthorized if not CUSTOMER
- `requireAdmin()` — redirects if not ADMIN or SUPER_ADMIN
- Similar for LP, TREASURY, COMPLIANCE, SUPPORT, OPERATIONS, DEVELOPER

**API Auth** (`src/lib/api-auth.ts`):
- `requireSession()` — returns session or null
- `requireMerchantId()` — resolves merchantId from session (with fallback to developer sandbox merchant)
- `unauthorized()`, `forbidden()` — standard 401/403 responses

### 7.3 Environment Switching

**Files**: `src/components/env-switcher.tsx`, `src/lib/environment.ts`, `src/runtime/host/`

Two environments: **Sandbox** (test data, no real money) and **Live** (real data).

- The env switcher in the header POSTs to `/api/runtime/host` to switch `runtimeHost.activeEnvironment`
- Also writes a cookie (`payswap-env-mode`) for server-side reads
- Default: `sandbox` (safe default)
- Both environments share code but have isolated event stores, treasuries, ledgers

### 7.4 Extension Marketplace

**Models**: `Extension`, `ExtensionInstall`, `ExtensionReview`

**Merchant marketplace** (`/dashboard/extensions`):
- Catalog with 13 categories (Accounting, Analytics, CRM, Marketing, etc.)
- Search, sort, filter
- Install flow with permissions consent dialog
- Enable/Disable/Configure/Uninstall

**Admin manager** (`/admin/extensions`):
- Marketplace Review tab (approve/reject submissions)
- All Extensions tab (feature/deprecate/archive)

**18 API endpoints** for full lifecycle: install, enable, disable, suspend, upgrade, rollback, uninstall, configure, review, submit, publish, admin actions.

### 7.5 Developer Console

**Files**: `src/app/(developer)/developers/`

Pages:
- `/developers` — home (sandbox status, API keys, recent events, extensions)
- `/developers/sandbox` — sandbox state + reset
- `/developers/api-keys` — test + live keys with scopes
- `/developers/webhooks` — endpoints, test delivery, delivery history
- `/developers/simulator` — run kernel scenarios with timeline
- `/developers/extensions` — create, submit for review
- `/developers/logs` — audit trail
- `/developers/metrics` — usage stats
- `/developers/docs` — Stripe-level API docs (36 endpoints, 14 groups)
- `/developers/explorer` — try-it-now API explorer
- `/developers/inspectors/*` — 8 kernel inspectors (Section 9)
- `/developers/digital-twin` — Digital Twin Console
- `/developers/time-machine` — Runtime Time Machine

### 7.6 Extension Lifecycle

```
Draft → Sandbox → Submitted → Static Analysis → Security Scan →
Review → Approved → Published → Installed → Enabled → Disabled →
Deprecated → Archived
```

Each transition has API endpoints and admin UI. Extensions require explicit permission grants from the merchant.

---

## 8. Trust & Transparency

### 8.1 Trust Engine

**Files**: `src/runtime/trust/`

The trust engine computes trust scores for all participants (LPs, merchants, corridors, countries) based on: historical performance, settlement success rate, dispute frequency, compliance record.

### 8.2 Proof of Reserves

The balance sheet is publicly auditable. Every twin token is 1:1 backed by reserves. The proof of reserves is derived from the event store — not a separate calculation.

### 8.3 Public Transparency Dashboard

**Route**: `/` (public home page)

Shows real-time economic state: total reserves, twin token supply, active corridors, settlement volume. All figures derived from the event-sourced runtime.

---

## 9. Capability SDK (M-PLATFORM-39)

The Capability SDK transforms PaySwap from "our financial operating system" into **a financial operating system that others can build on**. Everything becomes a plugin.

### 9.1 Plugin Manifest

**File**: `src/sdk/types.ts`

Every plugin declares a manifest:

```typescript
interface PluginManifest {
  name: string;               // e.g., "mtn-ghana-momo"
  version: string;            // semver
  description: string;
  author: string;
  
  capabilities: CapabilityDeclaration[];   // what it provides
  permissions: Permission[];               // what it needs
  commands: CommandHandler[];              // what actions it handles
  events: EventHandler[];                  // what it emits/listens to
  views: ViewDeclaration[];                // what UI it contributes
  policies: PolicyDeclaration[];           // what rules it enforces
  dependencies: Dependency[];              // what other plugins it needs
  migrations: Migration[];                 // how to upgrade data
  
  minRuntimeVersion?: string;
  maxRuntimeVersion?: string;
}
```

**Capability Types**: `settlement-rail`, `wallet`, `compliance`, `identity`, `analytics`, `fraud-detection`, `corridor-optimizer`, `pricing-engine`, `country`, `stablecoin`, `twin-token`, `marketplace-algorithm`, `ai-director`, `notification`, `custom`.

### 9.2 Plugin Loader

**File**: `src/sdk/loader.ts`

The `PluginLoader` discovers, validates, and registers plugins:

```typescript
class PluginLoader {
  async register(manifest, module): Promise<string>;  // validate + register
  async enable(pluginId, ctx): Promise<void>;         // check deps, call onEnable
  async disable(pluginId, ctx): Promise<void>;        // call onDisable
  async unregister(pluginId): Promise<void>;           // call onUnload, remove
  list(): PluginRecord[];
  get(pluginId): PluginRecord | undefined;
}
```

**Lifecycle**: `registered → enabled → disabled → unregistered`. Each transition calls lifecycle hooks (`onLoad`, `onEnable`, `onDisable`, `onUnload`).

### 9.3 Capability Registry

**File**: `src/sdk/registry.ts`

Tracks what capabilities are available and which plugin provides them:

```typescript
class CapabilityRegistry {
  register(pluginId, capability): void;
  unregister(pluginId): void;
  get(capabilityId): { pluginId, capability } | undefined;
  getByType(type): { pluginId, capability }[];
  list(): { pluginId, capability }[];
}
```

### 9.4 Plugin Sandbox

**File**: `src/sdk/sandbox.ts`

Plugins execute in a restricted context. They do NOT have access to:
- Filesystem (no `fs`, `path`)
- Network (no `http`, `fetch` — unless granted)
- Process (no `process`, `require`)
- Database (no Prisma — they use `ctx.store`)
- Runtime (no direct import — they use `ctx.runtime`)

Plugins communicate ONLY through the `PluginContext`:

```typescript
interface PluginContext {
  pluginId: string;
  logger: { info, warn, error };
  runtime: {
    getBalanceSheet(): Promise<unknown>;
    getDigitalTwin(): Promise<unknown>;
    getEvents(filter?): Promise<unknown[]>;
  };
  emit(event: { type, payload }): Promise<void>;
  call(capabilityId, method, args): Promise<unknown>;
  store: {
    get(key): Promise<unknown>;
    set(key, value): Promise<void>;
    delete(key): Promise<void>;
    list(prefix?): Promise<string[]>;
  };
}
```

The sandbox wraps handler calls in try/catch, enforces timeouts, and tracks errors. Plugins that fail repeatedly are marked `error` and disabled.

### 9.5 Built-in Plugins

**Files**: `src/sdk/builtin/`

Three reference plugins ship with PaySwap:
1. **mtn-ghana-momo** — A settlement rail plugin for MTN Ghana Mobile Money
2. **basic-fraud-detection** — A fraud detection plugin that listens to payment events and flags suspicious patterns
3. **treasury-analytics** — An analytics plugin that computes treasury metrics and emits custom events

These demonstrate the plugin pattern: manifest + module + handlers.

### 9.6 API Endpoints

- `GET /api/sdk/plugins` — list all registered plugins
- `GET /api/sdk/plugins/[id]` — plugin detail
- `POST /api/sdk/plugins/[id]/enable` — enable a plugin
- `POST /api/sdk/plugins/[id]/disable` — disable a plugin
- `GET /api/sdk/capabilities` — list all capabilities (filter by type)
- `POST /api/sdk/capabilities/invoke` — invoke a capability method

### 9.7 Admin UI

**Route**: `/admin/sdk`

The Capability SDK dashboard shows:
- List of registered plugins with status badges (registered/enabled/disabled/error)
- Click a plugin to see its full manifest
- Enable/Disable buttons
- Capability browser — list all capabilities by type

### 9.8 Developer Console Inspectors

**Routes**: `/developers/inspectors/*`

8 inspectors that expose the kernel's internal state:

| Inspector | Route | Exposes |
|-----------|-------|---------|
| Event Explorer | `/inspectors/events` | Event store with filtering, payload expansion |
| Command Explorer | `/inspectors/commands` | Command registry with schemas + recent invocations |
| Replay Explorer | `/inspectors/replay` | Reconstruct state at any seq/timestamp |
| Settlement Inspector | `/inspectors/settlement` | Active/recent settlement contracts + stages |
| Council Inspector | `/inspectors/council` | Economic Council sessions, votes, director opinions |
| Constitution Inspector | `/inspectors/constitution` | All invariants, pass/fail status, violations |
| Ledger Inspector | `/inspectors/ledger` | Accounts, balances, journal entries |
| Treasury/LP Inspector | `/inspectors/treasury-lp` | Reserves by country + LP positions |

### 9.9 Digital Twin Console

**Routes**: `/developers/digital-twin`, `/admin/digital-twin`

Visualizes the live Digital Twin:
- Countries grid (reserves, maturity, LPs, bandwidth)
- Corridors table (from → to, cost, volume)
- LP network
- 5-year expansion projections

### 9.10 Runtime Time Machine

**Routes**: `/developers/time-machine`, `/admin/time-machine`

Replay any point in time:
- Timeline slider (seq 0 → current)
- Date/time picker
- Play/pause (1×/2×/5×/10× speed)
- State reconstruction at any point (balance sheet, metrics, events)
- Compare/diff mode (state at two points)
- Jump-to-event search

### 9.11 Extension SDK Vision (Future)

The next evolution: developers write typed plugins using a documented SDK:

```typescript
// Example future SDK usage
import { SettlementRailPlugin } from '@payswap/sdk';

export default SettlementRailPlugin.create({
  name: 'my-momo-rail',
  currency: 'GHS',
  async settle(payment) {
    // Custom settlement logic
    return { success: true, reference: '...' };
  },
});
```

This will transform PaySwap from "our financial OS" into a platform others can build on.

---

## 10. Data Layer

### 10.1 Prisma Schema

**File**: `prisma/schema.prisma`

**41 models** across 5 categories:

**Identity & Access**: User, UserRole, Session, WaitlistEntry, Account, Organization, OrganizationMember, TeamMember

**Financial**: Merchant, Customer, CustomerRecord, LPProfile, Wallet, WalletTransaction, Payment, Payout, Refund, Product, Invoice, Subscription, PaymentLink

**Developer**: ApiKey, WebhookEndpoint, WebhookDelivery, Extension, ExtensionInstall, ExtensionReview

**Compliance**: ComplianceReview, AMLAlert, SAR, AuditLog

**Runtime**: EventRecord, LedgerSnapshotRecord, SimulationRun, SavedScenarioRecord, LedgerEntryRecord, TwinTokenRecord, PlanAmendmentRecord, CheckpointRecord, Incident, IncidentUpdate

**Database**: SQLite (development) / PostgreSQL (production). The schema uses `provider = "sqlite"` with `Int` instead of `BigInt` for SQLite compatibility.

### 10.2 Event Sourcing Pattern

```
Command → Dispatcher → Validate → Execute → Append Events → Notify Projections
                                                              ↓
                                                        Read Models
                                                              ↓
                                                           Queries
```

**Event Store**: `EventRecord` table. Each event has: eventId, type, payload (JSON), ts, frame, seq, createdAt.

**Snapshots**: `LedgerSnapshotRecord` periodically captures the full ledger state for fast recovery.

**Checkpoints**: `CheckpointRecord` tracks the last seq processed by each projection, enabling incremental replay.

### 10.3 Projections

Projections are the read side of event sourcing. They listen to events and update read-optimized tables.

**Projection Health**: `ProjectionHealthRegistry` tracks per-projection: eventsApplied, rows, lag (unprocessed events), healthy, lastReplayMs.

**Backfill**: `MigrationManager` imports existing database rows into projections on first run. Each capability (Payments, Refunds, Wallets, Treasury) registers its own backfill function.

### 10.4 Client

**File**: `src/lib/db.ts`

```typescript
import { PrismaClient } from '@prisma/client';
export const db = new PrismaClient();
```

All database access goes through this client. The ESLint rule `payswap-read-models/no-direct-prisma-write` forbids direct writes to financial tables — all writes must go through `runtime.dispatcher.dispatch()`.

---

## 11. API Layer

### 11.1 Route Structure

**Files**: `src/app/api/`

API routes follow RESTful conventions:
- `POST /api/{resource}/create` — create a resource
- `GET /api/{resource}` — list resources
- `GET /api/{resource}/[id]` — get a single resource
- `PATCH /api/{resource}/[id]` — update a resource
- `POST /api/{resource}/[id]/{action}` — perform an action

### 11.2 Authentication

**File**: `src/lib/auth.ts`

NextAuth.js v4 with credentials provider. JWT-based sessions (30-day expiry).

```typescript
export const authOptions: NextAuthOptions = {
  providers: [CredentialsProvider({ ... })],
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  callbacks: {
    jwt({ token, user }) { /* add roles to token */ },
    session({ session, token }) { /* add roles to session */ },
  },
};
```

**Middleware** (`src/middleware.ts`): `withAuth` from `next-auth/middleware` gates all role-specific routes (`/admin/*`, `/dashboard/*`, `/treasury/*`, etc.). Requires `NEXTAUTH_SECRET` env var.

### 11.3 Authorization

**File**: `src/lib/api-auth.ts`

```typescript
async function requireSession(): Promise<Session | null>;
async function requireMerchantId(): Promise<number | null>;
function unauthorized(): NextResponse;   // 401
function forbidden(): NextResponse;      // 403
```

**Guards** (`src/lib/auth-guards.ts`): Server-component versions that redirect to `/unauthorized` on failure:
- `requireMerchant()`, `requireCustomer()`, `requireAdmin()`, etc.

### 11.4 Key API Groups

| Group | Path | Purpose |
|-------|------|---------|
| Payments | `/api/payments/*` | Create, list, refund payments |
| Payouts | `/api/payouts/*` | Create, list payouts |
| Customers | `/api/customers/*` | CRUD customers |
| Invoices | `/api/invoices/*` | Create, list, pay invoices |
| Wallets | `/api/customer/wallet/*` | Deposit, withdraw, transfer |
| Developer | `/api/developer/*` | Sandbox, API keys, webhooks, simulator, inspectors |
| Extensions | `/api/extensions/*` | Marketplace lifecycle |
| SDK | `/api/sdk/*` | Plugin management |
| Runtime | `/api/runtime/*` | Runtime state, projections, AI director |
| LP | `/api/lp/*` | LP capital, corridors, settings |
| Treasury | `/api/treasury-v2/*` | Reserve management |
| Compliance | `/api/compliance/*` | KYC, AML, sanctions |
| Admin | `/api/admin/*` | User management, waitlist, extensions |

---

## 12. UI Layer

### 12.1 App Router Structure

**Files**: `src/app/`

Next.js 16 App Router with route groups for each role:
- `(admin)/` — admin console
- `(merchant)/` — merchant dashboard
- `(developer)/` — developer console
- `(customer)/` — customer portal
- `(lp)/` — LP console
- `(treasury)/` — treasury console
- `(compliance)/` — compliance console
- `(support)/` — support console
- `(ops)/` — operations console
- `(auth)/` — login, waitlist

Each route group has its own `layout.tsx` that uses `RoleShell` (a thin wrapper over `UnifiedShell`) with role-specific navigation.

### 12.2 Role Layouts

**File**: `src/components/role-shell.tsx`

All 9 role layouts use the same shell with different nav configs:

```tsx
<RoleShell
  nav={adminNav}           // from src/lib/nav-config.tsx
  currentRole="ADMIN"
  basePath="/admin"
  settingsHref="/admin/settings"
>
  {children}
</RoleShell>
```

The shell provides: sidebar nav, header (role switcher, env switcher, notifications, command palette), and a scrollable main content area with sticky footer.

### 12.3 Shared Components

**Files**: `src/components/`

- `ui/` — shadcn/ui component library (40+ components: Button, Card, Dialog, Table, Select, Tabs, etc.)
- `page-header.tsx` — consistent page headers with title, description, actions
- `empty-state.tsx` — empty state placeholders
- `stat-card.tsx` — stat cards
- `data-table.tsx` — sortable/filterable tables
- `notification-center.tsx` — notification bell with relevance filtering
- `command-palette.tsx` — Cmd+K command palette
- `env-switcher.tsx` — Sandbox/Live toggle
- `role-switcher.tsx` — role dropdown

### 12.4 Admin Console

**Route**: `/admin`

Pages: Dashboard, Runtime Console (with AI Director), Simulations, Digital Twin, Time Machine, Capability SDK, Extensions, Platform, Network, Merchants, Users, Waitlist, Audit.

### 12.5 Merchant Dashboard

**Route**: `/dashboard`

Pages: Home, Payments, Payouts, Customers, Invoices, Products, Subscriptions, Payment Links, QR Codes, Disputes, Refunds, Analytics, Reports, Extensions, Activity, Settings (Organization, Billing, Team, API Keys, Webhooks).

### 12.6 Developer Console

**Route**: `/developers`

Pages: Home, Sandbox, API Keys, Webhooks, Simulator, Extensions, Logs, Metrics, Docs, Explorer, Inspectors (8), Digital Twin, Time Machine.

### 12.7 Customer Portal

**Route**: `/portal`

Pages: Home, Wallet (deposit, withdraw, scan QR, transfer, receive), Invoices (pay with wallet), Payments, Profile.

### 12.8 LP Console

**Route**: `/lp`

Pages: Home, Positions, Corridors, Settings (with payment methods, currency dropdowns, help icons, AI assistant), Settlements, Profitability.

---

## 13. Security Model

### 13.1 Authentication

- **NextAuth.js v4** with credentials provider
- **JWT sessions** (30-day expiry)
- **Password hashing**: bcrypt
- **No self-signup**: Users join via waitlist → admin approval → account creation with random password
- **Demo accounts**: 9 accounts (merchant, admin, developer, customer, LP, treasury, compliance, support, ops) all sharing password `Payswap123456`

### 13.2 Authorization

- **Role-based**: 10 roles (MERCHANT, CUSTOMER, LP, TREASURY, COMPLIANCE, SUPPORT, OPERATIONS, DEVELOPER, ADMIN, SUPER_ADMIN)
- **Multi-role**: One user can hold multiple roles
- **Route-level**: Middleware gates all role-specific routes
- **API-level**: `requireSession()` + `requireMerchantId()` (or equivalent) on every API route
- **Page-level**: `requireMerchant()` (or equivalent) server guard on every page

### 13.3 API Keys & Scopes

**Model**: `ApiKey`

API keys are environment-specific (`sk_test_*` for sandbox, `sk_live_*` for live). Scopes: `payments:read`, `payments:write`, `payouts:read`, `payouts:write`, `customers:read`, `customers:write`, `webhooks:read`, `admin`.

Keys are stored as SHA-256 hashes. The full key is shown once on creation, never again.

### 13.4 Webhooks

**Models**: `WebhookEndpoint`, `WebhookDelivery`

Merchants register webhook endpoints with event type subscriptions. The system delivers events with retry (exponential backoff). Delivery history tracks: timestamp, event type, status code, duration, retry count.

### 13.5 Audit Trail

**Model**: `AuditLog`

Every action is logged: userId, action, resourceType, resourceId, result (SUCCESS/ERROR), metadata, timestamp. Immutable. Used for compliance, debugging, and the activity feed.

### 13.6 Compliance

**Models**: `AMLAlert`, `ComplianceReview`, `SAR` (Suspicious Activity Report)

- **AML**: Automated alerts for suspicious patterns (structuring, velocity, high-risk jurisdictions)
- **KYC**: Verification workflow (PENDING → APPROVED/REJECTED/REVIEW_NEEDED)
- **Sanctions**: Screening against sanctions lists with fuzzy matching
- **SAR**: Suspicious Activity Reports filed for escalated alerts

---

## 14. Deployment Architecture

### 14.1 Development

- **Framework**: Next.js 16 with App Router (webpack or turbopack)
- **Runtime**: Bun (package manager + script runner)
- **Database**: SQLite (`db/custom.db`)
- **Dev server**: `bun run dev` on port 3000
- **Hot reload**: File-watching with auto-restart

### 14.2 Production

- **Hosting**: Vercel (Next.js optimized)
- **Database**: PostgreSQL (Neon, Supabase, or similar)
- **Build**: `bun run build` produces standalone output
- **Start**: `bun run start` runs the production server

### 14.3 Mini Services

**Directory**: `mini-services/`

Independent Bun services for specific capabilities (e.g., WebSocket real-time communication). Each has its own `package.json` and port. The Caddy gateway routes to them via `?XTransformPort=N` query parameter.

### 14.4 Gateway

**File**: `Caddyfile`

A single external port is exposed. The Caddy gateway routes:
- All `/api/*` requests to the Next.js server (port 3000)
- Requests with `?XTransformPort=N` to the specified mini-service port
- WebSocket connections via `/?XTransformPort=N`

### 14.5 Environment Variables

```
DATABASE_URL=file:/home/z/my-project/db/custom.db  (SQLite dev)
# OR
DATABASE_URL=postgresql://...                       (PostgreSQL prod)

NEXTAUTH_SECRET=<random-secret>
NEXTAUTH_URL=http://localhost:3000                  (or production URL)
```

---

## 15. Glossary

| Term | Definition |
|------|------------|
| **Runtime** | The event-sourced kernel. The single source of truth. |
| **Dispatcher** | The only entry point for state mutation. Validates + executes commands. |
| **Event Store** | Append-only log of domain events. |
| **Projection** | Read model built from events. |
| **Invariant** | A rule that can never be violated (e.g., solvency). |
| **Constitution** | The collection of all invariants. |
| **Twin Token** | PaySwap's internal settlement token. 1:1 backed by reserves. |
| **LP** | Liquidity Provider. Offers bandwidth on corridors for a fee. |
| **Corridor** | A payment route between two currencies/countries. |
| **Reserve** | Fiat or stablecoin backing for a currency. |
| **Maturity** | A country's reserve evolution: stablecoin_only → hybrid → mostly_fiat → fully_fiat. |
| **Digital Twin** | Real-time model of the entire network (countries, reserves, LPs, corridors). |
| **Economic Council** | Per-transaction strategy debate + voting body. |
| **Directorate** | Strategic intelligence body (risk, crisis, sovereign ops). |
| **Sandbox** | Test environment with isolated data. |
| **Live** | Production environment with real data. |
| **Capability** | A plugin-provided feature (settlement rail, wallet, compliance, etc.). |
| **Plugin** | An extension that adds capabilities via the Capability SDK. |
| **Manifest** | A plugin's declaration (capabilities, permissions, commands, events, etc.). |
| **Time Machine** | The ability to replay the system state at any point in time. |
| **OCC** | Optimistic Concurrency Control. Prevents lost updates. |
| **Saga** | A pattern for multi-step transactions with compensating rollback. |

---

*This document is maintained alongside the codebase. When subsystems change, update the corresponding section. The architecture reference is the contract between contributors — keep it accurate.*
