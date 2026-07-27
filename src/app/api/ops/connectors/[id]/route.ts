import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { productionConnectorRegistry } from '@/protocol/connectors-v2/registry';
import {
  isConnectorPaused,
  setConnectorPaused,
} from '@/lib/connector-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPS_ROLES = new Set(['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']);

/**
 * PATCH /api/ops/connectors/[id]
 *
 * Pause or resume a production connector. Body:
 *   { action: 'pause' | 'resume' }
 *
 * Records the action in the AuditLog so SREs can trace when a connector was
 * taken offline. Returns the connector's current runtime status.
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

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: 'Connector ID is required' },
      { status: 400 },
    );
  }

  const connector = productionConnectorRegistry.get(id as any);
  if (!connector) {
    return NextResponse.json(
      { error: 'Connector not registered' },
      { status: 404 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action =
    typeof body?.action === 'string' ? body.action.trim().toLowerCase() : '';
  if (action !== 'pause' && action !== 'resume') {
    return NextResponse.json(
      { error: "action must be 'pause' or 'resume'" },
      { status: 400 },
    );
  }

  const previous = isConnectorPaused(id);
  const next = action === 'pause';
  if (previous === next) {
    return NextResponse.json(
      {
        error: `Connector is already ${next ? 'paused' : 'active'}`,
        connectorId: id,
        status: next ? 'PAUSED' : 'ACTIVE',
      },
      { status: 409 },
    );
  }
  setConnectorPaused(id, next);

  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: next ? 'OPS.CONNECTOR_PAUSE' : 'OPS.CONNECTOR_RESUME',
        resourceType: 'Connector',
        resourceId: id,
        result: 'SUCCESS',
        details: JSON.stringify({
          connectorId: id,
          connectorName: connector.config.name,
          previousStatus: previous ? 'PAUSED' : 'ACTIVE',
          nextStatus: next ? 'PAUSED' : 'ACTIVE',
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({
    connectorId: id,
    connectorName: connector.config.name,
    status: next ? 'PAUSED' : 'ACTIVE',
    paused: next,
  });
}
