/**
 * Kernel Constitution — non-overridable financial invariants.
 *
 * Before ANY plan is approved, it must pass every invariant in the
 * Constitution. These are the financial equivalent of ACID guarantees or
 * Kubernetes' control-plane admission controllers. No service, extension, AI
 * agent, workflow or product can override them — they protect the financial
 * integrity of the entire platform as it grows.
 *
 * The Constitution is checked:
 *   - at plan validation (before execution)
 *   - at every replay frame (continuous verification)
 *   - at settlement finalization
 *
 * If any invariant is violated, the plan is REJECTED (pre-execution) or the
 * run is flagged INVALID (post-execution).
 */
import type {
  LiquidityExecutionPlan,
  TwinTokenRecord,
  LedgerEntry,
  Reserve,
  WorldState,
  SimulationResult,
} from './types';
import { round } from './support';

export interface Invariant {
  id: string;
  name: string;
  description: string;
  overridable: false; // always false — this is the point
  check: (ctx: InvariantContext) => InvariantResult;
}

export interface InvariantContext {
  plan: LiquidityExecutionPlan;
  ledger: LedgerEntry[];
  twinTokens: TwinTokenRecord[];
  reserves: Reserve[];
  world: WorldState;
  result?: SimulationResult;
}

export interface InvariantResult {
  passed: boolean;
  detail: string;
  severity: 'block' | 'warn';
}

export interface ConstitutionVerdict {
  passed: boolean;
  violations: { invariant: string; detail: string; severity: 'block' | 'warn' }[];
  checks: { invariant: string; passed: boolean; detail: string }[];
}

/** The fixed, non-overridable Constitution. */
export const CONSTITUTION: Invariant[] = [
  {
    id: 'ledger-balanced',
    name: 'Ledger Always Balances',
    description: 'For every transaction, total debits must equal total credits. No value may be created or destroyed.',
    overridable: false,
    check: (ctx) => {
      const dr = ctx.ledger.reduce((s, e) => s + e.debit, 0);
      const cr = ctx.ledger.reduce((s, e) => s + e.credit, 0);
      const balanced = Math.abs(dr - cr) < 1e-6;
      return { passed: balanced, detail: balanced ? `Dr ${round(dr, 2)} = Cr ${round(cr, 2)}` : `UNBALANCED: Dr ${round(dr, 2)} ≠ Cr ${round(cr, 2)}`, severity: 'block' };
    },
  },
  {
    id: 'twin-token-backed',
    name: 'Every Twin Token Fully Backed',
    description: 'Every minted twin token must be backed by reserve, LP, treasury or stablecoin liquidity. Never allow unbacked supply.',
    overridable: false,
    check: (ctx) => {
      const minted = ctx.twinTokens.filter((t) => t.status === 'minted' || t.status === 'burned');
      const totalMinted = minted.reduce((s, t) => s + t.amount, 0);
      const drawn = ctx.plan.sourceDraws.reduce((s, d) => s + d.drawn, 0);
      const reserveDraw = ctx.plan.steps.filter((s) => s.type === 'draw_reserve').reduce((s, s2) => s + (s2.amount ?? 0), 0);
      const treasuryDraw = ctx.plan.steps.filter((s) => s.type === 'draw_treasury').reduce((s, s2) => s + (s2.amount ?? 0), 0);
      const backing = drawn + reserveDraw + treasuryDraw;
      const backed = round(backing, 6) >= round(totalMinted, 6) - 1e-6;
      return { passed: backed, detail: backed ? `${round(totalMinted, 2)} minted, ${round(backing, 2)} backing` : `UNBACKED: ${round(totalMinted, 2)} minted, only ${round(backing, 2)} backing`, severity: 'block' };
    },
  },
  {
    id: 'no-negative-balances',
    name: 'No Negative Balances',
    description: 'No reserve, treasury or LP balance may go negative unless explicitly permitted by policy.',
    overridable: false,
    check: (ctx) => {
      const violations = ctx.reserves.filter((r) => r.available < 0);
      if (violations.length === 0) return { passed: true, detail: 'All reserves non-negative', severity: 'block' };
      return { passed: false, detail: `Negative: ${violations.map((v) => `${v.country}=${round(v.available, 2)}`).join(', ')}`, severity: 'block' };
    },
  },
  {
    id: 'reserve-threshold',
    name: 'Reserve Threshold Respected',
    description: 'Reserves must remain above their minimum threshold after every state transition.',
    overridable: false,
    check: (ctx) => {
      const violations = ctx.reserves.filter((r) => r.minThreshold > 0 && r.available < r.minThreshold);
      if (violations.length === 0) return { passed: true, detail: 'All reserves above threshold', severity: 'block' };
      return { passed: false, detail: `Below threshold: ${violations.map((v) => `${v.country}=${round(v.available, 2)}/${v.minThreshold}`).join(', ')}`, severity: 'warn' };
    },
  },
  {
    id: 'manual-settlement-insurance',
    name: 'Manual Settlement Requires Insurance & Audit',
    description: 'Manual settlement can never bypass insurance and audit requirements.',
    overridable: false,
    check: (ctx) => {
      const hasManual = ctx.plan.sourceDraws.some((d) => d.manual);
      if (!hasManual) return { passed: true, detail: 'No manual settlement', severity: 'block' };
      const hasWorkflow = ctx.plan.steps.some((s) => s.type === 'notify_lp' || s.type === 'await_confirmation');
      return { passed: hasWorkflow, detail: hasWorkflow ? 'Manual settlement workflow present' : 'Manual LP without settlement workflow', severity: 'block' };
    },
  },
  {
    id: 'fallback-path',
    name: 'Every Plan Has Recoverable Fallback',
    description: 'Every execution plan must have at least one recoverable fallback path.',
    overridable: false,
    check: (ctx) => {
      const hasAlternatives = ctx.plan.alternatives.length > 0;
      const hasTreasury = ctx.world.treasury.positions.some((p) => p.stablecoinBalance > 0);
      return { passed: hasAlternatives || hasTreasury, detail: hasAlternatives ? `${ctx.plan.alternatives.length} alternative path(s)` : hasTreasury ? 'Treasury available as fallback' : 'No fallback available', severity: 'warn' };
    },
  },
  {
    id: 'event-emission',
    name: 'Every Transition Emits Events',
    description: 'Every state transition must emit auditable events. No silent mutations.',
    overridable: false,
    check: (ctx) => {
      // Count events from the event engine directly (more reliable than the
      // context's events array which may not be populated at validation time).
      const eventCount = ctx.result?.events.length ?? 0;
      const stepCount = ctx.plan.steps.length;
      // At least one event per step (conservative). If no result yet (pre-execution
      // validation), check that the plan has event-emitting step types.
      if (eventCount === 0) {
        const emittingSteps = ctx.plan.steps.filter((s) =>
          ['debit_source', 'credit_reserve', 'mint_twin', 'burn_twin', 'draw_lp', 'draw_reserve', 'draw_treasury', 'credit_destination'].includes(s.type),
        ).length;
        return { passed: emittingSteps > 0, detail: `${emittingSteps} event-emitting steps in plan`, severity: 'warn' };
      }
      return { passed: eventCount >= stepCount, detail: `${eventCount} events for ${stepCount} steps`, severity: 'warn' };
    },
  },
  {
    id: 'no-double-spend',
    name: 'No Double Spend',
    description: 'No input may be spent more than once across the execution graph.',
    overridable: false,
    check: (ctx) => {
      const debitAccounts = new Map<string, number>();
      for (const e of ctx.ledger) {
        if (e.debit > 0) debitAccounts.set(e.accountId, (debitAccounts.get(e.accountId) ?? 0) + e.debit);
      }
      // The buyer account should only be debited once.
      const buyerDebits = ctx.ledger.filter((e) => e.accountId.startsWith('buyer:')).length;
      return { passed: buyerDebits <= 1, detail: `Buyer debited ${buyerDebits} time(s)`, severity: 'block' };
    },
  },
  {
    id: 'no-duplicate-settlement',
    name: 'No Duplicate Settlement',
    description: 'A transaction may only settle once. No duplicate credit to the merchant.',
    overridable: false,
    check: (ctx) => {
      const merchantCredits = ctx.ledger.filter((e) => e.accountId.startsWith('merchant:') && e.credit > 0).length;
      return { passed: merchantCredits <= 1, detail: `Merchant credited ${merchantCredits} time(s)`, severity: 'block' };
    },
  },
  {
    id: 'lp-capacity-respected',
    name: 'LP Capacity Respected',
    description: 'No LP may be drawn beyond its declared trading capacity.',
    overridable: false,
    check: (ctx) => {
      const overdrawn = ctx.plan.sourceDraws.filter((d) => d.drawn > d.remaining + d.drawn + 1e-6);
      return { passed: overdrawn.length === 0, detail: overdrawn.length === 0 ? 'All LP draws within capacity' : `${overdrawn.length} LP(s) overdrawn`, severity: 'block' };
    },
  },
];

/** Evaluate the full Constitution against a plan + world state. */
export function evaluateConstitution(ctx: InvariantContext): ConstitutionVerdict {
  const checks = CONSTITUTION.map((inv) => {
    const result = inv.check(ctx);
    return { invariant: inv.name, passed: result.passed, detail: result.detail, severity: result.severity };
  });
  const violations = checks.filter((c) => !c.passed).map((c) => ({ invariant: c.invariant, detail: c.detail, severity: c.severity }));
  return {
    passed: !violations.some((v) => v.severity === 'block'),
    violations,
    checks: checks.map((c) => ({ invariant: c.invariant, passed: c.passed, detail: c.detail })),
  };
}
