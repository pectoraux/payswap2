import { NextRequest, NextResponse } from 'next/server';
import { inventoryService } from '@/extensions/inventory/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try {
    const adjustment = inventoryService.adjustInventory({
      warehouseId: body.warehouseId as string,
      sku: body.sku as string,
      newQuantity: body.newQuantity as number,
      reason: body.reason as never,
      note: body.note as string | undefined,
    });
    return NextResponse.json({ adjustment, message: `✓ Adjusted ${adjustment.sku} by ${adjustment.delta} (${adjustment.reason})` }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
