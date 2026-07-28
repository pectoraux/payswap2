/**
 * PaySwap Cloud — Deployment Manager. (M-CLOUD-44.)
 *
 * Each tenant can have multiple deployments (sandbox / staging / production).
 * A deployment represents an isolated PaySwap kernel instance running in a
 * specific region with its own URL, version, health status, and logs.
 *
 * The deployment manager simulates the deploy / stop / restart lifecycle
 * in-memory (no actual container orchestration is performed — this is the
 * demo environment). The lifecycle is fast enough that the admin console
 * shows realistic state transitions.
 */

import type {
  CloudDeployment,
  CloudDeploymentEnvironment,
  CloudDeploymentHealth,
  CloudDeploymentStatus,
  CloudLogEntry,
} from './types';
import { store, ids } from './store';
import { cloudAudit } from './audit';

const KERNEL_VERSION = '1.0.0-cloud';
const MAX_LOGS = 200;

export interface DeployInput {
  environment: CloudDeploymentEnvironment;
  region?: string;
  version?: string;
}

class DeploymentManager {
  /** Deploy a new (or re-deploy an existing) environment for a tenant. */
  async deploy(
    tenantId: string,
    environment: CloudDeploymentEnvironment,
    actorId?: string,
  ): Promise<CloudDeployment> {
    const tenant = store.tenants.get(tenantId);
    if (!tenant) throw new Error('Tenant not found');

    // If a deployment already exists for this (tenant, environment), recycle it.
    const existing = Array.from(store.deployments.values()).find(
      (d) => d.tenantId === tenantId && d.environment === environment,
    );
    if (existing) {
      existing.status = 'deploying';
      existing.deployedAt = Date.now();
      existing.version = KERNEL_VERSION;
      pushLog(existing, 'info', `redeploy triggered (env=${environment})`);
      await cloudAudit.record({
        tenantId,
        actorId: actorId ?? 'system',
        action: 'deployment.redeployed',
        resourceId: existing.id,
        resourceType: 'deployment',
        details: { environment },
      });
      // Simulate deploy completion
      setTimeout(() => {
        existing.status = 'running';
        existing.health = 'healthy';
        pushLog(existing, 'info', 'deployment complete — health checks passing');
      }, 50);
      return existing;
    }

    const deploymentId = ids.deployment();
    const now = Date.now();
    const deployment: CloudDeployment = {
      id: deploymentId,
      tenantId,
      environment,
      region: tenant.region,
      status: 'deploying',
      version: KERNEL_VERSION,
      url: `https://${tenant.slug}-${environment}.payswap.cloud`,
      deployedAt: now,
      health: 'degraded',
      logs: [
        { timestamp: now, level: 'info', message: `deployment initiated (env=${environment}, region=${tenant.region})` },
        { timestamp: now, level: 'info', message: 'pulling kernel image payswap/kernel:1.0.0-cloud' },
      ],
      config: envDefaults(environment),
    };
    store.deployments.set(deploymentId, deployment);

    await cloudAudit.record({
      tenantId,
      actorId: actorId ?? 'system',
      action: 'deployment.deployed',
      resourceId: deploymentId,
      resourceType: 'deployment',
      details: { environment, region: tenant.region, version: KERNEL_VERSION, url: deployment.url },
    });

    // Simulate deploy completion (50ms is below one event-loop tick + a few
    // ticks for the console — the UI will likely see 'running' on the first
    // refetch).
    setTimeout(() => {
      const d = store.deployments.get(deploymentId);
      if (!d) return;
      d.status = 'running';
      d.health = 'healthy';
      pushLog(d, 'info', 'deployment complete — health checks passing');
      pushLog(d, 'info', 'kernel booted in 1.4s');
      pushLog(d, 'info', 'dispatcher subscribed to 290 event types');
    }, 50);

    return deployment;
  }

  /** Get a deployment by ID. */
  async getDeployment(deploymentId: string): Promise<CloudDeployment | null> {
    return store.deployments.get(deploymentId) ?? null;
  }

  /** List deployments for a tenant (newest first). */
  async listForTenant(tenantId: string): Promise<CloudDeployment[]> {
    return Array.from(store.deployments.values())
      .filter((d) => d.tenantId === tenantId)
      .sort((a, b) => b.deployedAt - a.deployedAt);
  }

  /** Stop a running deployment. */
  async stop(deploymentId: string, actorId?: string): Promise<void> {
    const d = store.deployments.get(deploymentId);
    if (!d) return;
    d.status = 'stopped';
    d.health = 'down';
    pushLog(d, 'warn', 'deployment stopped by operator');
    await cloudAudit.record({
      tenantId: d.tenantId,
      actorId: actorId ?? 'system',
      action: 'deployment.stopped',
      resourceId: deploymentId,
      resourceType: 'deployment',
      details: { environment: d.environment },
    });
  }

  /** Restart a deployment (stop + start). */
  async restart(deploymentId: string, actorId?: string): Promise<void> {
    const d = store.deployments.get(deploymentId);
    if (!d) return;
    d.status = 'deploying';
    d.health = 'degraded';
    pushLog(d, 'info', 'restart initiated');
    await cloudAudit.record({
      tenantId: d.tenantId,
      actorId: actorId ?? 'system',
      action: 'deployment.restarted',
      resourceId: deploymentId,
      resourceType: 'deployment',
      details: { environment: d.environment },
    });
    setTimeout(() => {
      const cur = store.deployments.get(deploymentId);
      if (!cur) return;
      cur.status = 'running';
      cur.health = 'healthy';
      pushLog(cur, 'info', 'restart complete — health checks passing');
    }, 50);
  }

  /** Run (or simulate) a health check and return the current health. */
  async checkHealth(deploymentId: string): Promise<CloudDeploymentHealth> {
    const d = store.deployments.get(deploymentId);
    if (!d) return 'down';
    // In production this would call the deployment's /healthz endpoint.
    // Here we derive health from status.
    if (d.status === 'stopped' || d.status === 'failed') {
      d.health = 'down';
    } else if (d.status === 'deploying') {
      d.health = 'degraded';
    } else {
      // running — keep whatever health was set (seeded values vary)
      if (d.health === 'down') d.health = 'degraded';
    }
    return d.health;
  }

  /** Get recent logs (most-recent-first when limit set). */
  async getLogs(deploymentId: string, limit?: number): Promise<string[]> {
    const d = store.deployments.get(deploymentId);
    if (!d) return [];
    const lines = d.logs.map((l) => `[${new Date(l.timestamp).toISOString()}] ${l.level.toUpperCase()} ${l.message}`);
    if (limit && lines.length > limit) {
      return lines.slice(-limit).reverse();
    }
    return lines.reverse();
  }

  /** Append a log entry (used internally and exposed for tests). */
  appendLog(deploymentId: string, level: CloudLogEntry['level'], message: string): void {
    const d = store.deployments.get(deploymentId);
    if (!d) return;
    pushLog(d, level, message);
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function pushLog(d: CloudDeployment, level: CloudLogEntry['level'], message: string): void {
  d.logs.push({ timestamp: Date.now(), level, message });
  if (d.logs.length > MAX_LOGS) {
    d.logs.splice(0, d.logs.length - MAX_LOGS);
  }
}

function envDefaults(env: CloudDeploymentEnvironment): CloudDeployment['config'] {
  switch (env) {
    case 'production':
      return { replicas: 3, cpuMillicores: 2000, memoryMB: 4096, storageGB: 100 };
    case 'staging':
      return { replicas: 2, cpuMillicores: 1000, memoryMB: 2048, storageGB: 50 };
    case 'sandbox':
      return { replicas: 1, cpuMillicores: 500, memoryMB: 1024, storageGB: 10 };
  }
}

export const deploymentManager = new DeploymentManager();

// Re-export status type for the API layer.
export type { CloudDeploymentStatus };
