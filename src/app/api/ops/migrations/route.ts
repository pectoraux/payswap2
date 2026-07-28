import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, parseJsonBody, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES = new Set(['schema', 'data', 'code', 'config']);

/**
 * GET /api/ops/migrations — list migrations.
 *
 * Query params:
 *   - status: planned | in_progress | completed | rolled_back | failed
 *   - active: '1' — return only the active migration
 */
export async function GET(req: NextRequest) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  if (url.searchParams.get('active') === '1') {
    const active = await opsEngine.migrations.getActive();
    return NextResponse.json({ active });
  }
  const status = url.searchParams.get('status') ?? undefined;
  const migrations = await opsEngine.migrations.list({ status });
  return NextResponse.json({ migrations });
}

/**
 * POST /api/ops/migrations — plan a new migration.
 *
 * Body:
 *   { name, description, type, version, rollbackPlan, startedBy?, steps: [{ order, description }] }
 */
export async function POST(req: NextRequest) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;
  const parsed = await parseJsonBody<{
    name?: string;
    description?: string;
    type?: string;
    version?: string;
    rollbackPlan?: string;
    startedBy?: string;
    steps?: Array<{ order: number; description: string }>;
  }>(req);
  if (!parsed.ok) return parsed.response;

  const { body } = parsed;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const type =
    typeof body.type === 'string' && VALID_TYPES.has(body.type)
      ? (body.type as 'schema' | 'data' | 'code' | 'config')
      : null;
  if (!type) {
    return NextResponse.json(
      { error: `type must be one of: ${[...VALID_TYPES].join(', ')}` },
      { status: 400 },
    );
  }
  const version =
    typeof body.version === 'string' && body.version.trim()
      ? body.version.trim()
      : '';
  if (!version) {
    return NextResponse.json(
      { error: 'version is required' },
      { status: 400 },
    );
  }
  const rollbackPlan =
    typeof body.rollbackPlan === 'string' ? body.rollbackPlan.trim() : '';
  if (!rollbackPlan) {
    return NextResponse.json(
      { error: 'rollbackPlan is required' },
      { status: 400 },
    );
  }
  const description =
    typeof body.description === 'string' ? body.description.trim() : '';
  const startedBy =
    typeof body.startedBy === 'string' && body.startedBy.trim()
      ? body.startedBy.trim()
      : auth.ctx.userId;
  const steps = Array.isArray(body.steps)
    ? body.steps
        .map((s) => ({
          order: Number(s.order),
          description: String(s.description ?? '').trim(),
        }))
        .filter((s) => Number.isFinite(s.order) && s.description)
        .sort((a, b) => a.order - b.order)
    : [];
  if (steps.length === 0) {
    return NextResponse.json(
      { error: 'at least one step is required' },
      { status: 400 },
    );
  }

  const migration = await opsEngine.migrations.plan({
    name,
    description,
    type,
    version,
    rollbackPlan,
    startedBy,
    steps,
  });
  await auditOps(
    auth.ctx,
    'OPS.MIGRATION_PLAN',
    { migrationId: migration.id, name, type, version },
    migration.id,
  );
  return NextResponse.json({ migration }, { status: 201 });
}
