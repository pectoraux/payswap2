import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPS_ROLES = new Set(['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']);

const VALID_UPDATE_STATUSES = new Set([
  'investigating',
  'identified',
  'monitoring',
  'resolved',
]);

/**
 * POST /api/incidents/[id]/updates
 *
 * Append a new update to an incident's timeline. Body:
 *   { message: string, status?: string }
 *
 * When `status` is provided (and valid) the incident's own status is updated
 * to match the update's status. When `status='resolved'`, the incident's
 * `resolvedAt` is stamped (only if not already set).
 *
 * Requires OPERATIONS or ADMIN role. Records an AuditLog entry.
 */
export async function POST(
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

  const message =
    typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return NextResponse.json(
      { error: 'message is required' },
      { status: 400 },
    );
  }

  const statusRaw =
    typeof body?.status === 'string' ? body.status.trim().toLowerCase() : '';
  const status = VALID_UPDATE_STATUSES.has(statusRaw) ? statusRaw : 'investigating';

  if (!userId) {
    return NextResponse.json({ error: 'Session missing user id' }, { status: 400 });
  }

  // Create the update + flip the incident's status atomically.
  const [update] = await db.$transaction([
    db.incidentUpdate.create({
      data: {
        incidentId: id,
        authorId: userId,
        message,
        status,
      },
    }),
    db.incident.update({
      where: { id },
      data: {
        status,
        ...(status === 'resolved' && !existing.resolvedAt
          ? { resolvedAt: new Date() }
          : {}),
      },
    }),
  ]);

  try {
    await db.auditLog.create({
      data: {
        userId,
        action: 'INCIDENT.UPDATE',
        resourceType: 'Incident',
        resourceId: id,
        result: 'SUCCESS',
        details: JSON.stringify({
          updateId: update.id,
          status,
          messagePreview: message.slice(0, 120),
          actorEmail: actorEmail ?? null,
          previousStatus: existing.status,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ update }, { status: 201 });
}
