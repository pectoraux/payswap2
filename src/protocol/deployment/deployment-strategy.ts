/**
 * PaySwap Protocol — Deployment — Deployment Strategy Service.
 *
 * Owns the lifecycle of in-flight deployments and exposes three
 * strategies:
 *
 *   - `blue_green` — deploy to the inactive environment, switch traffic
 *                    atomically, keep the old environment as a fallback
 *                    for instant rollback.
 *   - `canary`     — deploy to a small percentage of traffic, monitor,
 *                    increase the percentage gradually. Each promote()
 *                    call bumps the canary weight; rollback() drops it
 *                    to 0.
 *   - `rolling`    — replace instances one batch at a time. Promote()
 *                    advances the batch; rollback() reverts to the
 *                    previous version.
 *
 * Every deployment goes through: `started` → `promoted` (one or more
 * times) → `completed` (or `rolled_back`).
 *
 * Events emitted on the kernel `eventEngine`:
 *   - `deployment.started`
 *   - `deployment.promoted`
 *   - `deployment.rolled_back`
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`. No kernel
 * files are modified.
 */
import { eventEngine } from '@/kernel/event';
import { uid, nowTs } from '@/kernel/support';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The three supported deployment strategies. */
export type DeploymentStrategy = 'blue_green' | 'canary' | 'rolling';

/** The lifecycle status of a single deployment. */
export type DeploymentStatus =
  | 'started'
  | 'in_progress'
  | 'promoted'
  | 'completed'
  | 'rolled_back'
  | 'failed';

/** The current blue-green environment colour. */
export type BlueGreenEnvironment = 'blue' | 'green';

/** Per-strategy configuration passed to `startDeployment`. */
export interface DeploymentConfig {
  /** Image tag / version string to deploy (e.g. `payswap:v1.2.3`). */
  image: string;
  /** Target replicas for the new version. */
  replicas?: number;
  /** Canary: initial traffic percentage (default 10). */
  canaryInitialPct?: number;
  /** Canary: percentage increment per promote() call (default 25). */
  canaryIncrementPct?: number;
  /** Rolling: batch size as a percentage of replicas (default 25 = 25%). */
  rollingBatchPct?: number;
  /** Health-check URL (relative path) used to verify the new version. */
  healthCheckPath?: string;
  /** Optional annotations to attach to the deployment record. */
  annotations?: Record<string, string>;
}

/** A single deployment record. */
export interface DeploymentRecord {
  id: string;
  strategy: DeploymentStrategy;
  version: string;
  config: DeploymentConfig;
  status: DeploymentStatus;
  startedAt: number;
  completedAt: number | null;
  /** For blue_green: which environment is receiving the new version. */
  targetEnvironment?: BlueGreenEnvironment;
  /** For blue_green: the environment that was live before this deployment. */
  previousEnvironment?: BlueGreenEnvironment;
  /** For canary: the current canary traffic percentage (0..100). */
  canaryPct?: number;
  /** For rolling: the percentage of replicas that have been rolled (0..100). */
  rolledPct?: number;
  /** Promote history — each entry records the ts + state snapshot. */
  history: DeploymentHistoryEntry[];
  /** Final reason (set on completion / rollback / failure). */
  reason?: string;
}

export interface DeploymentHistoryEntry {
  ts: number;
  action: 'started' | 'promoted' | 'rolled_back' | 'completed' | 'failed';
  fromStatus: DeploymentStatus;
  toStatus: DeploymentStatus;
  details: Record<string, unknown>;
}

/**
 * Result of a `promote` / `rollback` / `status` call — discriminated
 * union so callers can branch on `ok`.
 */
export type DeploymentResult =
  | { ok: true; deployment: DeploymentRecord }
  | { ok: false; error: string; deploymentId: string };

// ---------------------------------------------------------------------------
// DeploymentService
// ---------------------------------------------------------------------------

/**
 * Deployment strategy service. Owns the active + historical deployment
 * records. Singleton via `globalThis.__PAYSWAP_DEPLOYMENT_SERVICE`.
 */
export class DeploymentService {
  private deployments = new Map<string, DeploymentRecord>();
  /** Active deployments keyed by workload name (e.g. `payswap`). */
  private activeByWorkload = new Map<string, string>();
  /** Current blue-green environment per workload. */
  private liveEnvironment = new Map<string, BlueGreenEnvironment>();
  private readonly MAX_HISTORY = 200;

  /**
   * Start a new deployment for the given workload.
   *
   *  - `blue_green`: pick the inactive environment (default `green`),
   *    mark it as the target.
   *  - `canary`: set `canaryPct = config.canaryInitialPct ?? 10`.
   *  - `rolling`: set `rolledPct = 0` (nothing rolled yet).
   *
   * Emits `deployment.started`.
   */
  startDeployment(
    workload: string,
    strategy: DeploymentStrategy,
    version: string,
    config: DeploymentConfig,
  ): DeploymentRecord {
    const id = uid('dep');
    const ts = nowTs();

    let targetEnv: BlueGreenEnvironment | undefined;
    let previousEnv: BlueGreenEnvironment | undefined;
    let canaryPct: number | undefined;
    let rolledPct: number | undefined;

    if (strategy === 'blue_green') {
      previousEnv = this.liveEnvironment.get(workload) ?? 'blue';
      targetEnv = previousEnv === 'blue' ? 'green' : 'blue';
    } else if (strategy === 'canary') {
      canaryPct = config.canaryInitialPct ?? 10;
    } else if (strategy === 'rolling') {
      rolledPct = 0;
    }

    const record: DeploymentRecord = {
      id,
      strategy,
      version,
      config: { ...config, annotations: { ...(config.annotations ?? {}) } },
      status: 'started',
      startedAt: ts,
      completedAt: null,
      targetEnvironment: targetEnv,
      previousEnvironment: previousEnv,
      canaryPct,
      rolledPct,
      history: [
        {
          ts,
          action: 'started',
          fromStatus: 'started',
          toStatus: 'started',
          details: { workload, strategy, version, config },
        },
      ],
    };

    this.deployments.set(id, record);
    this.activeByWorkload.set(workload, id);
    this.trimHistory();

    eventEngine.emit('deployment.started', {
      deploymentId: id,
      workload,
      strategy,
      version,
      config,
    });

    return this.clone(record);
  }

  /**
   * Promote a deployment to the next stage.
   *
   *  - `blue_green`: flip the live environment to the target. The old
   *    environment is kept running as a fallback.
   *  - `canary`: increase `canaryPct` by `config.canaryIncrementPct`.
   *    At 100%, the deployment is auto-completed.
   *  - `rolling`: advance `rolledPct` by `config.rollingBatchPct`.
   *    At 100%, the deployment is auto-completed.
   *
   * Emits `deployment.promoted`.
   */
  promoteDeployment(deploymentId: string, workload?: string): DeploymentResult {
    const record = this.deployments.get(deploymentId);
    if (!record) {
      return { ok: false, error: `deployment '${deploymentId}' not found`, deploymentId };
    }
    if (record.status === 'completed' || record.status === 'rolled_back' || record.status === 'failed') {
      return {
        ok: false,
        error: `deployment '${deploymentId}' is already ${record.status}`,
        deploymentId,
      };
    }

    const ts = nowTs();
    const previousStatus = record.status;

    if (record.strategy === 'blue_green') {
      // Flip live environment.
      if (record.targetEnvironment && workload) {
        this.liveEnvironment.set(workload, record.targetEnvironment);
      }
      record.status = 'promoted';
      record.history.push({
        ts,
        action: 'promoted',
        fromStatus: previousStatus,
        toStatus: 'promoted',
        details: {
          targetEnvironment: record.targetEnvironment,
          previousEnvironment: record.previousEnvironment,
        },
      });
      // Blue-green promotes complete immediately after the flip.
      record.status = 'completed';
      record.completedAt = ts;
      record.history.push({
        ts,
        action: 'completed',
        fromStatus: 'promoted',
        toStatus: 'completed',
        details: { liveEnvironment: record.targetEnvironment },
      });
    } else if (record.strategy === 'canary') {
      const increment = record.config.canaryIncrementPct ?? 25;
      record.canaryPct = Math.min(100, (record.canaryPct ?? 0) + increment);
      record.status = record.canaryPct >= 100 ? 'completed' : 'promoted';
      record.history.push({
        ts,
        action: 'promoted',
        fromStatus: previousStatus,
        toStatus: record.status,
        details: { canaryPct: record.canaryPct },
      });
      if (record.status === 'completed') {
        record.completedAt = ts;
        record.history.push({
          ts,
          action: 'completed',
          fromStatus: 'promoted',
          toStatus: 'completed',
          details: { canaryPct: record.canaryPct },
        });
      }
    } else if (record.strategy === 'rolling') {
      const batch = record.config.rollingBatchPct ?? 25;
      record.rolledPct = Math.min(100, (record.rolledPct ?? 0) + batch);
      record.status = record.rolledPct >= 100 ? 'completed' : 'promoted';
      record.history.push({
        ts,
        action: 'promoted',
        fromStatus: previousStatus,
        toStatus: record.status,
        details: { rolledPct: record.rolledPct },
      });
      if (record.status === 'completed') {
        record.completedAt = ts;
        record.history.push({
          ts,
          action: 'completed',
          fromStatus: 'promoted',
          toStatus: 'completed',
          details: { rolledPct: record.rolledPct },
        });
      }
    }

    eventEngine.emit('deployment.promoted', {
      deploymentId: record.id,
      strategy: record.strategy,
      status: record.status,
      canaryPct: record.canaryPct,
      rolledPct: record.rolledPct,
      targetEnvironment: record.targetEnvironment,
    });

    return { ok: true, deployment: this.clone(record) };
  }

  /**
   * Roll back a deployment.
   *
   *  - `blue_green`: flip the live environment back to the previous
   *    environment (kept running as fallback).
   *  - `canary`: drop canaryPct to 0.
   *  - `rolling`: mark rolledPct as reverted (no live action — the
   *    previous version is still running on the un-rolled instances).
   *
   * Emits `deployment.rolled_back`.
   */
  rollbackDeployment(deploymentId: string, workload?: string): DeploymentResult {
    const record = this.deployments.get(deploymentId);
    if (!record) {
      return { ok: false, error: `deployment '${deploymentId}' not found`, deploymentId };
    }
    if (record.status === 'rolled_back') {
      return {
        ok: false,
        error: `deployment '${deploymentId}' is already rolled back`,
        deploymentId,
      };
    }

    const ts = nowTs();
    const previousStatus = record.status;

    if (record.strategy === 'blue_green' && record.previousEnvironment && workload) {
      // Flip back to the previous environment.
      this.liveEnvironment.set(workload, record.previousEnvironment);
      record.reason = `rolled back to ${record.previousEnvironment}`;
    } else if (record.strategy === 'canary') {
      record.canaryPct = 0;
      record.reason = 'canary traffic dropped to 0';
    } else if (record.strategy === 'rolling') {
      record.reason = 'rolling update reverted — previous version still serving un-rolled instances';
    }

    record.status = 'rolled_back';
    record.completedAt = ts;
    record.history.push({
      ts,
      action: 'rolled_back',
      fromStatus: previousStatus,
      toStatus: 'rolled_back',
      details: { reason: record.reason },
    });

    eventEngine.emit('deployment.rolled_back', {
      deploymentId: record.id,
      strategy: record.strategy,
      reason: record.reason,
    });

    return { ok: true, deployment: this.clone(record) };
  }

  /**
   * Get the current status of a deployment (snapshot). Returns null if
   * the deployment id is unknown.
   */
  getDeploymentStatus(deploymentId: string): DeploymentRecord | null {
    const record = this.deployments.get(deploymentId);
    return record ? this.clone(record) : null;
  }

  /**
   * All active (non-completed, non-rolled-back, non-failed) deployments.
   */
  getActiveDeployments(): DeploymentRecord[] {
    const out: DeploymentRecord[] = [];
    for (const record of this.deployments.values()) {
      if (
        record.status === 'started' ||
        record.status === 'in_progress' ||
        record.status === 'promoted'
      ) {
        out.push(this.clone(record));
      }
    }
    return out;
  }

  /** All deployments (active + historical), most-recent-first. */
  getAllDeployments(): DeploymentRecord[] {
    return [...this.deployments.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((r) => this.clone(r));
  }

  /**
   * Mark a deployment as failed (e.g. health checks never passed).
   * Emits `deployment.rolled_back` with `reason: 'failed'` so listeners
   * treat it as a rollback-equivalent.
   */
  failDeployment(deploymentId: string, reason: string): DeploymentResult {
    const record = this.deployments.get(deploymentId);
    if (!record) {
      return { ok: false, error: `deployment '${deploymentId}' not found`, deploymentId };
    }
    const ts = nowTs();
    const previousStatus = record.status;
    record.status = 'failed';
    record.completedAt = ts;
    record.reason = reason;
    record.history.push({
      ts,
      action: 'failed',
      fromStatus: previousStatus,
      toStatus: 'failed',
      details: { reason },
    });
    eventEngine.emit('deployment.rolled_back', {
      deploymentId: record.id,
      strategy: record.strategy,
      reason: `failed: ${reason}`,
    });
    return { ok: true, deployment: this.clone(record) };
  }

  /** Current live environment for a workload (blue-green only). */
  getLiveEnvironment(workload: string): BlueGreenEnvironment | undefined {
    return this.liveEnvironment.get(workload);
  }

  /** Defensive clone so callers can't mutate internal state. */
  private clone(record: DeploymentRecord): DeploymentRecord {
    return {
      ...record,
      config: {
        ...record.config,
        annotations: { ...(record.config.annotations ?? {}) },
      },
      history: record.history.map((h) => ({ ...h, details: { ...h.details } })),
    };
  }

  /** Trim history to the last MAX_HISTORY deployments (FIFO eviction). */
  private trimHistory(): void {
    if (this.deployments.size <= this.MAX_HISTORY) return;
    const sorted = [...this.deployments.values()].sort((a, b) => a.startedAt - b.startedAt);
    const toRemove = sorted.slice(0, sorted.length - this.MAX_HISTORY);
    for (const record of toRemove) {
      this.deployments.delete(record.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForDeployment = globalThis as unknown as {
  __PAYSWAP_DEPLOYMENT_SERVICE?: DeploymentService;
};

export const deploymentService =
  _globalForDeployment.__PAYSWAP_DEPLOYMENT_SERVICE ?? new DeploymentService();

if (!_globalForDeployment.__PAYSWAP_DEPLOYMENT_SERVICE) {
  _globalForDeployment.__PAYSWAP_DEPLOYMENT_SERVICE = deploymentService;
}
