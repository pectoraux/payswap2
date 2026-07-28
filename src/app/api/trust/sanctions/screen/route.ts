import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sanctionsScreener, complianceAuditTrail } from '@/trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

/**
 * POST /api/trust/sanctions/screen
 *
 * Screen one or more names against the sanctions lists.
 *
 * Body:
 *   { name: string, entityId?: string }
 *   — or —
 *   { entities: [{ name: string, id: string }, ...] }
 *
 * Returns the screenings (and full match metadata).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => COMPLIANCE_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let screenings;
  if (Array.isArray(body?.entities)) {
    const entities = body.entities
      .filter(
        (e: any) =>
          e && typeof e.name === 'string' && typeof e.id === 'string',
      )
      .map((e: any) => ({ name: e.name as string, id: e.id as string }));
    if (entities.length === 0) {
      return NextResponse.json(
        { error: 'entities must be a non-empty array of {name, id}' },
        { status: 400 },
      );
    }
    screenings = await sanctionsScreener.screenBatch(entities);
  } else if (
    typeof body?.name === 'string' &&
    typeof body?.entityId === 'string'
  ) {
    screenings = [await sanctionsScreener.screen(body.name, body.entityId)];
  } else {
    return NextResponse.json(
      {
        error:
          'Provide { name, entityId } or { entities: [{name, id}, ...] }',
      },
      { status: 400 },
    );
  }

  await complianceAuditTrail.record({
    action: 'trust.sanctions.screen',
    actorId: userId ?? 'unknown',
    entityType: 'screening_batch',
    entityId: screenings.map((s) => s.id).join(','),
    details: {
      count: screenings.length,
      hits: screenings.filter((s) => s.status === 'pending').length,
    },
    result: 'success',
  });

  return NextResponse.json({ screenings }, { status: 201 });
}
