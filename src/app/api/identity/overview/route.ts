/**
 * GET /api/identity/overview — Identity OS dashboard overview.
 *
 * Returns aggregate counts: total identities, breakdown by type / trust
 * level / status, plus counts of credentials / attestations / delegations /
 * recovery methods / proofs.
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { identityEngine } from '@/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
  if (!isAdmin) return forbidden();

  const overview = identityEngine.overview();
  return NextResponse.json({ overview });
}
