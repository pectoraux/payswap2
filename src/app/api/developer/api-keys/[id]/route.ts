import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { resolveDeveloperMerchantId } from '@/lib/developer-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/developer/api-keys/[id]
 *
 * Revoke (soft-delete) an API key. Marks the key as REVOKED instead of
 * deleting the row so we keep the audit trail.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  const { id } = await params;

  try {
    const merchantId = await resolveDeveloperMerchantId(userId);
    if (!merchantId) {
      return NextResponse.json(
        { ok: false, error: 'No merchant available' },
        { status: 400 },
      );
    }

    // Ensure the key belongs to the developer's merchant.
    const existing = await db.apiKey.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'API key not found' }, { status: 404 });
    }
    if (existing.merchantId !== merchantId) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    const updated = await db.apiKey.update({
      where: { id },
      data: { status: 'REVOKED' },
    });

    return NextResponse.json({
      ok: true,
      apiKey: {
        id: updated.id,
        status: updated.status,
      },
    });
  } catch (err) {
    console.error('[api/developer/api-keys DELETE] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
