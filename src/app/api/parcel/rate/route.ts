import { NextRequest, NextResponse } from 'next/server';
import { parcelService } from '@/extensions/parcel-delivery/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const rating = parcelService.rateDelivery(body.deliveryId as string, body.ratedBy as never, body.target as never, body.targetId as string, body.rating as number, body.comment as string);
  return NextResponse.json({ rating, message: `✓ Rating submitted: ${rating.rating}/5` }, { status: 201 });
}
