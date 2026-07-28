import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, parseJsonBody, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUS = new Set([
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
]);
const VALID_IMPACT = new Set(['none', 'minor', 'major', 'outage']);

/**
 * GET /api/ops/maintenance — list maintenance windows.
 *
 * Query params:
 *   - status: scheduled | in_progress | completed | cancelled
 *   - component: any string
 *   - upcoming: '1' — return only upcoming windows
 *   - active: '1' — return only the active window
 */
export async function GET(req: NextRequest) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  if (url.searchParams.get('active') === '1') {
    const active = await opsEngine.maintenance.getActive();
    return NextResponse.json({ active });
  }
  if (url.searchParams.get('upcoming') === '1') {
    const upcoming = await opsEngine.maintenance.getUpcoming();
    return NextResponse.json({ upcoming });
  }
  const status = url.searchParams.get('status') ?? undefined;
  const component = url.searchParams.get('component') ?? undefined;
  if (status && !VALID_STATUS.has(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...VALID_STATUS].join(', ')}` },
      { status: 400 },
    );
  }
  const windows = await opsEngine.maintenance.list({ status, component });
  return NextResponse.json({ windows });
}

/**
 * POST /api/ops/maintenance — schedule a new maintenance window.
 *
 * Body: { title, description, component, startAt, endAt, impact }
 */
export async function POST(req: NextRequest) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;
  const parsed = await parseJsonBody<{
    title?: string;
    description?: string;
    component?: string;
    startAt?: number;
    endAt?: number;
    impact?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;

  const { body } = parsed;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const component =
    typeof body.component === 'string' && body.component.trim()
      ? body.component.trim().toLowerCase()
      : 'runtime';
  const startAt = Number(body.startAt);
  const endAt = Number(body.endAt);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
    return NextResponse.json(
      { error: 'startAt and endAt must be numbers (ms epoch)' },
      { status: 400 },
    );
  }
  if (startAt >= endAt) {
    return NextResponse.json(
      { error: 'startAt must be < endAt' },
      { status: 400 },
    );
  }
  const impact =
    typeof body.impact === 'string' && VALID_IMPACT.has(body.impact)
      ? (body.impact as 'none' | 'minor' | 'major' | 'outage')
      : 'none';
  const description =
    typeof body.description === 'string' ? body.description.trim() : '';

  const window = await opsEngine.maintenance.schedule(
    {
      title,
      description,
      component,
      startAt,
      endAt,
      impact,
    },
    auth.ctx.userId,
  );
  await auditOps(
    auth.ctx,
    'OPS.MAINTENANCE_SCHEDULE',
    { windowId: window.id, title, component, impact },
    window.id,
  );
  return NextResponse.json({ window }, { status: 201 });
}
