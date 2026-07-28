import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { resolveDeveloperMerchantId } from '@/lib/developer-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/developer/webhooks/[id]
 *
 * Remove a webhook endpoint. Hard-deletes the endpoint row; deliveries are
 * cascade-deleted via the schema relation.
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

    const existing = await db.webhookEndpoint.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Endpoint not found' }, { status: 404 });
    }
    if (existing.merchantId !== merchantId) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    await db.webhookEndpoint.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/developer/webhooks DELETE] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
