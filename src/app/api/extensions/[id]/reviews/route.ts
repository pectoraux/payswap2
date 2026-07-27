import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/extensions/[id]/reviews
 *
 * Public list of reviews for an extension. No session required (the merchant
 * detail dialog uses this to render the reviews tab).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reviews = await db.extensionReview.findMany({
    where: { extensionId: id },
    include: {
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    ok: true,
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      user: r.user
        ? { id: r.user.id, name: r.user.name ?? 'Anonymous' }
        : null,
    })),
  });
}
