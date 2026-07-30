import { NextRequest, NextResponse } from 'next/server';
import { parcelService } from '@/extensions/parcel-delivery/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const merchantId = (session.user as { id?: string }).id ?? 'unknown';
  const config = parcelService.configureShipping(merchantId, body as never);
  return NextResponse.json({ config, message: '✓ Shipping configuration updated' });
}
