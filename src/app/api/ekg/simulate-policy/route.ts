import { NextRequest, NextResponse } from 'next/server';
import { simulatePolicyChange, type PolicyChange } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PHASE 7: Policy Simulator. Given a hypothetical policy change, simulate
 * which goals would pass/fail — WITHOUT committing the change.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const change: PolicyChange = {
    type: (body?.type as 'ADD' | 'MODIFY' | 'REMOVE') ?? 'ADD',
    policyId: typeof body?.policyId === 'string' ? body.policyId : undefined,
    capabilityId: typeof body?.capabilityId === 'string' ? body.capabilityId : undefined,
    rule: typeof body?.rule === 'string' ? body.rule : undefined,
    enforcement: (body?.enforcement as 'BLOCK' | 'WARN' | 'REQUIRE_APPROVAL') ?? 'BLOCK',
    description: typeof body?.description === 'string' ? body.description : undefined,
  };

  const result = simulatePolicyChange(change);
  return NextResponse.json(result, { status: 201 });
}
