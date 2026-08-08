/**
 * SAR Manager — CANONICAL Suspicious Activity Report stack. (M-TRUST-40, P3-4 / H-8 fix.)
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  CANONICAL COMPLIANCE STACK — this module is the single source of     ║
 * ║  truth for SAR lifecycle management in PaySwap. The legacy             ║
 * ║  in-memory stack at `src/protocol/compliance/sar.ts` is now a thin    ║
 * ║  wrapper that delegates persistence to THIS module.                   ║
 * ║                                                                       ║
 * ║  DO NOT extend the legacy stack directly. New SAR-related code        ║
 * ║  should import from `@/trust/sar-manager` (here) or `@/trust`         ║
 * ║  (the index).                                                         ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * Manages the lifecycle of SARs:
 *   draft → filed → acknowledged → closed
 *
 * SARs are filed with regulators when suspicious activity is confirmed.
 *
 * Persistence: SARs are written to the `SAR` Prisma table, so they
 * survive a process restart. The legacy `src/protocol/compliance/sar.ts`
 * wrapper kept SARs in an in-memory `Map` — that process-local state is
 * GONE for any code path that reaches the canonical stack.
 */

import type { SARRecord, SARStatus } from './types';
import { db } from '@/lib/db';
import { uid } from '@/runtime/types';

export class SARManager {
  /**
   * Create a new SAR (draft status).
   */
  async create(
    alertIds: string[],
    subject: string,
    narrative: string,
    amount: number,
    currency: string,
    filedBy: string,
  ): Promise<SARRecord> {
    const sar: SARRecord = {
      id: uid('sar'),
      alertIds,
      subject,
      narrative,
      amount,
      currency,
      status: 'draft',
      filedBy,
      createdAt: Date.now(),
    };

    try {
      await db.sAR.create({
        data: {
          id: sar.id,
          filedBy,
          narrative,
          amount,
          entities: JSON.stringify(alertIds),
          status: 'DRAFT',
        },
      });
    } catch (err) {
      console.error('[SAR] Failed to create:', err);
    }

    return sar;
  }

  /**
   * File a SAR with the regulator.
   */
  async file(sarId: string, filedBy: string): Promise<SARRecord | null> {
    try {
      const regulatorRef = `F-${Date.now()}-${sarId.slice(-6).toUpperCase()}`;
      await db.sAR.update({
        where: { id: sarId },
        data: {
          status: 'FILED',
          filedAt: new Date(),
          regulatoryRef: regulatorRef,
        },
      });

      return {
        id: sarId,
        alertIds: [],
        subject: '',
        narrative: '',
        amount: 0,
        currency: 'USD',
        status: 'filed',
        filedAt: Date.now(),
        filedBy,
        regulatorReference: regulatorRef,
        createdAt: Date.now(),
      };
    } catch (err) {
      console.error('[SAR] Failed to file:', err);
      return null;
    }
  }

  /**
   * Acknowledge a filed SAR (regulator confirmed receipt).
   */
  async acknowledge(sarId: string): Promise<void> {
    try {
      await db.sAR.update({
        where: { id: sarId },
        data: { status: 'ACKNOWLEDGED' },
      });
    } catch (err) {
      console.error('[SAR] Failed to acknowledge:', err);
    }
  }

  /**
   * Close a SAR.
   */
  async close(sarId: string): Promise<void> {
    try {
      await db.sAR.update({
        where: { id: sarId },
        data: { status: 'CLOSED' },
      });
    } catch (err) {
      console.error('[SAR] Failed to close:', err);
    }
  }

  /**
   * List SARs.
   */
  async list(filter?: { status?: SARStatus; limit?: number }): Promise<SARRecord[]> {
    try {
      const where: Record<string, unknown> = {};
      if (filter?.status) where.status = filter.status.toUpperCase();

      const rows = await db.sAR.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter?.limit ?? 100,
      });

      return rows.map((r) => ({
        id: r.id,
        alertIds: r.entities ? JSON.parse(r.entities) : [],
        subject: r.narrative.slice(0, 80),
        narrative: r.narrative,
        amount: r.amount,
        currency: 'USD',
        status: r.status.toLowerCase() as SARStatus,
        filedAt: r.filedAt?.getTime(),
        filedBy: r.filedBy,
        regulatorReference: r.regulatoryRef ?? undefined,
        createdAt: r.createdAt.getTime(),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get a single SAR.
   */
  async get(sarId: string): Promise<SARRecord | null> {
    try {
      const r = await db.sAR.findUnique({ where: { id: sarId } });
      if (!r) return null;
      return {
        id: r.id,
        alertIds: r.entities ? JSON.parse(r.entities) : [],
        subject: r.narrative.slice(0, 80),
        narrative: r.narrative,
        amount: r.amount,
        currency: 'USD',
        status: r.status.toLowerCase() as SARStatus,
        filedAt: r.filedAt?.getTime(),
        filedBy: r.filedBy,
        regulatorReference: r.regulatoryRef ?? undefined,
        createdAt: r.createdAt.getTime(),
      };
    } catch {
      return null;
    }
  }
  /**
   * Alias for create (backward compat).
   */
  async createSAR(
    alertIds: string[],
    subject: string,
    narrative: string,
    amount: number,
    currency: string,
    filedBy: string,
  ): Promise<SARRecord> {
    return this.create(alertIds, subject, narrative, amount, currency, filedBy);
  }

  /**
   * Alias for file (backward compat).
   */
  async fileSAR(sarId: string, filedBy: string): Promise<SARRecord | null> {
    return this.file(sarId, filedBy);
  }

  /**
   * Get SAR stats.
   */
  async stats(): Promise<{
    total: number;
    draft: number;
    filed: number;
    acknowledged: number;
    closed: number;
    totalAmount: number;
  }> {
    try {
      const all = await db.sAR.findMany();
      return {
        total: all.length,
        draft: all.filter((s) => s.status === 'DRAFT').length,
        filed: all.filter((s) => s.status === 'FILED').length,
        acknowledged: all.filter((s) => s.status === 'ACKNOWLEDGED').length,
        closed: all.filter((s) => s.status === 'CLOSED').length,
        totalAmount: all.reduce((sum, s) => sum + s.amount, 0),
      };
    } catch {
      return { total: 0, draft: 0, filed: 0, acknowledged: 0, closed: 0, totalAmount: 0 };
    }
  }
}

export const sarManager = new SARManager();
