import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth, parseJsonBody, auditOps } from '@/ops/api-auth';
import { opsEngine } from '@/ops';
import type { IncidentSeverity } from '@/ops/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SEVERITIES = new Set<IncidentSeverity>([
  'SEV1',
  'SEV2',
  'SEV3',
  'SEV4',
]);

/**
 * GET /api/ops/incidents — list incidents (M-OPS-42 SEV* notation).
 *
 * Query params:
 *   - status: 'open' | 'investigating' | 'identified' | 'monitoring' | 'resolved' | 'postmortem'
 *   - severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'
 *   - component: any string (e.g. "runtime", "treasury")
 */
export async function GET(req: NextRequest) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? undefined;
  const severity = url.searchParams.get('severity') ?? undefined;
  const component = url.searchParams.get('component') ?? undefined;

  const incidents = await opsEngine.incidents.list({ status, severity, component });
  return NextResponse.json({ incidents });
}

/**
 * POST /api/ops/incidents — create a new incident.
 *
 * Body:
 *   { title, description?, severity?, component?, createdBy?, affectedMerchants? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;
  const parsed = await parseJsonBody<{
    title?: string;
    description?: string;
    severity?: string;
    component?: string;
    createdBy?: string;
    affectedMerchants?: string[];
  }>(req);
  if (!parsed.ok) return parsed.response;

  const { body } = parsed;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json(
      { error: 'title is required' },
      { status: 400 },
    );
  }
  const severity =
    typeof body.severity === 'string' && VALID_SEVERITIES.has(body.severity.toUpperCase() as IncidentSeverity)
      ? (body.severity.toUpperCase() as IncidentSeverity)
      : 'SEV2';
  const component = typeof body.component === 'string' && body.component.trim()
    ? body.component.trim().toLowerCase()
    : 'runtime';
  const description =
    typeof body.description === 'string' ? body.description.trim() : '';
  const createdBy = body.createdBy ?? auth.ctx.userId;
  const affectedMerchants = Array.isArray(body.affectedMerchants)
    ? body.affectedMerchants.filter((m): m is string => typeof m === 'string')
    : [];

  const incident = await opsEngine.incidents.create({
    title,
    description,
    severity,
    status: 'open',
    component,
    createdBy,
    affectedMerchants,
  });

  await auditOps(
    auth.ctx,
    'OPS.INCIDENT_CREATE',
    {
      incidentId: incident.id,
      title,
      severity,
      component,
    },
    incident.id,
  );

  return NextResponse.json({ incident }, { status: 201 });
}
