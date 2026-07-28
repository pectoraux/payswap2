/**
 * POST /api/identities/[id]/delegations/[delegationId]/revoke — revoke a delegation.
 *
 * Body (optional): { reason: string }
 *
 * Admin-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { delegationManager } from '@/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; delegationId: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
  if (!isAdmin) return forbidden();

  const { delegationId } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = (body?.reason as string | undefined) ?? 'Revoked by admin';
  await delegationManager.revoke(delegationId, reason);
  return NextResponse.json({ ok: true });
}
