/**
 * GET /api/identities/[id] — identity detail.
 *
 * Returns the full identity record (with credentials, attestations,
 * delegations, recovery methods). Credentials are returned WITHOUT their
 * `secretHash` field (public-safe).
 *
 * Admin-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { identityRegistry, delegationManager, recoveryManager } from '@/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
  if (!isAdmin) return forbidden();

  const { id } = await params;
  const identity = identityRegistry.getSync(id);
  if (!identity) {
    return NextResponse.json({ error: 'Identity not found' }, { status: 404 });
  }

  // Delegations FROM this identity (who they delegated to) and TO this
  // identity (who can act on their behalf).
  const [delegationsFrom, delegationsTo, recoveryMethods] = await Promise.all([
    delegationManager.listFrom(id),
    delegationManager.listTo(id),
    recoveryManager.list(id),
  ]);

  // Strip secret hashes from credentials before returning.
  const safeCredentials = identity.credentials.map(({ secretHash: _sh, ...rest }) => rest);

  return NextResponse.json({
    identity: {
      ...identity,
      credentials: safeCredentials,
      delegationsFrom,
      delegationsTo,
      recoveryMethods,
    },
  });
}
