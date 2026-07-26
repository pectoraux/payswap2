/**
 * Canonical World State Store — the kernel's database.
 *
 * This is the single source of truth. Every engine transforms one World State
 * into another — exactly like a game engine. The world is never mutated
 * in place; transformations produce a new versioned snapshot.
 *
 *   World State → Liquidity Intent → Optimization → Execution Plan
 *               → Constitution Validation → State Machine → Executor
 *               → New World State
 *
 * The store holds an append-only chain of world snapshots. Every snapshot
 * references its parent, so the full history of the financial system is
 * reconstructable. This is event sourcing applied to world state.
 */
import type {
  CurrencyCode,
  Reserve,
  LiquidityProvider,
  FinancialOperator,
  TreasuryPosition,
  TwinTokenRecord,
  LedgerEntry,
  LedgerAccount,
  SimulationEvent,
  Workflow,
  InsuranceClaim,
  AuditEntry,
  SimulationScenario,
} from './types';
import { uid, round } from './support';

export interface WorldState {
  version: number;
  parentId: string | null;
  ts: number;
  label: string;

  // Geography & money
  countries: { name: string; currency: CurrencyCode; flag: string }[];
  currencies: CurrencyCode[];

  // Liquidity infrastructure
  reserves: Reserve[];
  liquidityProviders: LiquidityProvider[];
  financialOperators: FinancialOperator[];

  // Finance
  treasury: { positions: TreasuryPosition[] };
  twinTokens: TwinTokenRecord[];
  insurance: { claims: InsuranceClaim[] };

  // Accounting
  ledger: { accounts: Map<string, LedgerAccount>; entries: LedgerEntry[] };

  // Orchestration
  workflows: Workflow[];

  // Observability
  events: SimulationEvent[];
  audit: AuditEntry[];

  // Policies
  policies: SimulationScenario['policies'];
}

export interface WorldSnapshot {
  id: string;
  version: number;
  parentId: string | null;
  ts: number;
  label: string;
  state: WorldState;
}

/**
 * The World Store holds an append-only chain of immutable world snapshots.
 * Engines read the current world, compute a new one, and commit it. The store
 * never mutates a committed snapshot — this is the financial equivalent of a
 * git history.
 */
export class WorldStore {
  private snapshots: WorldSnapshot[] = [];
  private current: WorldState;

  constructor(initial: WorldState) {
    this.current = initial;
    this.commit('genesis', initial);
  }

  /** The current world state (immutable reference). */
  world(): WorldState {
    return this.current;
  }

  /** Commit a new world state, producing a new snapshot. */
  commit(label: string, newState: WorldState): WorldSnapshot {
    const snapshot: WorldSnapshot = {
      id: uid('ws'),
      version: this.snapshots.length,
      parentId: this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1].id : null,
      ts: Date.now(),
      label,
      state: newState,
    };
    this.snapshots.push(snapshot);
    this.current = newState;
    return snapshot;
  }

  /** Transform the current world via a pure function, committing the result. */
  transform(label: string, fn: (world: WorldState) => WorldState): WorldSnapshot {
    const next = fn(this.clone(this.current));
    return this.commit(label, next);
  }

  /** Roll back to a previous snapshot (rare — used for replays). */
  rollback(version: number): WorldSnapshot | undefined {
    const snap = this.snapshots[version];
    if (snap) this.current = snap.state;
    return snap;
  }

  /** Full history (for the Time Machine / World Inspector). */
  history(): WorldSnapshot[] {
    return [...this.snapshots];
  }

  /** A specific snapshot. */
  snapshot(version: number): WorldSnapshot | undefined {
    return this.snapshots[version];
  }

  /** Deep-clone a world state (engines transform clones, never originals). */
  clone(world: WorldState): WorldState {
    return {
      ...world,
      countries: [...world.countries],
      currencies: [...world.currencies],
      reserves: world.reserves.map((r) => ({ ...r })),
      liquidityProviders: world.liquidityProviders.map((lp) => ({ ...lp })),
      financialOperators: world.financialOperators.map((fo) => ({ ...fo })),
      treasury: { positions: world.treasury.positions.map((p) => ({ ...p })) },
      twinTokens: world.twinTokens.map((t) => ({ ...t })),
      insurance: { claims: world.insurance.claims.map((c) => ({ ...c })) },
      ledger: {
        accounts: new Map(world.ledger.accounts),
        entries: [...world.ledger.entries],
      },
      workflows: world.workflows.map((w) => ({ ...w, steps: w.steps.map((s) => ({ ...s })) })),
      events: [...world.events],
      audit: [...world.audit],
      policies: { ...world.policies },
    };
  }

  reset(initial: WorldState): void {
    this.snapshots = [];
    this.current = initial;
    this.commit('genesis', initial);
  }
}

/** Build an initial world state from a simulation scenario. */
export function buildWorldFromScenario(scenario: SimulationScenario): WorldState {
  return {
    version: 0,
    parentId: null,
    ts: Date.now(),
    label: 'initial',
    countries: [
      { name: scenario.transaction.buyer.country, currency: scenario.transaction.buyer.currency, flag: '' },
      { name: scenario.transaction.merchant.country, currency: scenario.transaction.merchant.currency, flag: '' },
    ],
    currencies: [scenario.transaction.buyer.currency, scenario.transaction.merchant.currency],
    reserves: [
      { id: `reserve:${scenario.treasury.originReserve.country}`, country: scenario.treasury.originReserve.country, currency: scenario.treasury.originReserve.currency, available: scenario.treasury.originReserve.available, locked: 0, minThreshold: scenario.treasury.originReserve.minThreshold, forecast: 0, replenishmentSchedule: 'daily', aiConfidence: 0.9 },
      { id: `reserve:${scenario.treasury.destinationReserve.country}`, country: scenario.treasury.destinationReserve.country, currency: scenario.treasury.destinationReserve.currency, available: scenario.treasury.destinationReserve.available, locked: 0, minThreshold: scenario.treasury.destinationReserve.minThreshold, forecast: 0, replenishmentSchedule: 'daily', aiConfidence: 0.9 },
    ],
    liquidityProviders: scenario.liquidityProviders.map((lp) => ({ ...lp })),
    financialOperators: scenario.financialOperators.map((fo) => ({ ...fo })),
    treasury: {
      positions: [{ currency: scenario.transaction.merchant.currency, stablecoinBalance: scenario.treasury.stablecoinBalance, emergencyBalance: scenario.treasury.emergencyTreasury, fiatBalance: 0 }],
    },
    twinTokens: [],
    insurance: { claims: [] },
    ledger: { accounts: new Map(), entries: [] },
    workflows: [],
    events: [],
    audit: [],
    policies: { ...scenario.policies },
  };
}

/** Convenience: summarize a world state for the UI / inspector. */
export function summarizeWorld(world: WorldState) {
  const totalReserves = world.reserves.reduce((s, r) => s + r.available, 0);
  const totalLpCapacity = world.liquidityProviders.reduce((s, lp) => s + lp.tradingCapacity, 0);
  const totalTwinSupply = world.twinTokens.filter((t) => t.status !== 'burned').reduce((s, t) => s + t.amount, 0);
  const totalTreasury = world.treasury.positions.reduce((s, p) => s + p.stablecoinBalance + p.emergencyBalance + p.fiatBalance, 0);
  const ledgerDr = world.ledger.entries.reduce((s, e) => s + e.debit, 0);
  const ledgerCr = world.ledger.entries.reduce((s, e) => s + e.credit, 0);
  return {
    totalReserves: round(totalReserves, 2),
    totalLpCapacity: round(totalLpCapacity, 2),
    totalTwinSupply: round(totalTwinSupply, 2),
    totalTreasury: round(totalTreasury, 2),
    ledgerEntries: world.ledger.entries.length,
    ledgerBalanced: Math.abs(ledgerDr - ledgerCr) < 1e-6,
    ledgerDr: round(ledgerDr, 2),
    ledgerCr: round(ledgerCr, 2),
    onlineLps: world.liquidityProviders.filter((lp) => lp.online).length,
    onlineFos: world.financialOperators.filter((fo) => fo.online).length,
    events: world.events.length,
    workflows: world.workflows.length,
    insuranceClaims: world.insurance.claims.length,
    twinTokens: world.twinTokens.length,
  };
}
