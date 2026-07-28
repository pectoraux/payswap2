/**
 * Compliance Audit Trail — immutable log of all compliance actions. (M-TRUST-40.)
 */

import type { ComplianceAuditEntry, AuditFilter } from './types';
import { db } from '@/lib/db';
import { uid } from '@/runtime/types';

export class ComplianceAuditTrail {
  /**
   * Record a compliance audit event.
   */
  async record(event: {
    action: string;
    actorId: string;
    entityType: string;
    entityId: string;
    details: Record<string, unknown>;
    result?: string;
  }): Promise<ComplianceAuditEntry> {
    const entry: ComplianceAuditEntry = {
      id: uid('aud'),
      action: event.action,
      actorId: event.actorId,
      entityType: event.entityType as ComplianceAuditEntry['entityType'],
      entityId: event.entityId,
      details: event.details,
      timestamp: Date.now(),
    };

    try {
      await db.auditLog.create({
        data: {
          id: entry.id,
          userId: event.actorId,
          action: event.action,
          resourceType: event.entityType,
          resourceId: event.entityId,
          result: event.result ?? 'SUCCESS',
          details: JSON.stringify(event.details),
        },
      });
    } catch (err) {
      console.error('[AuditTrail] Failed to record:', err);
    }

    return entry;
  }

  /**
   * Query the audit trail.
   */
  async query(filter: AuditFilter): Promise<ComplianceAuditEntry[]> {
    try {
      const where: Record<string, unknown> = {};
      if (filter.action) where.action = filter.action;
      if (filter.actorId) where.userId = filter.actorId;
      if (filter.entityType) where.resourceType = filter.entityType;
      if (filter.entityId) where.resourceId = filter.entityId;
      if (filter.from || filter.to) {
        const createdAt: { gte?: Date; lte?: Date } = {};
        if (filter.from) createdAt.gte = new Date(filter.from);
        if (filter.to) createdAt.lte = new Date(filter.to);
        where.createdAt = createdAt;
      }

      const rows = await db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter.limit ?? 100,
      });

      return rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorId: r.userId ?? 'unknown',
        entityType: r.resourceType as ComplianceAuditEntry['entityType'],
        entityId: r.resourceId ?? '',
        details: r.details ? JSON.parse(r.details) : {},
        result: r.result,
        timestamp: r.createdAt.getTime(),
        createdAt: r.createdAt.getTime(),
      })) as ComplianceAuditEntry[];
    } catch {
      return [];
    }
  }

  /**
   * Get audit stats.
   */
  async stats(): Promise<{ total: number; success: number; denied: number; error: number }> {
    try {
      const all = await db.auditLog.findMany();
      return {
        total: all.length,
        success: all.filter((a) => a.result === 'SUCCESS').length,
        denied: all.filter((a) => a.result === 'DENIED').length,
        error: all.filter((a) => a.result === 'ERROR').length,
      };
    } catch {
      return { total: 0, success: 0, denied: 0, error: 0 };
    }
  }
}

export const complianceAuditTrail = new ComplianceAuditTrail();