/**
 * RunbookManager — operational runbooks for the PaySwap platform.
 *
 * Backed by an in-memory map. Pre-populated with 8 built-in runbooks
 * covering SEV1 (Runtime Down, Treasury Insolvency), SEV2 (Settlement
 * Backlog, LP Default, Corridor Disruption), SEV3 (Database Migration,
 * Connector Outage) and SEV4 (Performance Degradation) scenarios.
 *
 * Custom runbooks can be created via `create()` and updated via `update()`.
 */

import type { Runbook, RunbookStep } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Built-in runbooks (8) ────────────────────────────────────────────────

const BUILTIN_RUNBOOKS: Array<
  Omit<Runbook, 'id' | 'createdAt' | 'updatedAt' | 'version'>
> = [
  {
    name: 'SEV1: Runtime Down',
    description:
      'The PaySwap runtime is unresponsive or refusing to settle payments. This runbook walks the operator through diagnosis and recovery.',
    category: 'incident',
    trigger:
      'SEV1 incident on the "runtime" component; p95 latency > 10s or 5xx rate > 50%.',
    owner: 'platform-oncall',
    steps: [
      {
        order: 1,
        title: 'Confirm scope of the outage',
        description:
          'Check whether the outage is regional or global. Look at the connector health board and the runtime engine summary.',
        command: 'curl /api/ops/health',
        expectedOutput: '{"status":"online"|"degraded"|"offline"}',
        validationCheck: 'status === "online" recovers within 5 minutes',
      },
      {
        order: 2,
        title: 'Inspect runtime engines',
        description:
          'List the runtime engines and find any that are offline or degraded.',
        command: 'curl /api/ops/health | jq .engineSummary',
        expectedOutput: '{"total":N,"online":N,"degraded":0,"offline":0}',
        validationCheck: 'offline === 0',
      },
      {
        order: 3,
        title: 'Replay stuck events',
        description:
          'If the event store is back-pressured, replay the last N events to unblock the pipeline.',
        command: 'curl -X POST /api/ops/replay -d \'{"limit":100}\'',
        expectedOutput: '{"replayed":N}',
        validationCheck: 'replayed count > 0 only if backlog existed',
      },
      {
        order: 4,
        title: 'Failover to standby runtime',
        description:
          'If the primary runtime cannot recover within 5 minutes, fail over to the standby.',
        command: 'payswap runtime failover',
        expectedOutput: 'failover accepted',
        validationCheck: '/api/ops/health returns online within 60s',
      },
      {
        order: 5,
        title: 'Open a postmortem',
        description:
          'Once traffic is restored, open a postmortem to capture the timeline.',
        command: 'payswap incident postmortem <incidentId>',
        expectedOutput: 'postmortem started',
        validationCheck: 'incident.status === "postmortem"',
      },
    ],
  },
  {
    name: 'SEV1: Treasury Insolvency',
    description:
      'A country reserve has gone below the minimum-solvency threshold and the runtime is refusing payouts in that corridor.',
    category: 'treasury',
    trigger:
      'SEV1 incident on the "treasury" component; reserve balance < solvency floor.',
    owner: 'treasury-oncall',
    steps: [
      {
        order: 1,
        title: 'Identify the insolvent country',
        description:
          'Check the treasury dashboard for any country whose reserve balance is below the floor.',
        command: 'curl /api/ops/dashboards/treasury',
        expectedOutput: '{"countries":[{"country":"NG","balance":...}]}',
        validationCheck: 'every country.balance >= country.floor',
      },
      {
        order: 2,
        title: 'Freeze the affected corridor',
        description:
          'Pause payouts in the insolvent corridor to prevent further draining.',
        command:
          'curl -X POST /api/treasury/freeze -d \'{"scope":"corridor","country":"NG"}\'',
        expectedOutput: '{"frozen":true}',
        validationCheck: 'corridor.status === "FROZEN"',
      },
      {
        order: 3,
        title: 'Request emergency reserve injection',
        description:
          'Open a treasury operation to inject liquidity from the central pool into the affected country reserve.',
        command:
          'curl -X POST /api/ops/treasury-ops -d \'{"type":"reserve_adjustment","country":"NG","currency":"NGN","amount":1000000,"rationale":"emergency injection"}\'',
        expectedOutput: '{"id":"...","status":"pending"}',
        validationCheck: 'treasury operation approved + executed',
      },
      {
        order: 4,
        title: 'Notify LPs in the corridor',
        description:
          'Send a notification to liquidity providers in the corridor so they can top up their positions.',
        command: 'payswap notify --corridor NG --message "reserve below floor"',
        expectedOutput: 'notified N LPs',
        validationCheck: 'LPs confirm top-ups within 30 min',
      },
      {
        order: 5,
        title: 'Unfreeze the corridor',
        description:
          'Once the reserve is back above the floor, unfreeze the corridor and resume payouts.',
        command: 'payswap treasury unfreeze --country NG',
        expectedOutput: 'unfrozen',
        validationCheck: 'payouts resume successfully',
      },
    ],
  },
  {
    name: 'SEV2: Settlement Backlog',
    description:
      'The settlement queue is backing up — payouts are taking > 5 minutes to settle. Retry failed settlements and consider manual settlements.',
    category: 'settlement',
    trigger:
      'SEV2 incident on "settlement"; settlement queue depth > 1000 or p95 settlement latency > 5 min.',
    owner: 'settlement-oncall',
    steps: [
      {
        order: 1,
        title: 'Inspect the settlement dashboard',
        description:
          'See the current backlog size and the failed-settlement count.',
        command: 'curl /api/ops/dashboards/settlement',
        expectedOutput: '{"queueDepth":N,"failed":N}',
        validationCheck: 'queueDepth < 100',
      },
      {
        order: 2,
        title: 'Retry failed settlements',
        description:
          'Bulk-retry all failed settlements from the last 24 hours.',
        command: 'curl -X POST /api/ops/settlement-ops -d \'{"type":"retry_failed","transactionId":"*","rationale":"bulk retry"}\'',
        expectedOutput: '{"id":"...","status":"pending"}',
        validationCheck: 'failed count drops to 0',
      },
      {
        order: 3,
        title: 'Force-complete stuck settlements',
        description:
          'For settlements stuck in PENDING for > 30 minutes, force-complete after manual review.',
        command: 'curl -X POST /api/ops/settlement-ops -d \'{"type":"force_complete","transactionId":"<id>","rationale":"stuck >30m"}\'',
        expectedOutput: '{"id":"...","status":"executed"}',
        validationCheck: 'transaction status === "settled"',
      },
      {
        order: 4,
        title: 'Reconcile ledger',
        description:
          'Run a reconciliation pass to verify all settlements landed on the ledger.',
        command: 'curl -X POST /api/ops/settlement-ops -d \'{"type":"reconcile","transactionId":"*","rationale":"post-backlog reconcile"}\'',
        expectedOutput: '{"id":"...","status":"executed"}',
        validationCheck: 'ledger invariants pass',
      },
    ],
  },
  {
    name: 'SEV2: LP Default',
    description:
      'A liquidity provider has defaulted on their obligations. Liquidate their collateral and rebalance the corridor.',
    category: 'treasury',
    trigger:
      'SEV2 incident on "treasury" or "marketplace"; LP missed a settlement obligation.',
    owner: 'treasury-oncall',
    steps: [
      {
        order: 1,
        title: 'Identify the defaulting LP',
        description:
          'Check the LP dashboard for any LP with a missed obligation.',
        command: 'curl /api/ops/dashboards/lp',
        expectedOutput: '{"lps":[{"id":"...","defaults":N}]}',
        validationCheck: 'no LP with defaults > 0',
      },
      {
        order: 2,
        title: 'Freeze the LP account',
        description:
          'Prevent the LP from taking on new positions until the default is resolved.',
        command: 'payswap lp freeze --id <lpId>',
        expectedOutput: 'frozen',
        validationCheck: 'lp.status === "FROZEN"',
      },
      {
        order: 3,
        title: 'Liquidate collateral',
        description:
          'Sell the LP\'s posted collateral to cover the defaulted amount.',
        command: 'payswap treasury liquidate --lp <lpId>',
        expectedOutput: 'liquidated',
        validationCheck: 'recovered amount >= defaulted amount',
      },
      {
        order: 4,
        title: 'Rebalance the corridor',
        description:
          'Move liquidity from over-reserved corridors to the affected corridor.',
        command:
          'curl -X POST /api/ops/treasury-ops -d \'{"type":"rebalance","country":"NG","currency":"NGN","amount":500000,"rationale":"post-default rebalance"}\'',
        expectedOutput: '{"id":"...","status":"pending"}',
        validationCheck: 'corridor reserve above floor',
      },
      {
        order: 5,
        title: 'File an LP-default report',
        description:
          'Open an investigation to capture the default for the postmortem.',
        command: 'payswap investigation open --title "LP <id> default"',
        expectedOutput: 'investigation created',
        validationCheck: 'investigation linked to incident',
      },
    ],
  },
  {
    name: 'SEV2: Corridor Disruption',
    description:
      'A payment corridor is disrupted (connector outage, regulator action, etc.). Reroute traffic and notify affected merchants.',
    category: 'incident',
    trigger:
      'SEV2 incident on "connectors" or "marketplace"; corridor success rate < 80%.',
    owner: 'platform-oncall',
    steps: [
      {
        order: 1,
        title: 'Identify the disrupted corridor',
        description:
          'Check the connector health board for any failing connector.',
        command: 'curl /api/ops/connectors',
        expectedOutput: '[{"id":"...","healthy":false}]',
        validationCheck: 'all connectors healthy',
      },
      {
        order: 2,
        title: 'Reroute to standby connector',
        description:
          'Switch the affected corridor to its standby connector.',
        command: 'payswap connectors failover --corridor NG-KE',
        expectedOutput: 'rerouted',
        validationCheck: 'new connector healthy + accepting traffic',
      },
      {
        order: 3,
        title: 'Notify affected merchants',
        description:
          'Send a notification to merchants with active flows in the disrupted corridor.',
        command: 'payswap notify --corridor NG-KE --message "temporarily rerouted"',
        expectedOutput: 'notified N merchants',
        validationCheck: 'no merchant complaints in #support within 1h',
      },
      {
        order: 4,
        title: 'Monitor recovery',
        description:
          'Watch the original connector for recovery. Once healthy, switch back.',
        command: 'payswap connectors watch --id <connectorId> --until healthy',
        expectedOutput: 'recovered',
        validationCheck: 'success rate >= 99% for 15 min',
      },
    ],
  },
  {
    name: 'SEV3: Database Migration',
    description:
      'A schema or data migration needs to be applied. Plan, execute, and verify — with a rollback plan.',
    category: 'migration',
    trigger:
      'Planned schema/data migration; SEV3 incident if the migration blocks the runtime.',
    owner: 'platform-oncall',
    steps: [
      {
        order: 1,
        title: 'Plan the migration',
        description:
          'Author the migration with a clear rollback plan. Each step must be individually reversible.',
        command: 'payswap migration plan --file ./migrations/<name>.json',
        expectedOutput: 'migration planned',
        validationCheck: 'rollbackPlan is non-empty',
      },
      {
        order: 2,
        title: 'Schedule a maintenance window',
        description:
          'Schedule a maintenance window so users are notified of the expected impact.',
        command:
          'curl -X POST /api/ops/maintenance -d \'{"title":"DB migration","component":"database","startAt":...,"endAt":...,"impact":"minor"}\'',
        expectedOutput: '{"id":"...","status":"scheduled"}',
        validationCheck: 'maintenance window is in the future',
      },
      {
        order: 3,
        title: 'Start the migration',
        description:
          'Begin the migration. Mark each step complete as it lands.',
        command: 'curl -X POST /api/ops/migrations/<id>/start',
        expectedOutput: '{"status":"in_progress"}',
        validationCheck: 'all steps complete within window',
      },
      {
        order: 4,
        title: 'Verify the migration',
        description:
          'Run the post-migration verification suite (smoke tests, invariants).',
        command: 'payswap migration verify --id <id>',
        expectedOutput: 'all checks passed',
        validationCheck: '0 failures',
      },
      {
        order: 5,
        title: 'Rollback if needed',
        description:
          'If verification fails, roll back to the previous version using the rollback plan.',
        command: 'curl -X POST /api/ops/migrations/<id>/rollback -d \'{"reason":"verify failed"}\'',
        expectedOutput: '{"status":"rolled_back"}',
        validationCheck: 'runtime health restored',
      },
    ],
  },
  {
    name: 'SEV3: Connector Outage',
    description:
      'A connector is intermittently failing or fully offline. Failover to a standby and retry queued messages.',
    category: 'incident',
    trigger:
      'SEV3 incident on "connectors"; connector success rate < 95% or fully offline.',
    owner: 'platform-oncall',
    steps: [
      {
        order: 1,
        title: 'Check connector health',
        description: 'See which connectors are degraded or offline.',
        command: 'curl /api/ops/connectors',
        expectedOutput: '[{"id":"...","healthy":false}]',
        validationCheck: 'all healthy',
      },
      {
        order: 2,
        title: 'Failover to standby',
        description: 'Switch traffic to the standby connector for the affected rail.',
        command: 'payswap connectors failover --id <connectorId>',
        expectedOutput: 'failover ok',
        validationCheck: 'new connector healthy',
      },
      {
        order: 3,
        title: 'Retry queued messages',
        description: 'Replay any messages that were buffered during the outage.',
        command: 'curl -X POST /api/ops/sre/replay-failed',
        expectedOutput: '{"replayed":N}',
        validationCheck: 'replayed count drops to 0',
      },
      {
        order: 4,
        title: 'File an incident',
        description:
          'Open a SEV3 incident to track the outage and the recovery.',
        command: 'curl -X POST /api/ops/incidents -d \'{"title":"Connector <id> outage","severity":"SEV3","component":"connectors"}\'',
        expectedOutput: '{"id":"...","status":"open"}',
        validationCheck: 'incident acknowledged within 15 min',
      },
    ],
  },
  {
    name: 'SEV4: Performance Degradation',
    description:
      'p95 latency is above the SLO but the system is still functional. Profile the hot path and optimize.',
    category: 'incident',
    trigger:
      'SEV4 incident on "runtime"; p95 latency > SLO for > 15 minutes.',
    owner: 'platform-oncall',
    steps: [
      {
        order: 1,
        title: 'Pull a flame graph',
        description: 'Capture a CPU profile of the runtime to find hot functions.',
        command: 'payswap runtime profile --duration 60s',
        expectedOutput: 'profile saved to /tmp/profile.json',
        validationCheck: 'profile has > 1000 samples',
      },
      {
        order: 2,
        title: 'Inspect the metrics dashboard',
        description:
          'Look for any metric that is anomalously high (CPU, memory, GC pause, queue depth).',
        command: 'curl /api/ops/metrics',
        expectedOutput: '{"metrics":[...]}',
        validationCheck: 'no metric > 2x baseline',
      },
      {
        order: 3,
        title: 'Identify the hot path',
        description:
          'Cross-reference the profile with the metrics to find the offending code path.',
        command: 'payswap runtime analyze --profile /tmp/profile.json',
        expectedOutput: '{"hotPath":"...","samples":N}',
        validationCheck: 'hot path is a single function',
      },
      {
        order: 4,
        title: 'Apply a hotfix',
        description:
          'Ship a targeted patch for the hot path. If not possible, scale out horizontally.',
        command: 'payswap deploy --patch ./patches/<name>.patch',
        expectedOutput: 'deployed',
        validationCheck: 'p95 latency < SLO for 15 min',
      },
    ],
  },
];

// ─── In-memory store ──────────────────────────────────────────────────────

const runbookStore = new Map<string, Runbook>();

function seedBuiltins() {
  if (runbookStore.size > 0) return;
  const now = Date.now();
  for (const rb of BUILTIN_RUNBOOKS) {
    const id = rid('rb');
    runbookStore.set(id, {
      ...rb,
      id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export type NewRunbookInput = Omit<
  Runbook,
  'id' | 'createdAt' | 'updatedAt' | 'version'
>;

export interface RunbookListFilter {
  category?: string;
}

class RunbookManager {
  constructor() {
    // Seed lazily on first access to avoid touching the module load order.
  }

  private ensureSeeded() {
    seedBuiltins();
  }

  async create(data: NewRunbookInput): Promise<Runbook> {
    this.ensureSeeded();
    const now = Date.now();
    const id = rid('rb');
    const runbook: Runbook = {
      ...data,
      id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    runbookStore.set(id, runbook);
    return runbook;
  }

  async get(id: string): Promise<Runbook | null> {
    this.ensureSeeded();
    return runbookStore.get(id) ?? null;
  }

  async list(filter?: RunbookListFilter): Promise<Runbook[]> {
    this.ensureSeeded();
    const all = Array.from(runbookStore.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    if (!filter?.category) return all;
    return all.filter((r) => r.category === filter.category);
  }

  async update(id: string, updates: Partial<Runbook>): Promise<void> {
    this.ensureSeeded();
    const existing = runbookStore.get(id);
    if (!existing) return;
    const next: Runbook = {
      ...existing,
      ...updates,
      id,
      version: existing.version + 1,
      updatedAt: Date.now(),
    };
    runbookStore.set(id, next);
  }

  /**
   * Find runbooks that may apply to a given incident. Match by category
   * (component → category) plus a severity heuristic: SEV1 → incident/treasury,
   * SEV2 → settlement/treasury/incident, etc.
   */
  async findForIncident(
    component: string,
    severity: string,
  ): Promise<Runbook[]> {
    this.ensureSeeded();
    const all = Array.from(runbookStore.values());

    // Score each runbook: 1 point for category match, 1 point for severity
    // match in the name, 1 point for component match in the description.
    const comp = component.toLowerCase();
    const sev = severity.toUpperCase();
    const scored = all
      .map((rb) => {
        let score = 0;
        const name = rb.name.toLowerCase();
        const desc = rb.description.toLowerCase();
        if (name.includes(sev.toLowerCase())) score += 2;
        if (
          (comp === 'treasury' && rb.category === 'treasury') ||
          (comp === 'settlement' && rb.category === 'settlement') ||
          (comp === 'connectors' && rb.category === 'incident') ||
          (comp === 'runtime' && rb.category === 'incident') ||
          (comp === 'marketplace' && rb.category === 'treasury') ||
          (comp === 'database' && rb.category === 'migration')
        ) {
          score += 1;
        }
        if (desc.includes(comp)) score += 1;
        return { rb, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map((s) => s.rb);
  }

  /** Internal: reset the store (used in tests — not exposed via API). */
  _reset(): void {
    runbookStore.clear();
  }
}

export const runbookManager = new RunbookManager();
