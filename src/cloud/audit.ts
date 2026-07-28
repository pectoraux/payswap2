/**
 * PaySwap Cloud — Audit Log. (M-CLOUD-44.)
 *
 * Records every administrative action on a tenant. Separate from the runtime
 * audit trail (which records transaction-level events) — this log tracks
 * cloud-platform actions: tenant created/suspended, member added/removed,
 * program lifecycle, deployment operations, billing changes.
 */

import type { CloudAuditEntry } from './types';
import { store, ids } from './store';

export interface AuditFilter {
  action?: string;
  actorId?: string;
  resourceType?: string;
  tenantId?: string;
  since?: number;
  until?: number;
}

class CloudAudit {
  /** Record a new audit entry. */
  async record(
    entry: Omit<CloudAuditEntry, 'id' | 'timestamp'> & { timestamp?: number },
  ): Promise<void> {
    const full: CloudAuditEntry = {
      id: ids.audit(),
      timestamp: entry.timestamp ?? Date.now(),
      tenantId: entry.tenantId,
      actorId: entry.actorId,
      action: entry.action,
      resourceId: entry.resourceId,
      resourceType: entry.resourceType,
      details: entry.details ?? {},
    };
    store.audit.set(full.id, full);
  }

  /** Query audit entries for a tenant. */
  async query(
    tenantId: string,
    filter?: AuditFilter,
  ): Promise<CloudAuditEntry[]> {
    const all = Array.from(store.audit.values()).filter(
      (e) => e.tenantId === tenantId,
    );
    if (!filter) {
      return all.sort((a, b) => b.timestamp - a.timestamp);
    }
    return all
      .filter((e) => {
        if (filter.action && e.action !== filter.action) return false;
        if (filter.actorId && e.actorId !== filter.actorId) return false;
        if (filter.resourceType && e.resourceType !== filter.resourceType) return false;
        if (filter.since && e.timestamp < filter.since) return false;
        if (filter.until && e.timestamp > filter.until) return false;
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Cross-tenant query (admin only). */
  async queryAll(filter?: AuditFilter): Promise<CloudAuditEntry[]> {
    const all = Array.from(store.audit.values());
    if (!filter) return all.sort((a, b) => b.timestamp - a.timestamp);
    return all
      .filter((e) => {
        if (filter.action && e.action !== filter.action) return false;
        if (filter.actorId && e.actorId !== filter.actorId) return false;
        if (filter.resourceType && e.resourceType !== filter.resourceType) return false;
        if (filter.tenantId && e.tenantId !== filter.tenantId) return false;
        if (filter.since && e.timestamp < filter.since) return false;
        if (filter.until && e.timestamp > filter.until) return false;
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Count entries for a tenant. */
  async count(tenantId: string): Promise<number> {
    return Array.from(store.audit.values()).filter((e) => e.tenantId === tenantId).length;
  }
}

export const cloudAudit = new CloudAudit();
