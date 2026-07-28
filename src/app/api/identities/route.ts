/**
 * GET /api/identities — list identities.
 *
 * Optional filters:
 *   ?type=person|merchant|lp|organization|government|wallet|ai_agent|device
 *   ?trustLevel=unverified|verified|trusted|privileged
 *   ?status=active|suspended|revoked
 *   ?q=<name substring>
 *
 * Admin-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { identityEngine, identityRegistry } from '@/identity';
import type { IdentityType, IdentityStatus, TrustLevel } from '@/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES: IdentityType[] = [
  'person', 'merchant', 'lp', 'organization', 'government', 'wallet', 'ai_agent', 'device',
];
const VALID_TRUST: TrustLevel[] = ['unverified', 'verified', 'trusted', 'privileged'];
const VALID_STATUS: IdentityStatus[] = ['active', 'suspended', 'revoked'];

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
  if (!isAdmin) return forbidden();

  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const typeParam = url.searchParams.get('type');
  const trustParam = url.searchParams.get('trustLevel');
  const statusParam = url.searchParams.get('status');

  const type = typeParam && VALID_TYPES.includes(typeParam as IdentityType)
    ? (typeParam as IdentityType) : undefined;
  const trustLevel = trustParam && VALID_TRUST.includes(trustParam as TrustLevel)
    ? (trustParam as TrustLevel) : undefined;
  const status = statusParam && VALID_STATUS.includes(statusParam as IdentityStatus)
    ? (statusParam as IdentityStatus) : undefined;

  let identities = identityRegistry.list({ type, trustLevel, status });

  if (q.trim()) {
    const lower = q.trim().toLowerCase();
    identities = identities.filter((i) => i.name.toLowerCase().includes(lower));
  }

  // Sort newest first.
  identities.sort((a, b) => b.createdAt - a.createdAt);

  // Public-safe projection: strip secretHash from credentials.
  const safe = identities.map((i) => ({
    id: i.id,
    type: i.type,
    name: i.name,
    entityId: i.entityId,
    entityType: i.entityType,
    trustScore: i.trustScore,
    trustLevel: i.trustLevel,
    status: i.status,
    credentialCount: i.credentials.length,
    attestationCount: i.attestations.length,
    delegationCount: i.delegations.length,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  }));

  return NextResponse.json({
    count: safe.length,
    overview: identityEngine.overview(),
    identities: safe,
  });
}
