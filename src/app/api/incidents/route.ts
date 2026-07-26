import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPS_ROLES = new Set(['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']);

const VALID_SEVERITIES = new Set(['P1', 'P2', 'P3', 'P4']);
const VALID_COMPONENTS = new Set([
  'api',
  'payments',
  'payouts',
  'webhooks',
  'connectors',
  'blockchain',
]);

/**
 * GET /api/incidents
 *
 * List incidents. Optional query params:
 *   - status: 'open' | 'resolved' (or any exact status value)
 *   - severity: 'P1' | 'P2' | 'P3' | 'P4'
 *
 * Returns incidents newest-first, capped at 200.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => OPS_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status')?.trim().toLowerCase();
  const severityParam = url.searchParams.get('severity')?.trim().toUpperCase();

  const where: Prisma.IncidentWhereInput = {};
  if (statusParam === 'open') {
    // "open" = anything not resolved
    where.NOT = { status: 'resolved' };
  } else if (statusParam === 'resolved') {
    where.status = 'resolved';
  } else if (statusParam) {
    where.status = statusParam;
  }
  if (severityParam && VALID_SEVERITIES.has(severityParam)) {
    where.severity = severityParam;
  }

  const incidents = await db.incident.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      updates: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  return NextResponse.json({ incidents });
}

/**
 * POST /api/incidents
 *
 * Create a new incident. Body:
 *   { title, description?, severity?, component? }
 *
 * Requires OPERATIONS or ADMIN role. The `createdBy` field is set from the
 * authenticated session's user ID. Records an AuditLog entry so incident
 * creation is traceable.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => OPS_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json(
      { error: 'title is required' },
      { status: 400 },
    );
  }

  const description =
    typeof body?.description === 'string' && body.description.trim()
      ? body.description.trim()
      : null;

  const severity =
    typeof body?.severity === 'string' && VALID_SEVERITIES.has(body.severity.toUpperCase())
      ? body.severity.toUpperCase()
      : 'P2';

  const component =
    typeof body?.component === 'string' && VALID_COMPONENTS.has(body.component.toLowerCase())
      ? body.component.toLowerCase()
      : null;

  if (!userId) {
    return NextResponse.json({ error: 'Session missing user id' }, { status: 400 });
  }

  const incident = await db.incident.create({
    data: {
      title,
      description,
      severity,
      status: 'open',
      component,
      createdBy: userId,
    },
  });

  try {
    await db.auditLog.create({
      data: {
        userId,
        action: 'INCIDENT.CREATE',
        resourceType: 'Incident',
        resourceId: incident.id,
        result: 'SUCCESS',
        details: JSON.stringify({
          title,
          severity,
          component,
          status: 'open',
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ incident }, { status: 201 });
}
