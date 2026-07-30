import { NextRequest, NextResponse } from 'next/server';
import { inventoryService } from '@/extensions/inventory/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const reservation = inventoryService.releaseStock(body.reservationId as string, body.reason as string | undefined);
  if (!reservation) return NextResponse.json({ error: 'Reservation not found or not held' }, { status: 404 });
  return NextResponse.json({ reservation, message: '✓ Reservation released' });
}
