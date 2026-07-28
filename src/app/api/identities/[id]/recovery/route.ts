/**
 * GET  /api/identities/[id]/recovery — list recovery methods for an identity.
 * POST /api/identities/[id]/recovery — add a recovery method.
 *
 * POST body:
 *   {
 *     type: 'email' | 'phone' | 'backup_codes' | 'social' | 'hardware_key' | 'trusted_contact',
 *     identifier: string    // email / phone / contact handle / etc.
 *   }
 *
 * Both endpoints are admin-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { recoveryManager, identityRegistry } from '@/identity';
import type { RecoveryMethodType } from '@/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES: RecoveryMethodType[] = [
  'email', 'phone', 'backup_codes', 'social', 'hardware_key', 'trusted_contact',
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

  const methods = await recoveryManager.list(id);
  return NextResponse.json({ methods });
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
  const type = body?.type as RecoveryMethodType;
  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid recovery method type' }, { status: 400 });
  }
  const identifier = (body?.identifier as string | undefined)?.trim();
  if (!identifier && type !== 'backup_codes') {
    return NextResponse.json({ error: 'identifier is required' }, { status: 400 });
  }

  try {
    const method = await recoveryManager.add(id, {
      type,
      identifier: identifier ?? `${id}:backup-codes`,
    });
    return NextResponse.json({ ok: true, method });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to add recovery method' }, { status: 400 });
  }
}
