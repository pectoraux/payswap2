/**
 * IncidentManager — manages the lifecycle of operational incidents.
 *
 * Backed by the existing Prisma `Incident` + `IncidentUpdate` models. Maps
 * the DB's P1–P4 severity notation to the M-OPS-42 SEV1–SEV4 notation at
 * the boundary. Updates, assignment, acknowledgement, resolution and
 * postmortem transitions are all recorded as IncidentUpdate entries so the
 * full timeline is durable.
 */

import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import type {
  IncidentSeverity,
  IncidentStatus,
  OpsIncident,
} from './types';

// ─── Severity mapping (Prisma P1–P4 ↔ Ops SEV1–SEV4) ──────────────────────

const SEV_TO_P: Record<IncidentSeverity, string> = {
  SEV1: 'P1',
  SEV2: 'P2',
  SEV3: 'P3',
  SEV4: 'P4',
};

const P_TO_SEV: Record<string, IncidentSeverity> = {
  P1: 'SEV1',
  P2: 'SEV2',
  P3: 'SEV3',
  P4: 'SEV4',
};

function toSev(p: string | null | undefined): IncidentSeverity {
  return P_TO_SEV[(p ?? 'P2').toUpperCase()] ?? 'SEV2';
}

function toStatus(s: string | null | undefined): IncidentStatus {
  const v = (s ?? 'open').toLowerCase();
  if (
    v === 'open' ||
    v === 'investigating' ||
    v === 'identified' ||
    v === 'monitoring' ||
    v === 'resolved' ||
    v === 'postmortem'
  ) {
    return v;
  }
  return 'open';
}

// ─── Helpers ──────────────────────────────────────────────────────────────

type IncidentWithUpdates = Prisma.IncidentGetPayload<{
  include: { updates: true };
}>;

function toOpsIncident(row: IncidentWithUpdates): OpsIncident {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    severity: toSev(row.severity),
    status: toStatus(row.status),
    component: row.component ?? 'runtime',
    createdBy: row.createdBy ?? 'system',
    assignedTo: row.assignedTo ?? undefined,
    acknowledgedAt: row.acknowledgedAt?.getTime() ?? undefined,
    resolvedAt: row.resolvedAt?.getTime() ?? undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    updates: (row.updates ?? []).map((u) => ({
      id: u.id,
      incidentId: u.incidentId,
      authorId: u.authorId ?? 'system',
      message: u.message,
      status: u.status ? toStatus(u.status) : undefined,
      createdAt: u.createdAt.getTime(),
    })),
    // affectedMerchants/rootCause/remediation are stored in a side-channel
    // (in-memory annotation map) — see notes below. The Prisma schema does
    // not have dedicated columns for these in v1.
    affectedMerchants: affectedMerchantsMap.get(row.id) ?? [],
    rootCause: annotationMap.get(row.id)?.rootCause,
    remediation: annotationMap.get(row.id)?.remediation,
  };
}

/**
 * In-memory side-channel for fields that don't have a Prisma column in v1
 * (affectedMerchants, rootCause, remediation). Per the M-OPS-42 spec the
 * other ops domains are also in-memory, so this is consistent with the
 * rest of the Operations OS.
 */
const annotationMap = new Map<
  string,
  { rootCause?: string; remediation?: string }
>();
const affectedMerchantsMap = new Map<string, string[]>();

export type NewIncidentInput = Omit<
  OpsIncident,
  'id' | 'createdAt' | 'updatedAt' | 'updates'
>;

export interface IncidentListFilter {
  severity?: string;
  status?: string;
  component?: string;
}

export interface IncidentStats {
  total: number;
  open: number;
  bySeverity: Record<string, number>;
  avgResolutionTimeMs: number;
}

class IncidentManager {
  /**
   * Create a new incident. `createdBy` defaults to "system" if not
   * provided. The incident is persisted to the Prisma `Incident` table and
   * an initial IncidentUpdate is recorded with the description.
   */
  async create(data: NewIncidentInput): Promise<OpsIncident> {
    const now = new Date();
    const severity = data.severity ?? 'SEV2';
    const status: IncidentStatus = data.status ?? 'open';
    if (data.affectedMerchants?.length) {
      affectedMerchantsMap.set('__pending__', data.affectedMerchants);
    }
    const created = await db.incident.create({
      data: {
        title: data.title,
        description: data.description || null,
        severity: SEV_TO_P[severity] ?? 'P2',
        status,
        component: data.component || null,
        createdBy: data.createdBy || 'system',
        assignedTo: data.assignedTo || null,
        acknowledgedAt: data.acknowledgedAt
          ? new Date(data.acknowledgedAt)
          : null,
        resolvedAt: data.resolvedAt ? new Date(data.resolvedAt) : null,
        updates: data.description
          ? {
              create: {
                authorId: data.createdBy || 'system',
                message: data.description,
                status,
              },
            }
          : undefined,
      },
      include: { updates: { orderBy: { createdAt: 'asc' } } },
    });
    if (data.affectedMerchants?.length) {
      affectedMerchantsMap.delete('__pending__');
      affectedMerchantsMap.set(created.id, data.affectedMerchants);
    }
    if (data.rootCause || data.remediation) {
      annotationMap.set(created.id, {
        rootCause: data.rootCause,
        remediation: data.remediation,
      });
    }
    return toOpsIncident(created);
  }

  /** Get a single incident by id, including its full update timeline. */
  async get(id: string): Promise<OpsIncident | null> {
    const row = await db.incident.findUnique({
      where: { id },
      include: { updates: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) return null;
    return toOpsIncident(row);
  }

  /** List incidents, optionally filtered by severity/status/component. */
  async list(filter?: IncidentListFilter): Promise<OpsIncident[]> {
    const where: {
      severity?: string;
      status?: string;
      component?: string;
      NOT?: { status: string };
    } = {};
    if (filter?.severity) {
      const sev = filter.severity.toUpperCase();
      if (sev.startsWith('SEV') && SEV_TO_P[sev as IncidentSeverity]) {
        where.severity = SEV_TO_P[sev as IncidentSeverity];
      } else if (P_TO_SEV[sev]) {
        where.severity = sev;
      }
    }
    if (filter?.status) {
      const s = filter.status.toLowerCase();
      if (s === 'open') {
        where.NOT = { status: 'resolved' };
      } else {
        where.status = s;
      }
    }
    if (filter?.component) {
      where.component = filter.component.toLowerCase();
    }
    const rows = await db.incident.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { updates: { orderBy: { createdAt: 'asc' } } },
    });
    return rows.map(toOpsIncident);
  }

  /**
   * Apply a partial update. Does NOT record a timeline entry — use
   * `addUpdate` for that. Used internally by assign/acknowledge/resolve.
   */
  async update(id: string, updates: Partial<OpsIncident>): Promise<void> {
    const patch: {
      title?: string;
      description?: string;
      severity?: string;
      status?: string;
      component?: string;
      assignedTo?: string | null;
      acknowledgedAt?: Date;
      resolvedAt?: Date;
    } = {};
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.description !== undefined)
      patch.description = updates.description;
    if (updates.severity !== undefined && SEV_TO_P[updates.severity])
      patch.severity = SEV_TO_P[updates.severity];
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.component !== undefined)
      patch.component = updates.component ?? null;
    if (updates.assignedTo !== undefined)
      patch.assignedTo = updates.assignedTo ?? null;
    if (updates.acknowledgedAt !== undefined)
      patch.acknowledgedAt = new Date(updates.acknowledgedAt);
    if (updates.resolvedAt !== undefined)
      patch.resolvedAt = new Date(updates.resolvedAt);
    if (updates.affectedMerchants !== undefined) {
      affectedMerchantsMap.set(id, updates.affectedMerchants);
    }
    if (updates.rootCause !== undefined || updates.remediation !== undefined) {
      const existing = annotationMap.get(id) ?? {};
      annotationMap.set(id, {
        rootCause: updates.rootCause ?? existing.rootCause,
        remediation: updates.remediation ?? existing.remediation,
      });
    }
    await db.incident.update({ where: { id }, data: patch });
  }

  /**
   * Add a timeline update. If `status` is provided, the incident's status
   * is also updated. The update is persisted to the `IncidentUpdate` table.
   */
  async addUpdate(
    incidentId: string,
    authorId: string,
    message: string,
    status?: IncidentStatus,
  ): Promise<void> {
    const patch: { status?: string } = {};
    if (status) patch.status = status;
    await db.incident.update({
      where: { id: incidentId },
      data: {
        ...patch,
        updates: {
          create: {
            authorId: authorId || 'system',
            message,
            status: status ?? undefined,
          },
        },
      },
    });
  }

  /** Assign the incident to a user (defaults to "system"). */
  async assign(incidentId: string, assigneeId: string): Promise<void> {
    await db.incident.update({
      where: { id: incidentId },
      data: { assignedTo: assigneeId },
    });
    await this.addUpdate(
      incidentId,
      assigneeId,
      `Incident assigned to ${assigneeId}.`,
    );
  }

  /** Mark the incident as acknowledged by `userId`. */
  async acknowledge(incidentId: string, userId: string): Promise<void> {
    const existing = await db.incident.findUnique({
      where: { id: incidentId },
      select: { acknowledgedAt: true },
    });
    if (!existing) return;
    await db.incident.update({
      where: { id: incidentId },
      data: {
        acknowledgedAt: existing.acknowledgedAt ?? new Date(),
        assignedTo: userId,
      },
    });
    await this.addUpdate(
      incidentId,
      userId,
      `Incident acknowledged by ${userId}.`,
      'investigating',
    );
  }

  /**
   * Resolve the incident. Records the root cause + remediation in the
   * in-memory annotation map (Prisma has no dedicated columns in v1) and
   * appends a timeline update with both fields.
   */
  async resolve(
    incidentId: string,
    rootCause: string,
    remediation: string,
  ): Promise<void> {
    const now = new Date();
    annotationMap.set(incidentId, { rootCause, remediation });
    await db.incident.update({
      where: { id: incidentId },
      data: { status: 'resolved', resolvedAt: now },
    });
    await this.addUpdate(
      incidentId,
      'system',
      `Incident resolved.\nRoot cause: ${rootCause}\nRemediation: ${remediation}`,
      'resolved',
    );
  }

  /**
   * Move an already-resolved incident into the postmortem state. The
   * postmortem itself is authored externally (e.g. as an Investigation
   * linked to this incident).
   */
  async startPostmortem(incidentId: string): Promise<void> {
    await db.incident.update({
      where: { id: incidentId },
      data: { status: 'postmortem' },
    });
    await this.addUpdate(
      incidentId,
      'system',
      'Postmortem drafting started.',
      'postmortem',
    );
  }

  /** Aggregate stats for the dashboard. */
  async getStats(): Promise<IncidentStats> {
    const [total, openRows, allOpen, resolvedRows] = await Promise.all([
      db.incident.count(),
      db.incident.count({ where: { status: { not: 'resolved' } } }),
      db.incident.findMany({
        where: { status: { not: 'resolved' } },
        select: { severity: true },
      }),
      db.incident.findMany({
        where: {
          status: 'resolved',
          resolvedAt: { not: null },
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
        select: { createdAt: true, resolvedAt: true },
      }),
    ]);

    const bySeverity: Record<string, number> = {
      SEV1: 0,
      SEV2: 0,
      SEV3: 0,
      SEV4: 0,
    };
    for (const r of allOpen) {
      const sev = toSev(r.severity);
      bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    }

    let avgResolutionTimeMs = 0;
    if (resolvedRows.length > 0) {
      const totalMs = resolvedRows.reduce((sum, r) => {
        if (!r.resolvedAt) return sum;
        return sum + (r.resolvedAt.getTime() - r.createdAt.getTime());
      }, 0);
      avgResolutionTimeMs = Math.round(totalMs / resolvedRows.length);
    }

    return { total, open: openRows, bySeverity, avgResolutionTimeMs };
  }
}

export const incidentManager = new IncidentManager();
export { SEV_TO_P, P_TO_SEV };
