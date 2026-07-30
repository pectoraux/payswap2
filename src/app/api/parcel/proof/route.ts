import { NextRequest, NextResponse } from 'next/server';
import { parcelService } from '@/extensions/parcel-delivery/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const delivery = parcelService.submitProofOfDelivery(body.deliveryId as string, { photoUrl: body.photoUrl as string, signatureUrl: body.signatureUrl as string, gps: body.gps as never });
  if (!delivery) return NextResponse.json({ error: 'Delivery not found' }, { status: 404 });
  return NextResponse.json({ delivery, message: `✓ Proof of delivery submitted — status: DELIVERED` });
}
