import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/extensions/[id]/review
 *
 * Submit a rating + comment for an extension. Body:
 *   { rating: number (1-5), comment: string }
 *
 * Recomputes the extension's aggregate `rating` and `reviewCount` after
 * inserting the review row.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: 'No user id in session' },
      { status: 400 },
    );
  }

  const { id } = await params;
  const extension = await db.extension.findUnique({ where: { id } });
  if (!extension) {
    return NextResponse.json(
      { ok: false, error: 'Extension not found' },
      { status: 404 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const rating =
    typeof body.rating === 'number' && Number.isFinite(body.rating)
      ? Math.max(1, Math.min(5, Math.round(body.rating)))
      : null;
  if (rating === null) {
    return NextResponse.json(
      { ok: false, error: 'rating must be an integer 1-5' },
      { status: 400 },
    );
  }
  const comment =
    typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) : '';
  if (!comment) {
    return NextResponse.json(
      { ok: false, error: 'comment is required' },
      { status: 400 },
    );
  }

  const review = await db.extensionReview.create({
    data: { extensionId: id, userId, rating, comment },
  });

  // Recompute aggregate rating + count.
  const agg = await db.extensionReview.aggregate({
    where: { extensionId: id },
    _avg: { rating: true },
    _count: { rating: true },
  });
  const newRating = agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0;
  const newCount = agg._count.rating ?? 0;

  await db.extension.update({
    where: { id },
    data: { rating: newRating, reviewCount: newCount },
  });

  return NextResponse.json(
    { ok: true, review, rating: newRating, reviewCount: newCount },
    { status: 201 },
  );
}
