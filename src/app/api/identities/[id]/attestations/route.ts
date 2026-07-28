/**
 * GET  /api/identities/[id]/attestations — list attestations for an identity.
 * POST /api/identities/[id]/attestations — create an attestation.
 *
 * POST body:
 *   {
 *     type: 'identity' | 'address' | 'income' | 'business' | 'sanctions_clear' | 'pep_clear' | 'credit_score' | 'custom',
 *     attesterIdentityId: string,    // the identity making the attestation
 *     value: string,                  // the attested value
 *     confidence?: number,            // 0-100, default 80
 *     validUntil?: number,            // optional expiry (ms epoch)
 *     evidence?: string               // URL or hash of evidence
 *   }
 *
 * Both endpoints are admin-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { attestationService, identityRegistry } from '@/identity';
import type { AttestationType } from '@/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES: AttestationType[] = [
  'identity', 'address', 'income', 'business',
  'sanctions_clear', 'pep_clear', 'credit_score', 'custom',
];

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
  const attestations = await attestationService.list(id);
  return NextResponse.json({ attestations });
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
  const type = body?.type as AttestationType;
  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid attestation type' }, { status: 400 });
  }
  const attesterIdentityId = (body?.attesterIdentityId as string | undefined)?.trim();
  if (!attesterIdentityId) {
    return NextResponse.json({ error: 'attesterIdentityId is required' }, { status: 400 });
  }
  const value = (body?.value as string | undefined)?.trim();
  if (!value) {
    return NextResponse.json({ error: 'value is required' }, { status: 400 });
  }

  try {
    const att = await attestationService.create(attesterIdentityId, id, {
      type,
      value,
      confidence: typeof body?.confidence === 'number' ? body.confidence : undefined,
      validUntil: typeof body?.validUntil === 'number' ? body.validUntil : undefined,
      evidence: body?.evidence as string | undefined,
    });
    return NextResponse.json({ ok: true, attestation: att });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to create attestation' }, { status: 400 });
  }
}
