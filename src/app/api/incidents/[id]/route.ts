import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPS_ROLES = new Set(['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']);

/**
 * GET /api/incidents/[id]
 *
 * Fetch a single incident with its full update timeline (newest-first) and
 * any audit-log entries that mention the incident ID in their `details` JSON.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => OPS_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: 'Incident ID is required' },
      { status: 400 },
    );
  }

  const incident = await db.incident.findUnique({
    where: { id },
    include: {
      updates: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!incident) {
    return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
  }

  // Related audit logs — entries whose `details` JSON mentions this incident ID.
  // We do a broad contains search then filter in JS for a precise match.
  const candidateLogs = await db.auditLog.findMany({
    where: {
      OR: [
        { resourceId: id },
        { details: { contains: id, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { user: true },
  });

  const relatedLogs = candidateLogs.filter((l) => {
    if (l.resourceId === id) return true;
    try {
      const d = JSON.parse(l.details ?? '{}');
      const json = JSON.stringify(d);
      return json.includes(id);
    } catch {
      return false;
    }
  });

  return NextResponse.json({ incident, relatedLogs });
}

const ACTIONS = new Set(['ASSIGN', 'ACKNOWLEDGE', 'RESOLVE', 'UPDATE_STATUS']);

/**
 * Map an action verb to the resulting incident status. RESOLVE → 'resolved',
 * ACKNOWLEDGE keeps the current status but stamps acknowledgedAt. ASSIGN keeps
 * the current status but stamps assignedTo. UPDATE_STATUS lets the caller pick
 * an explicit status via `status`.
 */
const STATUS_BY_ACTION: Record<string, string | undefined> = {
  ASSIGN: undefined,
  ACKNOWLEDGE: undefined,
  RESOLVE: 'resolved',
  UPDATE_STATUS: undefined,
};

const VALID_NEXT_STATUSES = new Set([
  'open',
  'investigating',
  'identified',
  'monitoring',
  'resolved',
]);

/**
 * PATCH /api/incidents/[id]
 *
 * Update an incident. Body:
 *   { action: 'ASSIGN' | 'ACKNOWLEDGE' | 'RESOLVE' | 'UPDATE_STATUS',
 *     assigneeId?: string,
 *     status?: string }
 *
 * Side effects:
 *   - ASSIGN: stamps `assignedTo` with the (optional) `assigneeId` or the
 *     current session's user id.
 *   - ACKNOWLEDGE: stamps `acknowledgedAt` (only if not already set).
 *   - RESOLVE: stamps `resolvedAt` and sets status to 'resolved'.
 *   - UPDATE_STATUS: sets `status` to a valid incident status.
 *
 * Each action records an AuditLog entry.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => OPS_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;
  const actorEmail = (session.user as any)?.email as string | undefined;

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: 'Incident ID is required' },
      { status: 400 },
    );
  }

  const existing = await db.incident.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action =
    typeof body?.action === 'string' ? body.action.trim().toUpperCase() : '';
  if (!ACTIONS.has(action)) {
    return NextResponse.json(
      {
        error:
          "action must be one of 'ASSIGN', 'ACKNOWLEDGE', 'RESOLVE', 'UPDATE_STATUS'",
      },
      { status: 400 },
    );
  }

  const patch: {
    assignedTo?: string | null;
    acknowledgedAt?: Date;
    resolvedAt?: Date;
    status?: string;
  } = {};

  const auditAction = `INCIDENT.${action}`;
  const auditDetails: Record<string, any> = {
    action,
    previousStatus: existing.status,
  };

  if (action === 'ASSIGN') {
    const assigneeId =
      typeof body?.assigneeId === 'string' && body.assigneeId.trim()
        ? body.assigneeId.trim()
        : userId;
    if (!assigneeId) {
      return NextResponse.json(
        { error: 'Cannot determine assignee' },
        { status: 400 },
      );
    }
    patch.assignedTo = assigneeId;
    auditDetails.assignedTo = assigneeId;
  } else if (action === 'ACKNOWLEDGE') {
    if (!existing.acknowledgedAt) {
      patch.acknowledgedAt = new Date();
    }
    auditDetails.acknowledgedAt = patch.acknowledgedAt ?? existing.acknowledgedAt;
  } else if (action === 'RESOLVE') {
    patch.resolvedAt = new Date();
    patch.status = 'resolved';
    auditDetails.resolvedAt = patch.resolvedAt;
    auditDetails.nextStatus = 'resolved';
  } else if (action === 'UPDATE_STATUS') {
    const next =
      typeof body?.status === 'string' ? body.status.trim().toLowerCase() : '';
    if (!VALID_NEXT_STATUSES.has(next)) {
      return NextResponse.json(
        { error: `status must be one of: ${[...VALID_NEXT_STATUSES].join(', ')}` },
        { status: 400 },
      );
    }
    patch.status = next;
    auditDetails.nextStatus = next;
    if (next === 'resolved' && !existing.resolvedAt) {
      patch.resolvedAt = new Date();
      auditDetails.resolvedAt = patch.resolvedAt;
    }
  }

  // Apply the patch — STATUS_BY_ACTION is unused at runtime but kept for
  // documentation of the action→status mapping.
  void STATUS_BY_ACTION;

  const updated = await db.incident.update({
    where: { id },
    data: patch,
    include: {
      updates: { orderBy: { createdAt: 'asc' } },
    },
  });

  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: auditAction,
        resourceType: 'Incident',
        resourceId: id,
        result: 'SUCCESS',
        details: JSON.stringify({
          ...auditDetails,
          actorEmail: actorEmail ?? null,
          incidentTitle: existing.title,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ incident: updated });
}
