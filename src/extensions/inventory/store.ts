/**
 * Inventory Management Extension — Domain Store + Logic.
 *
 * In-memory store of warehouses, stock items, reservations, transfers, and
 * purchase orders. Uses the globalThis pattern so the store survives HMR in
 * dev. Money is used for purchase order values (exact BigInt, no float).
 */

import { uid } from '@/runtime/types';
import { Money, money } from '@/money';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Warehouse {
  id: string;
  name: string;
  code: string;                // e.g. 'WH-ACC'
  location: string;
  country: string;             // ISO-3166 alpha-2
  active: boolean;
  createdAt: number;
}

export interface StockItem {
  id: string;
  warehouseId: string;
  sku: string;
  name: string;
  quantityOnHand: number;      // physically present
  quantityReserved: number;    // reserved for pending sales
  reorderPoint: number;        // below this → low stock alert
  unitCost: Money;             // exact cost per unit
  updatedAt: number;
}

export type ReservationStatus = 'HELD' | 'RELEASED' | 'CONSUMED' | 'EXPIRED';

export interface StockReservation {
  id: string;
  warehouseId: string;
  sku: string;
  quantity: number;
  saleId?: string;             // the sale that triggered the reservation
  customerId?: string;
  status: ReservationStatus;
  expiresAt: number;           // reservations auto-expire
  createdAt: number;
  releasedAt?: number;
  releaseReason?: string;      // recorded when released (cancelled sale, expired, etc.)
}

export type TransferStatus = 'PENDING' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';

export interface TransferOrder {
  id: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  sku: string;
  quantity: number;
  status: TransferStatus;
  shippedAt?: number;
  receivedAt?: number;
  createdAt: number;
}

export type PurchaseOrderStatus = 'DRAFT' | 'SUBMITTED' | 'CONFIRMED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrderLine {
  sku: string;
  name: string;
  quantity: number;
  unitCost: Money;
  lineTotal: Money;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierName: string;
  warehouseId: string;
  lines: PurchaseOrderLine[];
  total: Money;                // exact sum of line totals
  status: PurchaseOrderStatus;
  createdAt: number;
  submittedAt?: number;
  receivedAt?: number;
}

export type AdjustmentReason = 'SHRINKAGE' | 'RECOUNT' | 'DAMAGE' | 'SAMPLING' | 'OTHER';

export interface InventoryAdjustment {
  id: string;
  warehouseId: string;
  sku: string;
  previousQuantity: number;
  newQuantity: number;
  delta: number;
  reason: AdjustmentReason;
  note?: string;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE (in-memory, scoped to this extension)
// ═══════════════════════════════════════════════════════════════════════════

interface InventoryStore {
  warehouses: Map<string, Warehouse>;
  stock: Map<string, StockItem>;            // key = `${warehouseId}:${sku}`
  reservations: Map<string, StockReservation>;
  transfers: Map<string, TransferOrder>;
  purchaseOrders: Map<string, PurchaseOrder>;
  adjustments: InventoryAdjustment[];
}

const globalForInventory = globalThis as unknown as { __INVENTORY_STORE__?: InventoryStore };

const store: InventoryStore = globalForInventory.__INVENTORY_STORE__ ?? {
  warehouses: new Map(),
  stock: new Map(),
  reservations: new Map(),
  transfers: new Map(),
  purchaseOrders: new Map(),
  adjustments: [],
};

if (!globalForInventory.__INVENTORY_STORE__) {
  globalForInventory.__INVENTORY_STORE__ = store;
  seedInventory();
}

const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export const inventoryService = {
  // ── Warehouses ──
  listWarehouses(): Warehouse[] {
    return Array.from(store.warehouses.values()).filter((w) => w.active);
  },
  getWarehouse(id: string): Warehouse | undefined { return store.warehouses.get(id); },

  // ── Stock ──
  getStock(warehouseId?: string, sku?: string): StockItem[] {
    let rows = Array.from(store.stock.values());
    if (warehouseId) rows = rows.filter((s) => s.warehouseId === warehouseId);
    if (sku) rows = rows.filter((s) => s.sku === sku);
    return rows.sort((a, b) => a.sku.localeCompare(b.sku));
  },
  getStockItem(warehouseId: string, sku: string): StockItem | undefined {
    return store.stock.get(`${warehouseId}:${sku}`);
  },
  availableQuantity(warehouseId: string, sku: string): number {
    const item = store.stock.get(`${warehouseId}:${sku}`);
    if (!item) return 0;
    return item.quantityOnHand - item.quantityReserved;
  },

  // ── Reservations ──
  reserveStock(input: {
    warehouseId: string; sku: string; quantity: number;
    saleId?: string; customerId?: string;
  }): StockReservation {
    const item = store.stock.get(`${input.warehouseId}:${input.sku}`);
    if (!item) throw new Error(`No stock item for SKU ${input.sku} in warehouse ${input.warehouseId}`);
    const available = item.quantityOnHand - item.quantityReserved;
    if (available < input.quantity) {
      throw new Error(`Insufficient stock: requested ${input.quantity}, available ${available} (on-hand ${item.quantityOnHand}, reserved ${item.quantityReserved})`);
    }
    item.quantityReserved += input.quantity;
    item.updatedAt = Date.now();
    const reservation: StockReservation = {
      id: uid('res'),
      warehouseId: input.warehouseId,
      sku: input.sku,
      quantity: input.quantity,
      saleId: input.saleId,
      customerId: input.customerId,
      status: 'HELD',
      expiresAt: Date.now() + RESERVATION_TTL_MS,
      createdAt: Date.now(),
    };
    store.reservations.set(reservation.id, reservation);
    return reservation;
  },

  releaseStock(reservationId: string, reason?: string): StockReservation | null {
    const r = store.reservations.get(reservationId);
    if (!r) return null;
    if (r.status !== 'HELD') return null;
    r.status = 'RELEASED'; r.releasedAt = Date.now();
    if (reason) r.releaseReason = reason;
    const item = store.stock.get(`${r.warehouseId}:${r.sku}`);
    if (item) {
      item.quantityReserved = Math.max(0, item.quantityReserved - r.quantity);
      item.updatedAt = Date.now();
    }
    return r;
  },

  consumeStock(reservationId: string): StockReservation | null {
    const r = store.reservations.get(reservationId);
    if (!r || r.status !== 'HELD') return null;
    r.status = 'CONSUMED';
    const item = store.stock.get(`${r.warehouseId}:${r.sku}`);
    if (item) {
      item.quantityOnHand -= r.quantity;
      item.quantityReserved = Math.max(0, item.quantityReserved - r.quantity);
      item.updatedAt = Date.now();
    }
    return r;
  },

  listReservations(status?: ReservationStatus): StockReservation[] {
    let rows = Array.from(store.reservations.values());
    if (status) rows = rows.filter((r) => r.status === status);
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },

  // ── Transfers ──
  transferStock(input: {
    fromWarehouseId: string; toWarehouseId: string; sku: string; quantity: number;
  }): TransferOrder {
    const fromItem = store.stock.get(`${input.fromWarehouseId}:${input.sku}`);
    if (!fromItem) throw new Error(`No stock for SKU ${input.sku} in source warehouse`);
    const available = fromItem.quantityOnHand - fromItem.quantityReserved;
    if (available < input.quantity) {
      throw new Error(`Insufficient available stock for transfer: requested ${input.quantity}, available ${available}`);
    }
    // Debit the source immediately (in transit); credit destination on receipt.
    fromItem.quantityOnHand -= input.quantity;
    fromItem.updatedAt = Date.now();
    const transfer: TransferOrder = {
      id: uid('trf'),
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      sku: input.sku,
      quantity: input.quantity,
      status: 'IN_TRANSIT',
      shippedAt: Date.now(),
      createdAt: Date.now(),
    };
    store.transfers.set(transfer.id, transfer);
    return transfer;
  },

  receiveTransfer(transferId: string): TransferOrder | null {
    const t = store.transfers.get(transferId);
    if (!t || t.status !== 'IN_TRANSIT') return null;
    t.status = 'RECEIVED'; t.receivedAt = Date.now();
    // Credit the destination warehouse (create stock item if missing)
    let dest = store.stock.get(`${t.toWarehouseId}:${t.sku}`);
    if (!dest) {
      const source = store.stock.get(`${t.fromWarehouseId}:${t.sku}`);
      dest = {
        id: uid('stk'),
        warehouseId: t.toWarehouseId, sku: t.sku,
        name: source?.name ?? t.sku,
        quantityOnHand: 0, quantityReserved: 0,
        reorderPoint: source?.reorderPoint ?? 10,
        unitCost: source?.unitCost ?? money.usd(0),
        updatedAt: Date.now(),
      };
      store.stock.set(`${t.toWarehouseId}:${t.sku}`, dest);
    }
    dest.quantityOnHand += t.quantity;
    dest.updatedAt = Date.now();
    return t;
  },

  listTransfers(): TransferOrder[] {
    return Array.from(store.transfers.values()).sort((a, b) => b.createdAt - a.createdAt);
  },

  // ── Purchase Orders ──
  createPurchaseOrder(input: {
    supplierName: string; warehouseId: string;
    lines: Array<{ sku: string; name: string; quantity: number; unitCost: number }>;
  }): PurchaseOrder {
    const poLines: PurchaseOrderLine[] = input.lines.map((l) => {
      const unitCost = money.usd(l.unitCost);
      return {
        sku: l.sku, name: l.name, quantity: l.quantity,
        unitCost,
        lineTotal: unitCost.multiply(l.quantity),
      };
    });
    const total = poLines.length > 0
      ? Money.sum(poLines.map((l) => l.lineTotal))
      : money.usd(0);
    const po: PurchaseOrder = {
      id: uid('po'),
      poNumber: `PO-${Date.now().toString(36).toUpperCase()}`,
      supplierName: input.supplierName,
      warehouseId: input.warehouseId,
      lines: poLines,
      total,
      status: 'SUBMITTED',
      createdAt: Date.now(),
      submittedAt: Date.now(),
    };
    store.purchaseOrders.set(po.id, po);
    return po;
  },

  receivePurchaseOrder(poId: string): PurchaseOrder | null {
    const po = store.purchaseOrders.get(poId);
    if (!po || po.status !== 'SUBMITTED' && po.status !== 'CONFIRMED') return null;
    po.status = 'RECEIVED'; po.receivedAt = Date.now();
    // Add received quantities to warehouse stock
    for (const line of po.lines) {
      const key = `${po.warehouseId}:${line.sku}`;
      let item = store.stock.get(key);
      if (!item) {
        item = {
          id: uid('stk'), warehouseId: po.warehouseId, sku: line.sku, name: line.name,
          quantityOnHand: 0, quantityReserved: 0, reorderPoint: 10,
          unitCost: line.unitCost, updatedAt: Date.now(),
        };
        store.stock.set(key, item);
      }
      item.quantityOnHand += line.quantity;
      item.updatedAt = Date.now();
    }
    return po;
  },

  listPurchaseOrders(): PurchaseOrder[] {
    return Array.from(store.purchaseOrders.values()).sort((a, b) => b.createdAt - a.createdAt);
  },

  // ── Adjustments ──
  adjustInventory(input: {
    warehouseId: string; sku: string; newQuantity: number;
    reason: AdjustmentReason; note?: string;
  }): InventoryAdjustment {
    const key = `${input.warehouseId}:${input.sku}`;
    const item = store.stock.get(key);
    if (!item) throw new Error(`No stock item for SKU ${input.sku} in warehouse ${input.warehouseId}`);
    const previous = item.quantityOnHand;
    const delta = input.newQuantity - previous;
    item.quantityOnHand = input.newQuantity;
    item.updatedAt = Date.now();
    const adj: InventoryAdjustment = {
      id: uid('adj'),
      warehouseId: input.warehouseId,
      sku: input.sku,
      previousQuantity: previous,
      newQuantity: input.newQuantity,
      delta,
      reason: input.reason,
      note: input.note,
      createdAt: Date.now(),
    };
    store.adjustments.push(adj);
    if (store.adjustments.length > 1000) store.adjustments.length = 1000;
    return adj;
  },

  listAdjustments(): InventoryAdjustment[] {
    return [...store.adjustments].sort((a, b) => b.createdAt - a.createdAt);
  },

  // ── Stats / Health ──
  stats() {
    const stock = Array.from(store.stock.values());
    return {
      warehouses: store.warehouses.size,
      totalSkus: stock.length,
      totalOnHand: stock.reduce((s, i) => s + i.quantityOnHand, 0),
      totalReserved: stock.reduce((s, i) => s + i.quantityReserved, 0),
      lowStockItems: stock.filter((i) => i.quantityOnHand - i.quantityReserved <= i.reorderPoint).length,
      activeReservations: Array.from(store.reservations.values()).filter((r) => r.status === 'HELD').length,
      openTransfers: Array.from(store.transfers.values()).filter((t) => t.status === 'IN_TRANSIT').length,
      openPurchaseOrders: Array.from(store.purchaseOrders.values()).filter((p) => p.status === 'SUBMITTED' || p.status === 'CONFIRMED').length,
      inventoryValue: Money.sum(
        stock.length > 0
          ? stock.map((i) => i.unitCost.multiply(i.quantityOnHand))
          : [money.usd(0)]
      ).toJSON(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// SEED — 3 warehouses with stock
// ═══════════════════════════════════════════════════════════════════════════

function seedInventory() {
  const warehouses: Warehouse[] = [
    { id: 'wh_accra', name: 'Accra Central DC', code: 'WH-ACC', location: 'Accra, Ghana', country: 'GH', active: true, createdAt: Date.now() - 86400000 * 365 },
    { id: 'wh_lagos', name: 'Lagos Mega Hub', code: 'WH-LOS', location: 'Lagos, Nigeria', country: 'NG', active: true, createdAt: Date.now() - 86400000 * 300 },
    { id: 'wh_nairobi', name: 'Nairobi East Hub', code: 'WH-NBO', location: 'Nairobi, Kenya', country: 'KE', active: true, createdAt: Date.now() - 86400000 * 250 },
  ];
  for (const w of warehouses) store.warehouses.set(w.id, w);

  const seedStock: Array<{ wh: string; sku: string; name: string; onHand: number; reserved: number; reorder: number; cost: number }> = [
    // Accra
    { wh: 'wh_accra', sku: 'SKU-001', name: 'Organic Cocoa Beans 1kg', onHand: 500, reserved: 30, reorder: 100, cost: 12.50 },
    { wh: 'wh_accra', sku: 'SKU-002', name: 'Shea Butter 500g', onHand: 320, reserved: 10, reorder: 80, cost: 8.00 },
    { wh: 'wh_accra', sku: 'SKU-003', name: 'Kente Cloth Premium', onHand: 45, reserved: 5, reorder: 20, cost: 85.00 },
    // Lagos
    { wh: 'wh_lagos', sku: 'SKU-001', name: 'Organic Cocoa Beans 1kg', onHand: 180, reserved: 20, reorder: 60, cost: 12.50 },
    { wh: 'wh_lagos', sku: 'SKU-004', name: 'Ankara Fabric Yard', onHand: 1200, reserved: 80, reorder: 200, cost: 6.50 },
    { wh: 'wh_lagos', sku: 'SKU-005', name: 'Hand-carved Wood Mask', onHand: 75, reserved: 0, reorder: 15, cost: 45.00 },
    // Nairobi
    { wh: 'wh_nairobi', sku: 'SKU-006', name: 'Kenyan AA Coffee 1kg', onHand: 420, reserved: 40, reorder: 100, cost: 22.00 },
    { wh: 'wh_nairobi', sku: 'SKU-007', name: 'Maasai Beaded Necklace', onHand: 95, reserved: 5, reorder: 25, cost: 35.00 },
    { wh: 'wh_nairobi', sku: 'SKU-002', name: 'Shea Butter 500g', onHand: 18, reserved: 0, reorder: 30, cost: 8.00 }, // low stock — triggers alert
  ];

  for (const s of seedStock) {
    const item: StockItem = {
      id: uid('stk'),
      warehouseId: s.wh, sku: s.sku, name: s.name,
      quantityOnHand: s.onHand, quantityReserved: s.reserved,
      reorderPoint: s.reorder, unitCost: money.usd(s.cost),
      updatedAt: Date.now(),
    };
    store.stock.set(`${s.wh}:${s.sku}`, item);
  }
}
