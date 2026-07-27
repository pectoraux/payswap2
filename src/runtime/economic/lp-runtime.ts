/**
 * LP Runtime — Liquidity Providers as first-class runtime actors.
 * (M-RT-25, Economic Kernel.)
 *
 * LPs are no longer just configuration. They are runtime participants that
 * expose:
 *   - supported corridors
 *   - capacity
 *   - spreads
 *   - reserve requirements
 *   - latency
 *   - confidence
 *   - risk score
 *
 * LPs register, update their offers, and withdraw — all through events.
 * The marketplace queries the LP runtime to discover available liquidity.
 */

import type { StoredEvent } from '../events';

// ─── LP Types ──────────────────────────────────────────────────────────────

export interface EconomicLPProfile {
  lpId: string;
  name: string;
  isActive: boolean;
  supportedCorridors: LPCorridor[];
  totalCapacity: number;
  reserveRequirement: number;
  confidence: number;
  riskScore: number;
  registeredAt: number;
  lastUpdated: number;
}

export interface LPCorridor {
  from: string;
  to: string;
  capacity: number;
  spreadBps: number;
  latencyMs: number;
}

export interface LPOffer {
  offerId: string;
  lpId: string;
  from: string;
  to: string;
  capacity: number;
  spreadBps: number;
  latencyMs: number;
  confidence: number;
  riskScore: number;
  expiresAt: number;
  publishedAt: number;
}

// ─── Event Payloads ────────────────────────────────────────────────────────

export interface LPRegisteredPayload {
  lpId: string;
  name: string;
  reserveRequirement: number;
  registeredAt: number;
}

export interface LPCorridorAddedPayload {
  lpId: string;
  from: string;
  to: string;
  capacity: number;
  spreadBps: number;
  latencyMs: number;
}

export interface LPCorridorUpdatedPayload {
  lpId: string;
  from: string;
  to: string;
  capacity: number;
  spreadBps: number;
  latencyMs: number;
}

export interface LPScoredPayload {
  lpId: string;
  confidence: number;
  riskScore: number;
  scoredAt: number;
}

export interface LPOfferPublishedPayload {
  offerId: string;
  lpId: string;
  from: string;
  to: string;
  capacity: number;
  spreadBps: number;
  latencyMs: number;
  confidence: number;
  riskScore: number;
  expiresAt: number;
  publishedAt: number;
}

export interface LPOfferWithdrawnPayload {
  offerId: string;
  withdrawnAt: number;
}

// ─── LP Projection ─────────────────────────────────────────────────────────

export class LPRuntimeProjection {
  private readonly lps = new Map<string, EconomicLPProfile>();
  private readonly offers = new Map<string, LPOffer>();
  private lastPosition = -1;
  private eventsAppliedCount = 0;

  async apply(events: StoredEvent[]): Promise<void> {
    for (const ev of events) {
      this.applyOne(ev);
      this.eventsAppliedCount++;
    }
    if (events.length > 0) {
      this.lastPosition = events[events.length - 1].globalPosition;
    }
  }

  async rebuild(allEvents: StoredEvent[]): Promise<void> {
    this.lps.clear();
    this.offers.clear();
    this.lastPosition = -1;
    this.eventsAppliedCount = 0;
    for (const ev of allEvents) {
      this.applyOne(ev);
      this.eventsAppliedCount++;
    }
    if (allEvents.length > 0) {
      this.lastPosition = allEvents[allEvents.length - 1].globalPosition;
    }
  }

  checkpoint(): number {
    return this.lastPosition;
  }

  getLP(lpId: string): EconomicLPProfile | null {
    return this.lps.get(lpId) ?? null;
  }

  listLPs(): EconomicLPProfile[] {
    return [...this.lps.values()].filter((lp) => lp.isActive).sort((a, b) => b.lastUpdated - a.lastUpdated);
  }

  getOffer(offerId: string): LPOffer | null {
    return this.offers.get(offerId) ?? null;
  }

  listOffers(query?: { from?: string; to?: string; lpId?: string }): LPOffer[] {
    let result = [...this.offers.values()].filter((o) => o.expiresAt === 0 || o.expiresAt > Date.now());
    if (query?.from) result = result.filter((o) => o.from === query.from);
    if (query?.to) result = result.filter((o) => o.to === query.to);
    if (query?.lpId) result = result.filter((o) => o.lpId === query.lpId);
    return result.sort((a, b) => a.spreadBps - b.spreadBps); // cheapest first
  }

  /** Find LPs that can serve a specific corridor. */
  findLPsForCorridor(from: string, to: string): EconomicLPProfile[] {
    return this.listLPs().filter((lp) =>
      lp.supportedCorridors.some((c) => c.from === from && c.to === to && c.capacity > 0),
    );
  }

  /** Get all active offers for a corridor (for marketplace auction). */
  offersForCorridor(from: string, to: string): LPOffer[] {
    return this.listOffers({ from, to });
  }

  count(): number {
    return this.lps.size;
  }

  offerCount(): number {
    return this.offers.size;
  }

  eventsApplied(): number {
    return this.eventsAppliedCount;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private applyOne(event: StoredEvent): void {
    const ts = event.metadata.timestamp;
    switch (event.type) {
      case 'lp.registered': {
        const p = event.payload as unknown as LPRegisteredPayload;
        if (this.lps.has(p.lpId)) return; // idempotent
        this.lps.set(p.lpId, {
          lpId: p.lpId,
          name: p.name,
          isActive: true,
          supportedCorridors: [],
          totalCapacity: 0,
          reserveRequirement: p.reserveRequirement,
          confidence: 0.5, // default
          riskScore: 0.5, // default
          registeredAt: p.registeredAt,
          lastUpdated: ts,
        });
        break;
      }
      case 'lp.corridor.added':
      case 'lp.corridor.updated': {
        const p = event.payload as unknown as LPCorridorAddedPayload;
        const lp = this.lps.get(p.lpId);
        if (!lp) return;
        const existing = lp.supportedCorridors.findIndex((c) => c.from === p.from && c.to === p.to);
        const corridor: LPCorridor = { from: p.from, to: p.to, capacity: p.capacity, spreadBps: p.spreadBps, latencyMs: p.latencyMs };
        if (existing >= 0) {
          lp.supportedCorridors[existing] = corridor;
        } else {
          lp.supportedCorridors.push(corridor);
        }
        lp.totalCapacity = lp.supportedCorridors.reduce((s, c) => s + c.capacity, 0);
        lp.lastUpdated = ts;
        break;
      }
      case 'lp.scored': {
        const p = event.payload as unknown as LPScoredPayload;
        const lp = this.lps.get(p.lpId);
        if (!lp) return;
        lp.confidence = p.confidence;
        lp.riskScore = p.riskScore;
        lp.lastUpdated = ts;
        break;
      }
      case 'lp.offer.published': {
        const p = event.payload as unknown as LPOfferPublishedPayload;
        this.offers.set(p.offerId, {
          offerId: p.offerId,
          lpId: p.lpId,
          from: p.from,
          to: p.to,
          capacity: p.capacity,
          spreadBps: p.spreadBps,
          latencyMs: p.latencyMs,
          confidence: p.confidence,
          riskScore: p.riskScore,
          expiresAt: p.expiresAt,
          publishedAt: p.publishedAt,
        });
        break;
      }
      case 'lp.offer.withdrawn': {
        const p = event.payload as unknown as LPOfferWithdrawnPayload;
        this.offers.delete(p.offerId);
        break;
      }
      default:
        break;
    }
  }
}
