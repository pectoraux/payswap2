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
    const transfer = inventoryService.transferStock({
      fromWarehouseId: body.fromWarehouseId as string,
      toWarehouseId: body.toWarehouseId as string,
      sku: body.sku as string,
      quantity: body.quantity as number,
    });
    return NextResponse.json({ transfer, message: `✓ Transferred ${transfer.quantity} of ${transfer.sku}` }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
