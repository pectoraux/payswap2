/**
 * Inventory Management Extension — Manifest v2.
 *
 * Stock reservations, transfers between warehouses, purchase orders, and
 * inventory adjustments. Subscribes to sale.completed to auto-reserve stock
 * so confirmed sales never oversell.
 */

import type { ExtensionManifestV2 } from '@/extension-platform/types';

export const inventoryManifest: ExtensionManifestV2 = {
  // ── Identity ──
  id: 'inventory-management',
  name: 'Inventory Management',
  version: '1.0.0',
  publisher: {
    id: 'pub_supply_co',
    name: 'Supply Co',
    email: 'dev@supply.co',
    website: 'https://supply.co',
    verified: true,
  },
  description: 'Multi-warehouse inventory management. Reserves stock for sales, transfers between warehouses, creates purchase orders, and records adjustments. Auto-reserves stock on sale.completed so confirmed sales never oversell. Uses exact Money for purchase order values.',
  homepage: 'https://supply.co/inventory',
  license: 'MIT',
  repository: 'https://github.com/supply-co/inventory',
  documentationUrl: 'https://docs.supply.co/inventory',
  supportUrl: 'https://support.supply.co',
  category: 'MARKETPLACE',
  tags: ['inventory', 'warehouse', 'stock', 'supply-chain', 'purchase-order', 'reservation', 'transfer'],
  screenshots: [
    'https://supply.co/screenshots/dashboard.png',
    'https://supply.co/screenshots/warehouses.png',
  ],

  // ── Capabilities ──
  capabilities: [
    { name: 'Reserve Stock', description: 'Reserve stock for a pending sale. Produces a stock reservation.', category: 'inventory', produces: ['asset.stock_reservation'], requires: ['asset.sale_receipt'], universal: false },
    { name: 'Release Stock', description: 'Release a previously held stock reservation (e.g. cancelled sale).', category: 'inventory', produces: [], requires: ['asset.stock_reservation'], universal: false },
    { name: 'Transfer Stock', description: 'Transfer stock between warehouses. Produces a transfer order.', category: 'inventory', produces: ['asset.transfer_order'], requires: ['asset.stock_item'], universal: false },
    { name: 'Create Purchase Order', description: 'Create a purchase order to replenish stock from a supplier.', category: 'inventory', produces: ['asset.purchase_order'], requires: [], universal: false },
    { name: 'Adjust Inventory', description: 'Record an inventory adjustment (shrinkage, recount, damage).', category: 'inventory', produces: ['asset.inventory_adjustment'], requires: ['asset.stock_item'], universal: false },
  ],

  // ── Assets ──
  assets: [
    { id: 'asset.stock_reservation', name: 'Stock Reservation', type: 'RESERVATION', unit: 'reservation', description: 'Stock reserved for a pending sale.' },
    { id: 'asset.transfer_order', name: 'Transfer Order', type: 'RESERVATION', unit: 'order', description: 'A warehouse-to-warehouse stock transfer.' },
    { id: 'asset.purchase_order', name: 'Purchase Order', type: 'RECEIPT', unit: 'order', description: 'A purchase order to a supplier.' },
    { id: 'asset.inventory_adjustment', name: 'Inventory Adjustment', type: 'EVIDENCE', unit: 'adjustment', description: 'A stock adjustment (shrinkage, recount, damage).' },
  ],

  // ── Tokens ──
  tokens: [],

  // ── Events ──
  events: [
    { type: 'emits', eventType: 'inventory.reserved', description: 'Stock was reserved for a sale.' },
    { type: 'emits', eventType: 'inventory.released', description: 'A stock reservation was released.' },
    { type: 'emits', eventType: 'inventory.transferred', description: 'Stock was transferred between warehouses.' },
    { type: 'emits', eventType: 'inventory.adjusted', description: 'Inventory was adjusted (shrinkage/recount/damage).' },
    { type: 'consumes', eventType: 'sale.completed', description: 'Listen for sales to auto-reserve stock.' },
  ],

  // ── Providers ──
  providers: [],

  // ── Policies ──
  policies: [
    { name: 'No Oversell', rule: 'require_stock_available', enforcement: 'BLOCK', description: 'Cannot reserve more stock than is on hand.' },
  ],

  // ── Routes ──
  routes: [
    { path: '/api/inventory/reserve', method: 'POST', handler: 'reserveStock', authRequired: true, permissions: ['orders'] },
    { path: '/api/inventory/release', method: 'POST', handler: 'releaseStock', authRequired: true, permissions: ['orders'] },
    { path: '/api/inventory/transfer', method: 'POST', handler: 'transferStock', authRequired: true, permissions: ['orders'] },
    { path: '/api/inventory/adjust', method: 'POST', handler: 'adjustInventory', authRequired: true, permissions: ['orders'] },
    { path: '/api/inventory/stock', method: 'GET', handler: 'getStock', authRequired: false },
  ],

  // ── UI ──
  ui: [
    { type: 'nav', label: 'Inventory', path: '/dashboard/inventory', icon: 'Boxes', group: 'Operations', order: 20 },
    { type: 'page', label: 'Warehouses', path: '/dashboard/inventory/warehouses', icon: 'Warehouse', group: 'Operations' },
    { type: 'page', label: 'Purchase Orders', path: '/dashboard/inventory/purchase-orders', icon: 'ShoppingCart', group: 'Operations' },
    { type: 'settings', label: 'Inventory Configuration', path: '/dashboard/settings/inventory', icon: 'Settings' },
  ],

  // ── Scheduled Jobs ──
  scheduledJobs: [
    { id: 'low-stock-check', name: 'Low Stock Alert', schedule: '0 */6 * * *', handler: 'checkLowStock' },
    { id: 'reservation-expire', name: 'Expire Stale Reservations', schedule: '*/30 * * * *', handler: 'expireReservations' },
  ],

  // ── Health Checks ──
  healthChecks: [
    { id: 'warehouse-db', name: 'Warehouse Database', handler: 'checkWarehouseDB', timeoutMs: 3000 },
    { id: 'supplier-api', name: 'Supplier API', handler: 'checkSupplierAPI', timeoutMs: 5000 },
  ],

  // ── Migrations ──
  migrations: [
    { version: '1.0.0', up: 'CREATE TABLE inventory (...)', down: 'DROP TABLE inventory' },
  ],

  // ── Dependencies ──
  dependencies: [],
  conflicts: [],
  provides: ['inventory-management'],

  // ── Permissions ──
  permissions: [
    { scope: 'orders', access: 'write', reason: 'Create and manage stock reservations, transfers, and purchase orders.' },
    { scope: 'storage', access: 'write', reason: 'Store inventory records and adjustment evidence.' },
    { scope: 'events', access: 'write', reason: 'Emit inventory lifecycle events (reserved, released, transferred, adjusted).' },
  ],

  // ── Compatibility ──
  compatibility: {
    minPaySwapVersion: '1.0.0',
    maxTestedPaySwapVersion: '1.2.0',
    breakingChanges: 'None — this is the initial release.',
    upgradeNotes: 'Run the v1.0.0 migration on install.',
    rollbackNotes: 'Drop the inventory table on uninstall.',
  },

  // ── Billing ──
  billing: {
    model: 'USAGE_BASED',
    usageMetric: 'per_transaction',
    usagePrice: 0.10,
    currency: 'USD',
    trialDays: 14,
  },

  createdAt: Date.now(),
  updatedAt: Date.now(),
};
