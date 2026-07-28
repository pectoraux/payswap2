/**
 * POST /api/identities/[id]/revoke — revoke an identity (terminal state).
 *
 * Body: { reason: string }
 *
 * Admin-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { identityRegistry } from '@/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const body = await req.json().catch(() => ({}));
  const reason = (body?.reason as string) ?? 'Revoked by admin';

  const identity = identityRegistry.getSync(id);
  if (!identity) {
    return NextResponse.json({ error: 'Identity not found' }, { status: 404 });
  }

  await identityRegistry.revoke(id, reason);
  return NextResponse.json({ ok: true });
}
