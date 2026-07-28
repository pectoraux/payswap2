/**
 * GET  /api/identities/[id]/delegations — list delegations (from + to).
 * POST /api/identities/[id]/delegations — create a delegation.
 *
 * POST body:
 *   {
 *     toIdentityId: string,        // the identity receiving the delegation
 *     scope: string[],              // e.g., ['payments:write', 'payouts:read']
 *     limits?: {
 *       maxAmount?: number,
 *       currency?: string,
 *       dailyLimit?: number
 *     }
 *   }
 *
 * Both endpoints are admin-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { delegationManager, identityRegistry } from '@/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
  if (!isAdmin) return forbidden();

  const { id } = await params;
  if (!identityRegistry.getSync(id)) {
    return NextResponse.json({ error: 'Identity not found' }, { status: 404 });
  }

  const [from, to] = await Promise.all([
    delegationManager.listFrom(id),
    delegationManager.listTo(id),
  ]);
  return NextResponse.json({ from, to });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
  if (!isAdmin) return forbidden();

  const { id } = await params;
  if (!identityRegistry.getSync(id)) {
    return NextResponse.json({ error: 'Identity not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const toIdentityId = (body?.toIdentityId as string | undefined)?.trim();
  if (!toIdentityId) {
    return NextResponse.json({ error: 'toIdentityId is required' }, { status: 400 });
  }
  const scope = Array.isArray(body?.scope)
    ? (body.scope as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  if (scope.length === 0) {
    return NextResponse.json({ error: 'scope must be a non-empty array of strings' }, { status: 400 });
  }

  const limits = body?.limits && typeof body.limits === 'object'
    ? {
        maxAmount: typeof body.limits.maxAmount === 'number' ? body.limits.maxAmount : undefined,
        currency: typeof body.limits.currency === 'string' ? body.limits.currency : undefined,
        dailyLimit: typeof body.limits.dailyLimit === 'number' ? body.limits.dailyLimit : undefined,
      }
    : undefined;

  try {
    const dlg = await delegationManager.delegate(id, toIdentityId, scope, limits);
    return NextResponse.json({ ok: true, delegation: dlg });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to create delegation' }, { status: 400 });
  }
}
