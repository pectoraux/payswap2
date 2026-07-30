/**
 * Parcel Delivery Extension — Manifest v2.
 *
 * The canonical reference implementation. Exercises every platform subsystem:
 * manifest v2, SDK, packaging, signing, marketplace, installation, EKG,
 * capability graph, resolve(), provider adapters, Money, event sourcing,
 * idempotency, formal verification, billing, OAuth, permissions, health.
 */

import type { ExtensionManifestV2 } from '@/extension-platform/types';

export const parcelDeliveryManifest: ExtensionManifestV2 = {
  // ── Identity ──
  id: 'parcel-delivery',
  name: 'Parcel Delivery',
  version: '1.0.0',
  publisher: {
    id: 'pub_logistics_co',
    name: 'Logistics Co',
    email: 'dev@logistics.co',
    website: 'https://logistics.co',
    verified: true,
  },
  description: 'Complete logistics marketplace extension. Merchants create delivery requests after purchases; the planner optimizes routes, groups orders, auctions courier bundles, tracks deliveries, and manages proof of delivery. Integrates with Google Maps, Mapbox, Twilio, and SendGrid via OAuth. Uses resolve() for AI planning.',
  homepage: 'https://logistics.co/parcel-delivery',
  license: 'MIT',
  repository: 'https://github.com/logistics-co/parcel-delivery',
  documentationUrl: 'https://docs.logistics.co/parcel-delivery',
  supportUrl: 'https://support.logistics.co',
  category: 'LOGISTICS',
  tags: ['delivery', 'logistics', 'shipping', 'courier', 'tracking', 'auction', 'routing', 'carbon'],
  screenshots: [
    'https://logistics.co/screenshots/dashboard.png',
    'https://logistics.co/screenshots/tracking.png',
    'https://logistics.co/screenshots/auction.png',
  ],

  // ── Capabilities (register in the EKG) ──
  capabilities: [
    { name: 'Create Delivery', description: 'Create a parcel delivery request from a purchase receipt. Produces a delivery request + tracking number.', category: 'logistics', produces: ['asset.delivery_request', 'asset.tracking_number'], requires: ['asset.payment_receipt', 'asset.identity'], universal: false },
    { name: 'Cancel Delivery', description: 'Cancel a pending or in-transit delivery. Produces a cancellation record.', category: 'logistics', produces: ['asset.cancellation_record'], requires: ['asset.delivery_request'], universal: false },
    { name: 'Schedule Delivery', description: 'Schedule a delivery for a future time window.', category: 'logistics', produces: ['asset.scheduled_delivery'], requires: ['asset.delivery_request'], universal: false },
    { name: 'Group Deliveries', description: 'Group multiple deliveries to the same neighborhood into a single courier run. Reduces cost + carbon.', category: 'logistics', produces: ['asset.delivery_bundle'], requires: ['asset.delivery_request'], universal: false },
    { name: 'Route Optimization', description: 'Optimize the delivery route using AI planning. Considers distance, traffic, weather, vehicle capacity, carbon.', category: 'logistics', produces: ['asset.optimized_route'], requires: ['asset.delivery_request'], universal: false },
    { name: 'Courier Auction', description: 'Auction a bundle of deliveries to courier companies. Bulk mode (bidding on bundles) or open marketplace (claim individual jobs).', category: 'logistics', produces: ['asset.auction_result'], requires: ['asset.delivery_bundle'], universal: false },
    { name: 'Delivery Tracking', description: 'Track a delivery in real-time. Produces tracking events.', category: 'logistics', produces: ['asset.tracking_event'], requires: ['asset.tracking_number'], universal: false },
    { name: 'Delivery Insurance', description: 'Insure a delivery against loss/damage. Produces an insurance policy.', category: 'insurance', produces: ['asset.delivery_insurance'], requires: ['asset.delivery_request'], universal: false },
    { name: 'Signature Verification', description: 'Verify a delivery signature. Produces a signature proof.', category: 'logistics', produces: ['asset.signature_proof'], requires: ['asset.tracking_number'], universal: false },
    { name: 'Parcel Pickup', description: 'Schedule a parcel pickup from the merchant.', category: 'logistics', produces: ['asset.pickup_confirmation'], requires: ['asset.delivery_request'], universal: false },
    { name: 'Proof of Delivery', description: 'Record proof of delivery (photo, signature, GPS). Produces a delivery receipt.', category: 'logistics', produces: ['asset.delivery_receipt', 'asset.proof_of_delivery'], requires: ['asset.tracking_number'], universal: false },
    { name: 'Transit Optimization', description: 'Optimize multi-hub transit routes for long-distance deliveries.', category: 'logistics', produces: ['asset.transit_plan'], requires: ['asset.delivery_request'], universal: false },
  ],

  // ── Assets (register in the EKG) ──
  assets: [
    { id: 'asset.delivery_request', name: 'Delivery Request', type: 'RESERVATION', unit: 'request', description: 'A parcel delivery request.' },
    { id: 'asset.tracking_number', name: 'Tracking Number', type: 'CREDENTIAL', unit: 'tracking', description: 'A delivery tracking number.' },
    { id: 'asset.delivery_receipt', name: 'Delivery Receipt', type: 'RECEIPT', unit: 'receipt', description: 'Proof of completed delivery.' },
    { id: 'asset.proof_of_delivery', name: 'Proof of Delivery', type: 'EVIDENCE', unit: 'proof', description: 'Photo + signature + GPS proof.' },
    { id: 'asset.delivery_bundle', name: 'Delivery Bundle', type: 'RESERVATION', unit: 'bundle', description: 'A grouped set of deliveries.' },
    { id: 'asset.optimized_route', name: 'Optimized Route', type: 'ROUTE', unit: 'route', description: 'An AI-optimized delivery route.' },
    { id: 'asset.auction_result', name: 'Auction Result', type: 'RECEIPT', unit: 'result', description: 'The winning bid for a courier auction.' },
    { id: 'asset.tracking_event', name: 'Tracking Event', type: 'EVIDENCE', unit: 'event', description: 'A real-time tracking event.' },
    { id: 'asset.delivery_insurance', name: 'Delivery Insurance', type: 'INSURANCE', unit: 'policy', description: 'Insurance policy for a delivery.' },
    { id: 'asset.signature_proof', name: 'Signature Proof', type: 'EVIDENCE', unit: 'proof', description: 'A verified delivery signature.' },
    { id: 'asset.pickup_confirmation', name: 'Pickup Confirmation', type: 'RECEIPT', unit: 'confirmation', description: 'Confirmation that a parcel was picked up.' },
    { id: 'asset.scheduled_delivery', name: 'Scheduled Delivery', type: 'RESERVATION', unit: 'schedule', description: 'A delivery scheduled for a future window.' },
    { id: 'asset.cancellation_record', name: 'Cancellation Record', type: 'RECEIPT', unit: 'record', description: 'A delivery cancellation record.' },
    { id: 'asset.transit_plan', name: 'Transit Plan', type: 'ROUTE', unit: 'plan', description: 'A multi-hub transit plan.' },
  ],

  // ── Tokens ──
  tokens: [
    { symbol: 'DLV', name: 'Delivery Credit', assetId: 'asset.delivery_request', kind: 'FUNGIBLE', consumable: true },
  ],

  // ── Events ──
  events: [
    { type: 'emits', eventType: 'delivery.created', description: 'A delivery request was created.' },
    { type: 'emits', eventType: 'delivery.scheduled', description: 'A delivery was scheduled.' },
    { type: 'emits', eventType: 'delivery.picked_up', description: 'A parcel was picked up.' },
    { type: 'emits', eventType: 'delivery.in_transit', description: 'A parcel is in transit.' },
    { type: 'emits', eventType: 'delivery.delivered', description: 'A parcel was delivered.' },
    { type: 'emits', eventType: 'delivery.cancelled', description: 'A delivery was cancelled.' },
    { type: 'emits', eventType: 'delivery.auction_started', description: 'A courier auction started.' },
    { type: 'emits', eventType: 'delivery.auction_won', description: 'A courier won an auction.' },
    { type: 'emits', eventType: 'delivery.bundle_created', description: 'A delivery bundle was created.' },
    { type: 'emits', eventType: 'delivery.rated', description: 'A delivery was rated.' },
    { type: 'consumes', eventType: 'payment.completed', description: 'Listen for payments to trigger delivery creation.' },
    { type: 'consumes', eventType: 'sale.completed', description: 'Listen for marketplace sales to trigger delivery.' },
  ],

  // ── Providers (this extension is itself a provider) ──
  providers: [
    { id: 'courier-logistics-co', name: 'Logistics Co Courier', label: 'ORGANIZATION', description: 'In-house courier service for the Parcel Delivery extension.', capabilities: ['Create Delivery', 'Cancel Delivery', 'Schedule Delivery', 'Parcel Pickup', 'Proof of Delivery'], jurisdictions: ['GH', 'NG', 'KE', 'TG'], carbonPerInvocation: 0.15 },
  ],

  // ── Policies ──
  policies: [
    { name: 'KYC Required', rule: 'require_kyc', enforcement: 'BLOCK', description: 'Sender must be KYC-verified before creating a delivery.' },
    { name: 'Insurance Required for High Value', rule: 'require_insurance_over_500', enforcement: 'WARN', description: 'Deliveries over $500 should be insured.' },
  ],

  // ── Routes (merchant-facing API) ──
  routes: [
    { path: '/api/parcel/create', method: 'POST', handler: 'createDelivery', authRequired: true, permissions: ['orders'] },
    { path: '/api/parcel/cancel', method: 'POST', handler: 'cancelDelivery', authRequired: true, permissions: ['orders'] },
    { path: '/api/parcel/schedule', method: 'POST', handler: 'scheduleDelivery', authRequired: true, permissions: ['orders'] },
    { path: '/api/parcel/track/:trackingId', method: 'GET', handler: 'trackDelivery', authRequired: false },
    { path: '/api/parcel/group', method: 'POST', handler: 'groupDeliveries', authRequired: true, permissions: ['orders'] },
    { path: '/api/parcel/auction', method: 'POST', handler: 'startAuction', authRequired: true, permissions: ['orders'] },
    { path: '/api/parcel/auction/:auctionId/bid', method: 'POST', handler: 'placeBid', authRequired: true },
    { path: '/api/parcel/deliveries', method: 'GET', handler: 'listDeliveries', authRequired: true, permissions: ['orders'] },
    { path: '/api/parcel/proof', method: 'POST', handler: 'submitProofOfDelivery', authRequired: true, permissions: ['orders'] },
    { path: '/api/parcel/rate', method: 'POST', handler: 'rateDelivery', authRequired: true },
    { path: '/api/parcel/configure', method: 'POST', handler: 'configureShipping', authRequired: true, permissions: ['orders'] },
    { path: '/api/parcel/health', method: 'GET', handler: 'healthCheck', authRequired: false },
  ],

  // ── UI Contributions ──
  ui: [
    { type: 'nav', label: 'Parcels', path: '/dashboard/parcels', icon: 'Package', group: 'Operations', order: 10 },
    { type: 'page', label: 'Delivery Tracking', path: '/dashboard/parcels/tracking', icon: 'MapPin', group: 'Operations' },
    { type: 'page', label: 'Courier Auctions', path: '/dashboard/parcels/auctions', icon: 'Gavel', group: 'Operations' },
    { type: 'settings', label: 'Shipping Configuration', path: '/dashboard/settings/shipping', icon: 'Truck' },
    { type: 'admin', label: 'Delivery Analytics', path: '/admin/parcels/analytics', icon: 'BarChart3', group: 'Extensions' },
  ],

  // ── Scheduled Jobs ──
  scheduledJobs: [
    { id: 'tracking-sync', name: 'Sync Tracking Updates', schedule: '*/5 * * * *', handler: 'syncTracking' },
    { id: 'auction-settle', name: 'Settle Expired Auctions', schedule: '*/10 * * * *', handler: 'settleAuctions' },
    { id: 'route-optimize', name: 'Re-optimize Active Routes', schedule: '0 */1 * * *', handler: 'reoptimizeRoutes' },
    { id: 'bundle-discover', name: 'Discover Grouping Opportunities', schedule: '*/15 * * * *', handler: 'discoverBundles' },
    { id: 'learning-update', name: 'Update ML Models', schedule: '0 2 * * *', handler: 'updateModels' },
  ],

  // ── Health Checks ──
  healthChecks: [
    { id: 'logistics-api', name: 'Logistics API', handler: 'checkLogisticsAPI', timeoutMs: 5000 },
    { id: 'maps-api', name: 'Maps API (Google/Mapbox)', handler: 'checkMapsAPI', timeoutMs: 5000 },
    { id: 'courier-network', name: 'Courier Network', handler: 'checkCourierNetwork', timeoutMs: 3000 },
    { id: 'auction-engine', name: 'Auction Engine', handler: 'checkAuctionEngine', timeoutMs: 2000 },
  ],

  // ── Migrations ──
  migrations: [
    { version: '1.0.0', up: 'CREATE TABLE deliveries (...)', down: 'DROP TABLE deliveries' },
  ],

  // ── Dependencies ──
  dependencies: [],
  conflicts: [],
  provides: ['parcel-delivery'],

  // ── Permissions ──
  permissions: [
    { scope: 'payments', access: 'read', reason: 'Read payment receipts to verify payment before creating a delivery.' },
    { scope: 'identity', access: 'read', reason: 'Verify sender identity (KYC) before accepting delivery.' },
    { scope: 'orders', access: 'write', reason: 'Create and manage delivery orders.' },
    { scope: 'notifications', access: 'write', reason: 'Send delivery tracking notifications to customers.' },
    { scope: 'storage', access: 'write', reason: 'Store delivery proofs (photos, signatures, GPS).' },
    { scope: 'resolve', access: 'write', reason: 'Use resolve() for AI route optimization and courier assignment.' },
    { scope: 'events', access: 'write', reason: 'Emit delivery lifecycle events (created, picked_up, delivered, etc.).' },
    { scope: 'money', access: 'read', reason: 'Calculate exact delivery costs using the Money value object.' },
  ],

  // ── Compatibility ──
  compatibility: {
    minPaySwapVersion: '1.0.0',
    maxTestedPaySwapVersion: '1.2.0',
    breakingChanges: 'None — this is the initial release.',
    upgradeNotes: 'Run the v1.0.0 migration on install.',
    rollbackNotes: 'Drop the deliveries table on uninstall.',
  },

  // ── Billing ──
  billing: {
    model: 'USAGE_BASED',
    usageMetric: 'per_delivery',
    usagePrice: 0.50,
    currency: 'USD',
    trialDays: 30,
  },

  createdAt: Date.now(),
  updatedAt: Date.now(),
};
