/**
 * SCALE-3: Leader-elected scheduler for periodic tasks.
 *
 * The 3 timers (net settlement cycle, drift monitor scan, checkpoint
 * manager) must run on EXACTLY ONE instance. If they run on multiple
 * instances, the work is duplicated — three concurrent `settle()` calls
 * on one corridor is a triple settlement.
 *
 * This module provides a DB-backed advisory lock pattern:
 *   - `acquireLeadership(taskName)` — tries to acquire a lease on the task.
 *     Returns true if this instance is the leader, false otherwise.
 *   - `withLeadership(taskName, fn)` — runs `fn` only if this instance is
 *     the leader. Non-leaders skip silently.
 *   - `releaseLeadership(taskName)` — releases the lease (on shutdown).
 *
 * The lease has a TTL (default 60 seconds). If the leader crashes, another
 * instance acquires the lease after the TTL expires. The leader renews the
 * lease before it expires.
 *
 * Production alternatives: pg-advisory-lock, Redis SET NX, a dedicated
 * job queue (BullMQ, Temporal). This implementation uses a Postgres table
 * so it works with the existing infrastructure.
 */

import { db } from '@/lib/db';
import { eventEngine } from '@/kernel/event';
import { nowTs, uid } from '@/kernel/support';

const DEFAULT_LEASE_TTL_MS = 60 * 1000; // 60 seconds
const DEFAULT_RENEW_BEFORE_MS = 10 * 1000; // renew 10s before expiry

interface LeadershipLease {
  taskName: string;
  leaderId: string;
  acquiredAt: number;
  expiresAt: number;
}

const instanceId = uid('inst');

/**
 * Try to acquire leadership for a task. Returns true if this instance is
 * now the leader (either it just acquired the lease or it already holds it).
 *
 * The lease is acquired atomically via an upsert with a conditional — only
 * acquire if the current lease has expired or is held by this instance.
 */
export async function acquireLeadership(
  taskName: string,
  ttlMs: number = DEFAULT_LEASE_TTL_MS,
): Promise<boolean> {
  const now = nowTs();
  const expiresAt = now + ttlMs;

  try {
    // Try to upsert the lease. The WHERE condition ensures we only take
    // over if the current lease has expired or is ours.
    const existing = await db.leadershipLease.findUnique({
      where: { taskName },
    });

    if (!existing) {
      // No existing lease — create one.
      await db.leadershipLease.create({
        data: {
          taskName,
          leaderId: instanceId,
          acquiredAt: new Date(now),
          expiresAt: new Date(expiresAt),
        },
      });
      eventEngine.emit('leadership.acquired', { taskName, leaderId: instanceId, ts: now });
      return true;
    }

    if (existing.leaderId === instanceId) {
      // We already hold the lease — renew it.
      await db.leadershipLease.update({
        where: { taskName },
        data: { expiresAt: new Date(expiresAt) },
      });
      return true;
    }

    // Another instance holds the lease — check if it's expired.
    if (existing.expiresAt.getTime() < now) {
      // Lease expired — try to take over. Use updateMany with a condition
      // to avoid a race condition with another instance trying the same.
      const result = await db.leadershipLease.updateMany({
        where: {
          taskName,
          leaderId: existing.leaderId, // only if still the old leader
          expiresAt: { lt: new Date(now) }, // only if expired
        },
        data: {
          leaderId: instanceId,
          acquiredAt: new Date(now),
          expiresAt: new Date(expiresAt),
        },
      });

      if (result.count > 0) {
        eventEngine.emit('leadership.acquired', { taskName, leaderId: instanceId, ts: now });
        return true;
      }
      // Another instance beat us to it.
      return false;
    }

    // Lease is still valid and held by another instance.
    return false;
  } catch {
    // DB error — assume we're not the leader (safe default).
    return false;
  }
}

/**
 * Run a function only if this instance is the leader for the task.
 * Non-leaders skip silently. The lease is renewed before it expires.
 *
 * Usage:
 *   setInterval(async () => {
 *     await withLeadership('net-settlement-cycle', async () => {
 *       runNetSettlementCycle();
 *     });
 *   }, 5 * 60 * 1000);
 */
export async function withLeadership<T>(
  taskName: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number } = {},
): Promise<{ ran: boolean; result?: T }> {
  const isLeader = await acquireLeadership(taskName, opts.ttlMs);
  if (!isLeader) {
    return { ran: false };
  }

  try {
    const result = await fn();
    // Renew the lease after the task completes (extends the leadership).
    await acquireLeadership(taskName, opts.ttlMs);
    return { ran: true, result };
  } catch (err) {
    eventEngine.emit('leadership.task_failed', {
      taskName,
      leaderId: instanceId,
      error: err instanceof Error ? err.message : 'unknown',
      ts: nowTs(),
    });
    // Don't release leadership on task failure — the task may succeed on
    // the next tick. The lease will expire if this instance crashes.
    return { ran: true };
  }
}

/**
 * Release leadership for a task (on graceful shutdown).
 */
export async function releaseLeadership(taskName: string): Promise<void> {
  try {
    await db.leadershipLease.deleteMany({
      where: {
        taskName,
        leaderId: instanceId,
      },
    });
    eventEngine.emit('leadership.released', { taskName, leaderId: instanceId, ts: nowTs() });
  } catch {
    // Best-effort.
  }
}

/**
 * Get the current leadership status for all tasks (for the dashboard).
 */
export async function getLeadershipStatus(): Promise<Array<{ taskName: string; leaderId: string; expiresAt: number; isExpired: boolean }>> {
  try {
    const leases = await db.leadershipLease.findMany();
    const now = nowTs();
    return leases.map(l => ({
      taskName: l.taskName,
      leaderId: l.leaderId,
      expiresAt: l.expiresAt.getTime(),
      isExpired: l.expiresAt.getTime() < now,
    }));
  } catch {
    return [];
  }
}

/**
 * Get this instance's ID (for debugging).
 */
export function getInstanceId(): string {
  return instanceId;
}
