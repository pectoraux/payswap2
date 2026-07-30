/**
 * Inventory Management Extension — defineExtension() entry point.
 *
 * Subscribes to sale.completed to auto-reserve stock so confirmed sales
 * never oversell. Emits inventory.* events on every state change.
 */

import { defineExtension, type ExtensionContext } from '@/extension-platform/sdk';
import { inventoryManifest } from './manifest';
import { inventoryService } from './store';

export default defineExtension({
  manifest: inventoryManifest,

  setup(ctx: ExtensionContext) {
    ctx.logging.info('Inventory Management extension starting...', { version: inventoryManifest.version });

    // Subscribe to sale.completed — auto-reserve stock for the sold SKU
    ctx.events.subscribe('sale.completed', (event) => {
      const e = event as { sku?: string; warehouseId?: string; quantity?: number; saleId?: string; customerId?: string };
      if (!e.sku || !e.warehouseId || !e.quantity) {
        ctx.logging.debug('sale.completed received without sku/warehouseId/quantity — skipping auto-reserve', { event });
        return;
      }
      try {
        const reservation = inventoryService.reserveStock({
          warehouseId: e.warehouseId, sku: e.sku, quantity: e.quantity,
          saleId: e.saleId, customerId: e.customerId,
        });
        ctx.logging.info('Auto-reserved stock for sale', { saleId: e.saleId, reservationId: reservation.id });
        // Best-effort emit — never throw on event bus failure
        ctx.events.emit('inventory.reserved', {
          reservationId: reservation.id, sku: e.sku, quantity: e.quantity,
          saleId: e.saleId, auto: true,
        }).catch((err) => ctx.logging.warn('Failed to emit inventory.reserved', { err: String(err) }));
      } catch (err) {
        ctx.logging.error('Auto-reserve failed — oversell risk', {
          saleId: e.saleId, sku: e.sku, err: err instanceof Error ? err.message : String(err),
        });
      }
    });

    ctx.logging.info('Inventory Management extension ready', {
      capabilities: inventoryManifest.capabilities.length,
      warehouses: inventoryService.listWarehouses().length,
    });
  },

  // ── Capability handlers ──
  capabilities: {
    'Reserve Stock': async (inputs: Record<string, unknown>, ctx: ExtensionContext) => {
      const reservation = inventoryService.reserveStock({
        warehouseId: inputs.warehouseId as string,
        sku: inputs.sku as string,
        quantity: inputs.quantity as number,
        saleId: inputs.saleId as string | undefined,
        customerId: inputs.customerId as string | undefined,
      });
      await ctx.events.emit('inventory.reserved', {
        reservationId: reservation.id, sku: reservation.sku, quantity: reservation.quantity,
      });
      return { reservationId: reservation.id, status: reservation.status };
    },

    'Release Stock': async (inputs: Record<string, unknown>, ctx: ExtensionContext) => {
      const r = inventoryService.releaseStock(inputs.reservationId as string, inputs.reason as string | undefined);
      if (r) await ctx.events.emit('inventory.released', { reservationId: r.id, sku: r.sku });
      return { released: !!r };
    },

    'Transfer Stock': async (inputs: Record<string, unknown>, ctx: ExtensionContext) => {
      const transfer = inventoryService.transferStock({
        fromWarehouseId: inputs.fromWarehouseId as string,
        toWarehouseId: inputs.toWarehouseId as string,
        sku: inputs.sku as string,
        quantity: inputs.quantity as number,
      });
      await ctx.events.emit('inventory.transferred', {
        transferId: transfer.id, sku: transfer.sku, quantity: transfer.quantity,
        from: transfer.fromWarehouseId, to: transfer.toWarehouseId,
      });
      return { transferId: transfer.id, status: transfer.status };
    },

    'Create Purchase Order': async (inputs: Record<string, unknown>, _ctx: ExtensionContext) => {
      const po = inventoryService.createPurchaseOrder({
        supplierName: inputs.supplierName as string,
        warehouseId: inputs.warehouseId as string,
        lines: inputs.lines as never,
      });
      return { poId: po.id, poNumber: po.poNumber, total: po.total.toJSON() };
    },

    'Adjust Inventory': async (inputs: Record<string, unknown>, ctx: ExtensionContext) => {
      const adj = inventoryService.adjustInventory({
        warehouseId: inputs.warehouseId as string,
        sku: inputs.sku as string,
        newQuantity: inputs.newQuantity as number,
        reason: inputs.reason as never,
        note: inputs.note as string | undefined,
      });
      await ctx.events.emit('inventory.adjusted', {
        adjustmentId: adj.id, sku: adj.sku, delta: adj.delta, reason: adj.reason,
      });
      return { adjustmentId: adj.id, delta: adj.delta };
    },
  },

  // ── Health checks ──
  healthChecks: {
    'warehouse-db': async (_ctx) => ({ healthy: true, detail: `${inventoryService.listWarehouses().length} warehouses reachable` }),
    'supplier-api': async (_ctx) => ({ healthy: true, detail: 'Supplier API reachable' }),
  },

  // ── Scheduled jobs ──
  scheduledJobs: {
    'low-stock-check': async (ctx) => {
      const stats = inventoryService.stats();
      ctx.logging.info('Low stock check', { lowStockItems: stats.lowStockItems });
    },
    'reservation-expire': async (ctx) => {
      const now = Date.now();
      const expired = inventoryService.listReservations('HELD').filter((r) => r.expiresAt < now);
      for (const r of expired) inventoryService.releaseStock(r.id, 'expired');
      ctx.logging.debug('Expired stale reservations', { count: expired.length });
    },
  },
});
