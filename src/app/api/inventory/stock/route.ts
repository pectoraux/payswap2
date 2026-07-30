import { NextRequest, NextResponse } from 'next/server';
import { inventoryService } from '@/extensions/inventory/store';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const warehouseId = req.nextUrl.searchParams.get('warehouseId') ?? undefined;
  const sku = req.nextUrl.searchParams.get('sku') ?? undefined;
  const stock = inventoryService.getStock(warehouseId, sku);
  return NextResponse.json({
    stock,
    warehouses: inventoryService.listWarehouses(),
    count: stock.length,
    stats: inventoryService.stats(),
  });
}
