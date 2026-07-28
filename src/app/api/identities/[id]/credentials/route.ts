/**
 * GET  /api/identities/[id]/credentials — list credentials for an identity.
 * POST /api/identities/[id]/credentials — add a credential to an identity.
 *
 * Both endpoints are admin-only. Credentials are returned without their
 * `secretHash` field (public-safe).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { credentialManager, identityRegistry } from '@/identity';
import type { CredentialType } from '@/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES: CredentialType[] = [
  'password', 'api_key', 'oauth', 'certificate', 'biometric', 'hardware_key',
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

  const credentials = await credentialManager.list(id);
  // Strip secretHash.
  const safe = credentials.map(({ secretHash: _sh, ...rest }) => rest);
  return NextResponse.json({ credentials: safe });
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
  const type = body?.type as CredentialType;
  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid credential type' }, { status: 400 });
  }
  const identifier = (body?.identifier as string | undefined)?.trim();
  if (!identifier) {
    return NextResponse.json({ error: 'identifier is required' }, { status: 400 });
  }

  try {
    const cred = await credentialManager.add(id, {
      type,
      identifier,
      verified: body?.verified === true,
      secret: body?.secret as string | undefined,
      expiresAt: typeof body?.expiresAt === 'number' ? body.expiresAt : undefined,
    });
    const { secretHash: _sh, ...safe } = cred;
    return NextResponse.json({ ok: true, credential: safe });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to add credential' }, { status: 500 });
  }
}
