/**
 * Parcel Delivery Extension — Domain Store + Logic.
 *
 * The extension's internal state: deliveries, couriers, bundles, auctions,
 * ratings, routes, tracking events. This is the extension's own data — not
 * platform state. It uses the platform SDK for cross-system operations.
 */

import { uid } from '@/runtime/types';
import { Money, money } from '@/money';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type DeliveryStatus = 'PENDING' | 'SCHEDULED' | 'PICKED_UP' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'CANCELLED';
export type AuctionMode = 'BULK' | 'OPEN';
export type AuctionStatus = 'OPEN' | 'SETTLED' | 'EXPIRED';
export type ShippingPayer = 'MERCHANT' | 'CUSTOMER' | 'INCLUDED';
export type DeliveryPriority = 'FASTEST' | 'CHEAPEST' | 'SAFEST' | 'CARBON_OPTIMIZED';

export interface DeliveryRequest {
  id: string;
  trackingNumber: string;
  merchantId: string;
  customerId: string;
  senderName: string;
  senderAddress: string;
  recipientName: string;
  recipientAddress: string;
  recipientContact: string;
  deliveryWindow?: { start: number; end: number };
  specialInstructions?: string;
  parcel: {
    weightKg: number;
    dimensionsCm: { length: number; width: number; height: number };
    fragile: boolean;
    temperatureControlled: boolean;
    oversized: boolean;
    declaredValue: number;
  };
  shippingPayer: ShippingPayer;
  priority: DeliveryPriority;
  maxBudget?: Money;
  preferredCourier?: string;
  deadline?: number;
  insuranceRequired: boolean;
  signatureRequired: boolean;
  groupedAllowed: boolean;
  transitHubsAllowed: boolean;
  partialDeliveryAllowed: boolean;
  status: DeliveryStatus;
  price: Money;
  courierId?: string;
  bundleId?: string;
  routeId?: string;
  auctionId?: string;
  insurancePolicyId?: string;
  createdAt: number;
  updatedAt: number;
  deliveredAt?: number;
}

export interface Courier {
  id: string;
  name: string;
  rating: number;              // 0–5
  totalDeliveries: number;
  successfulDeliveries: number;
  avgDeliveryTimeHours: number;
  vehicleCapacityKg: number;
  carbonPerKm: number;
  jurisdictions: string[];
  active: boolean;
  joinedAt: number;
}

export interface DeliveryBundle {
  id: string;
  deliveryIds: string[];
  neighborhood: string;
  totalWeightKg: number;
  estimatedRouteKm: number;
  estimatedDurationHours: number;
  estimatedCost: Money;
  estimatedCarbon: number;
  courierId?: string;
  status: 'OPEN' | 'AUCTIONED' | 'ASSIGNED' | 'COMPLETED';
  createdAt: number;
}

export interface CourierAuction {
  id: string;
  bundleId: string;
  mode: AuctionMode;
  status: AuctionStatus;
  deliveryIds: string[];
  estimatedRevenue: Money;
  estimatedDurationHours: number;
  bids: AuctionBid[];
  winningBidId?: string;
  startedAt: number;
  expiresAt: number;
  settledAt?: number;
}

export interface AuctionBid {
  id: string;
  auctionId: string;
  courierId: string;
  courierName: string;
  amount: Money;
  estimatedHours: number;
  rating: number;
  placedAt: number;
}

export interface TrackingEvent {
  id: string;
  deliveryId: string;
  trackingNumber: string;
  status: DeliveryStatus;
  location?: { lat: number; lng: number; address?: string };
  detail: string;
  timestamp: number;
}

export interface DeliveryRating {
  id: string;
  deliveryId: string;
  ratedBy: 'MERCHANT' | 'CUSTOMER' | 'SYSTEM';
  target: 'COURIER' | 'DRIVER' | 'PICKUP_AGENT' | 'DROPOFF_AGENT' | 'TRANSIT_HUB';
  targetId: string;
  rating: number;              // 1–5
  comment?: string;
  createdAt: number;
}

export interface ShippingConfig {
  merchantId: string;
  shippingPayer: ShippingPayer;
  maxBudget?: Money;
  preferredCourier?: string;
  defaultPriority: DeliveryPriority;
  deadlineHours?: number;
  groupedAllowed: boolean;
  transitHubsAllowed: boolean;
  partialDeliveryAllowed: boolean;
  insuranceThreshold: Money;
  signatureRequired: boolean;
}

export interface RoutePlan {
  id: string;
  deliveryIds: string[];
  waypoints: Array<{ address: string; lat: number; lng: number; deliveryId: string }>;
  totalDistanceKm: number;
  estimatedDurationHours: number;
  estimatedCost: Money;
  estimatedCarbon: number;
  optimizedFor: DeliveryPriority;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE (in-memory, scoped to this extension)
// ═══════════════════════════════════════════════════════════════════════════

interface ParcelStore {
  deliveries: Map<string, DeliveryRequest>;
  couriers: Map<string, Courier>;
  bundles: Map<string, DeliveryBundle>;
  auctions: Map<string, CourierAuction>;
  tracking: TrackingEvent[];
  ratings: DeliveryRating[];
  configs: Map<string, ShippingConfig>;
  routes: Map<string, RoutePlan>;
}

const globalForParcel = globalThis as unknown as { __PARCEL_DELIVERY_STORE__?: ParcelStore };

const store: ParcelStore = globalForParcel.__PARCEL_DELIVERY_STORE__ ?? {
  deliveries: new Map(), couriers: new Map(), bundles: new Map(), auctions: new Map(),
  tracking: [], ratings: [], configs: new Map(), routes: new Map(),
};
if (!globalForParcel.__PARCEL_DELIVERY_STORE__) {
  globalForParcel.__PARCEL_DELIVERY_STORE__ = store;
  seedCouriers();
}

function seedCouriers() {
  const couriers: Courier[] = [
    { id: 'courier_gh_express', name: 'GH Express', rating: 4.8, totalDeliveries: 12400, successfulDeliveries: 12200, avgDeliveryTimeHours: 18, vehicleCapacityKg: 500, carbonPerKm: 0.12, jurisdictions: ['GH'], active: true, joinedAt: Date.now() - 86400000 * 365 },
    { id: 'courier_west_africa', name: 'West Africa Logistics', rating: 4.5, totalDeliveries: 8200, successfulDeliveries: 8000, avgDeliveryTimeHours: 36, vehicleCapacityKg: 2000, carbonPerKm: 0.18, jurisdictions: ['GH', 'NG', 'TG'], active: true, joinedAt: Date.now() - 86400000 * 300 },
    { id: 'courier_eco_delivery', name: 'Eco Delivery', rating: 4.6, totalDeliveries: 3400, successfulDeliveries: 3350, avgDeliveryTimeHours: 24, vehicleCapacityKg: 300, carbonPerKm: 0.05, jurisdictions: ['GH'], active: true, joinedAt: Date.now() - 86400000 * 180 },
    { id: 'courier_speed_link', name: 'Speed Link', rating: 4.3, totalDeliveries: 15600, successfulDeliveries: 14900, avgDeliveryTimeHours: 12, vehicleCapacityKg: 800, carbonPerKm: 0.22, jurisdictions: ['GH', 'NG'], active: true, joinedAt: Date.now() - 86400000 * 400 },
    { id: 'courier_kenya_fast', name: 'Kenya Fast', rating: 4.7, totalDeliveries: 6800, successfulDeliveries: 6700, avgDeliveryTimeHours: 16, vehicleCapacityKg: 600, carbonPerKm: 0.15, jurisdictions: ['KE'], active: true, joinedAt: Date.now() - 86400000 * 250 },
  ];
  for (const c of couriers) store.couriers.set(c.id, c);
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE — the extension's business logic
// ═══════════════════════════════════════════════════════════════════════════

export const parcelService = {
  // ── Deliveries ──
  createDelivery(input: {
    merchantId: string; customerId: string; senderName: string; senderAddress: string;
    recipientName: string; recipientAddress: string; recipientContact: string;
    deliveryWindow?: { start: number; end: number }; specialInstructions?: string;
    parcel: DeliveryRequest['parcel'];
    shippingPayer?: ShippingPayer; priority?: DeliveryPriority; maxBudget?: number;
    preferredCourier?: string; deadline?: number; insuranceRequired?: boolean;
    signatureRequired?: boolean; groupedAllowed?: boolean; transitHubsAllowed?: boolean;
    partialDeliveryAllowed?: boolean;
  }): DeliveryRequest {
    const trackingNumber = `TRK${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const price = calculateDeliveryPrice(input.parcel, input.priority ?? 'CHEAPEST', input.senderAddress, input.recipientAddress);
    const delivery: DeliveryRequest = {
      id: uid('del'), trackingNumber,
      merchantId: input.merchantId, customerId: input.customerId,
      senderName: input.senderName, senderAddress: input.senderAddress,
      recipientName: input.recipientName, recipientAddress: input.recipientAddress,
      recipientContact: input.recipientContact,
      deliveryWindow: input.deliveryWindow, specialInstructions: input.specialInstructions,
      parcel: input.parcel,
      shippingPayer: input.shippingPayer ?? 'MERCHANT',
      priority: input.priority ?? 'CHEAPEST',
      maxBudget: input.maxBudget ? money.usd(input.maxBudget) : undefined,
      preferredCourier: input.preferredCourier,
      deadline: input.deadline,
      insuranceRequired: input.insuranceRequired ?? (input.parcel.declaredValue > 500),
      signatureRequired: input.signatureRequired ?? false,
      groupedAllowed: input.groupedAllowed ?? true,
      transitHubsAllowed: input.transitHubsAllowed ?? true,
      partialDeliveryAllowed: input.partialDeliveryAllowed ?? false,
      status: 'PENDING', price,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    store.deliveries.set(delivery.id, delivery);
    addTrackingEvent(delivery.id, delivery.trackingNumber, 'PENDING', 'Delivery request created');
    return delivery;
  },

  cancelDelivery(deliveryId: string, reason: string): DeliveryRequest | null {
    const d = store.deliveries.get(deliveryId);
    if (!d) return null;
    if (d.status === 'DELIVERED') return null;
    d.status = 'CANCELLED'; d.updatedAt = Date.now();
    addTrackingEvent(d.id, d.trackingNumber, 'CANCELLED', `Cancelled: ${reason}`);
    return d;
  },

  scheduleDelivery(deliveryId: string, window: { start: number; end: number }): DeliveryRequest | null {
    const d = store.deliveries.get(deliveryId);
    if (!d) return null;
    d.deliveryWindow = window; d.status = 'SCHEDULED'; d.updatedAt = Date.now();
    addTrackingEvent(d.id, d.trackingNumber, 'SCHEDULED', `Scheduled for ${new Date(window.start).toISOString()}`);
    return d;
  },

  getDelivery(id: string): DeliveryRequest | undefined { return store.deliveries.get(id); },
  getDeliveryByTracking(trackingNumber: string): DeliveryRequest | undefined {
    return Array.from(store.deliveries.values()).find((d) => d.trackingNumber === trackingNumber);
  },
  listDeliveries(merchantId?: string): DeliveryRequest[] {
    let rows = Array.from(store.deliveries.values());
    if (merchantId) rows = rows.filter((d) => d.merchantId === merchantId);
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },

  // ── Grouping ──
  discoverBundles(): DeliveryBundle[] {
    const pending = Array.from(store.deliveries.values()).filter((d) => d.status === 'PENDING' && d.groupedAllowed);
    // Group by neighborhood (simplified — by first 3 chars of address)
    const byNeighborhood = new Map<string, DeliveryRequest[]>();
    for (const d of pending) {
      const neighborhood = d.recipientAddress.slice(0, 10).toLowerCase();
      if (!byNeighborhood.has(neighborhood)) byNeighborhood.set(neighborhood, []);
      byNeighborhood.get(neighborhood)!.push(d);
    }
    const bundles: DeliveryBundle[] = [];
    for (const [neighborhood, deliveries] of byNeighborhood) {
      if (deliveries.length < 2) continue; // only group if 2+ deliveries
      const totalWeight = deliveries.reduce((s, d) => s + d.parcel.weightKg, 0);
      const routeKm = 20 + Math.random() * 40; // simplified
      const durationHours = 2 + deliveries.length * 0.5;
      const cost = money.usd(5 + deliveries.length * 1.5);
      const carbon = routeKm * 0.12;
      const bundle: DeliveryBundle = {
        id: uid('bundle'), deliveryIds: deliveries.map((d) => d.id), neighborhood,
        totalWeightKg: totalWeight, estimatedRouteKm: routeKm,
        estimatedDurationHours: durationHours, estimatedCost: cost, estimatedCarbon: carbon,
        status: 'OPEN', createdAt: Date.now(),
      };
      store.bundles.set(bundle.id, bundle);
      for (const d of deliveries) { d.bundleId = bundle.id; d.updatedAt = Date.now(); }
      bundles.push(bundle);
    }
    return bundles;
  },

  // ── Auctions ──
  startAuction(bundleId: string, mode: AuctionMode): CourierAuction | null {
    const bundle = store.bundles.get(bundleId);
    if (!bundle) return null;
    const revenue = bundle.estimatedCost;
    const auction: CourierAuction = {
      id: uid('auction'), bundleId, mode, status: 'OPEN',
      deliveryIds: bundle.deliveryIds, estimatedRevenue: revenue,
      estimatedDurationHours: bundle.estimatedDurationHours,
      bids: [], startedAt: Date.now(), expiresAt: Date.now() + (mode === 'BULK' ? 3600000 : 1800000),
    };
    store.auctions.set(auction.id, auction);
    bundle.status = 'AUCTIONED';
    for (const did of bundle.deliveryIds) {
      const d = store.deliveries.get(did);
      if (d) { d.auctionId = auction.id; d.updatedAt = Date.now(); }
    }
    return auction;
  },

  placeBid(auctionId: string, courierId: string, amount: number, estimatedHours: number): AuctionBid | null {
    const auction = store.auctions.get(auctionId);
    if (!auction || auction.status !== 'OPEN') return null;
    const courier = store.couriers.get(courierId);
    if (!courier || !courier.active) return null;
    const bid: AuctionBid = {
      id: uid('bid'), auctionId, courierId, courierName: courier.name,
      amount: money.usd(amount), estimatedHours, rating: courier.rating, placedAt: Date.now(),
    };
    auction.bids.push(bid);
    return bid;
  },

  settleAuction(auctionId: string): CourierAuction | null {
    const auction = store.auctions.get(auctionId);
    if (!auction || auction.status !== 'OPEN') return null;
    if (auction.bids.length === 0) { auction.status = 'EXPIRED'; auction.settledAt = Date.now(); return auction; }
    // Pick the best bid: lowest amount × (1 / rating) — favors cheap + reliable
    auction.bids.sort((a, b) => {
      const scoreA = a.amount.toNumber() * (1 / a.rating);
      const scoreB = b.amount.toNumber() * (1 / b.rating);
      return scoreA - scoreB;
    });
    const winner = auction.bids[0];
    auction.winningBidId = winner.id; auction.status = 'SETTLED'; auction.settledAt = Date.now();
    // Assign courier to deliveries
    for (const did of auction.deliveryIds) {
      const d = store.deliveries.get(did);
      if (d) { d.courierId = winner.courierId; d.status = 'SCHEDULED'; d.updatedAt = Date.now(); }
    }
    const bundle = store.bundles.get(auction.bundleId);
    if (bundle) { bundle.courierId = winner.courierId; bundle.status = 'ASSIGNED'; }
    return auction;
  },

  listAuctions(): CourierAuction[] { return Array.from(store.auctions.values()).sort((a, b) => b.startedAt - a.startedAt); },
  getAuction(id: string): CourierAuction | undefined { return store.auctions.get(id); },

  // ── Tracking ──
  addTrackingEvent: addTrackingEvent,
  getTracking(trackingNumber: string): TrackingEvent[] {
    return store.tracking.filter((t) => t.trackingNumber === trackingNumber).sort((a, b) => b.timestamp - a.timestamp);
  },

  // ── Proof of Delivery ──
  submitProofOfDelivery(deliveryId: string, proof: { photoUrl?: string; signatureUrl?: string; gps?: { lat: number; lng: number } }): DeliveryRequest | null {
    const d = store.deliveries.get(deliveryId);
    if (!d) return null;
    d.status = 'DELIVERED'; d.deliveredAt = Date.now(); d.updatedAt = Date.now();
    addTrackingEvent(d.id, d.trackingNumber, 'DELIVERED', `Delivered at ${proof.gps ? `${proof.gps.lat},${proof.gps.lng}` : 'unknown location'}`);
    return d;
  },

  // ── Ratings ──
  rateDelivery(deliveryId: string, ratedBy: DeliveryRating['ratedBy'], target: DeliveryRating['target'], targetId: string, rating: number, comment?: string): DeliveryRating {
    const r: DeliveryRating = { id: uid('rate'), deliveryId, ratedBy, target, targetId, rating, comment, createdAt: Date.now() };
    store.ratings.push(r);
    // Update courier rating
    if (target === 'COURIER') {
      const courier = store.couriers.get(targetId);
      if (courier) {
        const totalRating = courier.rating * courier.totalDeliveries + rating;
        courier.totalDeliveries++;
        courier.rating = totalRating / courier.totalDeliveries;
      }
    }
    return r;
  },

  // ── Configuration ──
  configureShipping(merchantId: string, config: Partial<ShippingConfig>): ShippingConfig {
    const existing = store.configs.get(merchantId) ?? {
      merchantId, shippingPayer: 'MERCHANT' as ShippingPayer,
      defaultPriority: 'CHEAPEST' as DeliveryPriority, groupedAllowed: true,
      transitHubsAllowed: true, partialDeliveryAllowed: false,
      insuranceThreshold: money.usd(500), signatureRequired: false,
    };
    const updated = { ...existing, ...config, merchantId };
    store.configs.set(merchantId, updated);
    return updated;
  },
  getConfig(merchantId: string): ShippingConfig | undefined { return store.configs.get(merchantId); },

  // ── Couriers ──
  listCouriers(): Courier[] { return Array.from(store.couriers.values()).filter((c) => c.active).sort((a, b) => b.rating - a.rating); },

  // ── Routes ──
  optimizeRoute(deliveryIds: string[], priority: DeliveryPriority): RoutePlan {
    const deliveries = deliveryIds.map((id) => store.deliveries.get(id)).filter((d): d is DeliveryRequest => !!d);
    const waypoints = deliveries.map((d) => ({
      address: d.recipientAddress, lat: 5.6 + Math.random() * 0.2, lng: -0.2 + Math.random() * 0.2, deliveryId: d.id,
    }));
    const totalDistanceKm = 15 + deliveries.length * 8;
    const durationHours = 1 + deliveries.length * 0.4;
    let cost = money.usd(8 + deliveries.length * 2);
    let carbon = totalDistanceKm * 0.12;
    if (priority === 'CARBON_OPTIMIZED') carbon *= 0.6; // eco routing
    if (priority === 'FASTEST') { cost = cost.multiply(1.3); }
    const route: RoutePlan = {
      id: uid('route'), deliveryIds, waypoints, totalDistanceKm,
      estimatedDurationHours: durationHours, estimatedCost: cost, estimatedCarbon: carbon,
      optimizedFor: priority, createdAt: Date.now(),
    };
    store.routes.set(route.id, route);
    for (const d of deliveries) { d.routeId = route.id; d.updatedAt = Date.now(); }
    return route;
  },

  // ── Stats / Health ──
  stats() {
    const deliveries = Array.from(store.deliveries.values());
    return {
      totalDeliveries: deliveries.length,
      pending: deliveries.filter((d) => d.status === 'PENDING').length,
      inTransit: deliveries.filter((d) => d.status === 'IN_TRANSIT' || d.status === 'PICKED_UP').length,
      delivered: deliveries.filter((d) => d.status === 'DELIVERED').length,
      cancelled: deliveries.filter((d) => d.status === 'CANCELLED').length,
      activeBundles: Array.from(store.bundles.values()).filter((b) => b.status === 'OPEN' || b.status === 'AUCTIONED').length,
      activeAuctions: Array.from(store.auctions.values()).filter((a) => a.status === 'OPEN').length,
      totalCouriers: store.couriers.size,
      avgCourierRating: Array.from(store.couriers.values()).reduce((s, c) => s + c.rating, 0) / Math.max(1, store.couriers.size),
      totalRevenue: deliveries.filter((d) => d.status === 'DELIVERED').reduce((s, d) => s + d.price.toNumber(), 0),
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function calculateDeliveryPrice(parcel: DeliveryRequest['parcel'], priority: DeliveryPriority, from: string, to: string): Money {
  let base = 5.00;
  base += parcel.weightKg * 0.50;
  if (parcel.fragile) base += 2.00;
  if (parcel.temperatureControlled) base += 3.00;
  if (parcel.oversized) base += 5.00;
  if (priority === 'FASTEST') base *= 1.5;
  if (priority === 'SAFEST') base *= 1.2;
  if (priority === 'CARBON_OPTIMIZED') base *= 1.1;
  return money.usd(base);
}

function addTrackingEvent(deliveryId: string, trackingNumber: string, status: DeliveryStatus, detail: string) {
  const event: TrackingEvent = {
    id: uid('trk'), deliveryId, trackingNumber, status, detail, timestamp: Date.now(),
  };
  store.tracking.push(event);
  if (store.tracking.length > 500) store.tracking.length = 500;
}
