/**
 * LiquidityMarketplaceService — the ONLY writer for offers + deterministic
 * matching. (M-RT-5.)
 *
 * RESPONSIBILITIES (market intent only):
 *   - Publish / withdraw offers (emit Domain Events)
 *   - Quote: which offers match a request?
 *   - Clear: which offers would clear if requested? (deterministic ranking)
 *
 * DOES NOT:
 *   - execute allocations
 *   - modify reserves
 *   - perform routing
 *   - invoke the compiler
 *
 * DEPENDENCY DIRECTION: reads Capability Graph + Reserve Market (for economics)
 * but does NOT write to them. The compiler is the first component that combines
 * everything.
 */

import type { EventStore } from '../../events';
import type { RuntimeClock } from '../../clock';
import type { Environment } from '../../types';
import type {
  LiquidityOffer,
  QuoteRequest,
  Quote,
  ClearingRequest,
  ClearingResult,
  MarketplaceUncommittedEvent,
  OrderBook,
  PricingCurveTier,
} from './types';
import { validateOffer, isExpired, canServeAmount, quoteFee } from './types';
import { OrderBookProjection } from './projection';

/** A publishable offer (id + publishedAt assigned by the service). */
export interface PublishableOffer {
  lpId: string;
  capabilityId: string;
  from: string;
  to: string;
  rail: import('../liquidity-market/types').Rail;
  maxAmount: number;
  minAmount: number;
  pricingCurve: PricingCurveTier[];
  latencyMs: number;
  riskScore: number;
  /** Expiry in ms (0 = never expires). */
  expiresAt: number;
}

/** Thrown when an offer violates invariants. */
export class OfferInvariantViolation extends Error {
  constructor(readonly violations: string[]) {
    super(`Offer invariant violations: ${violations.join('; ')}`);
    this.name = 'OfferInvariantViolation';
  }
}

/** The Liquidity Marketplace Service — the only writer for offers. */
export class LiquidityMarketplaceService {
  private projection = new OrderBookProjection();

  constructor(
    private eventStore: EventStore,
    private clock: RuntimeClock,
  ) {}

  /** Publish an offer. Emits offer.published. Enforces invariants. */
  async publish(
    offer: PublishableOffer,
    environment: Environment,
    actorId: string,
    correlationId: string,
  ): Promise<LiquidityOffer> {
    const id = `offer_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const fullOffer: LiquidityOffer = {
      id,
      ...offer,
      publishedAt: this.clock.now(),
      active: true,
    };

    // Enforce invariants before appending.
    const violations = validateOffer(fullOffer);
    if (violations.length > 0) throw new OfferInvariantViolation(violations);

    const streamId = `${environment}:offer:${id}`;
    const event: MarketplaceUncommittedEvent = {
      type: 'offer.published',
      streamId,
      streamType: 'offer',
      kind: 'domain',
      payload: fullOffer as unknown as Record<string, unknown>,
    };

    await this.appendEvents([event], streamId, { environment, actorId, correlationId });
    return fullOffer;
  }

  /** Withdraw an offer. Emits offer.withdrawn. */
  async withdraw(
    offerId: string,
    environment: Environment,
    actorId: string,
    correlationId: string,
  ): Promise<void> {
    const streamId = `${environment}:offer:${offerId}`;
    const event: MarketplaceUncommittedEvent = {
      type: 'offer.withdrawn',
      streamId,
      streamType: 'offer',
      kind: 'domain',
      payload: { offerId },
    };
    await this.appendEvents([event], streamId, { environment, actorId, correlationId });
  }

  /** Get the current order book (rebuilt from events). */
  async getOrderBook(environment: Environment): Promise<OrderBook> {
    const events = await this.eventStore.readAll(0, 10000);
    const offerEvents = events.filter(
      (e) => e.streamType === 'offer' && e.metadata.environment === environment,
    );
    return this.projection.rebuild(offerEvents, this.clock.now());
  }

  /** Quote: which offers match a request? Deterministic. */
  async quote(request: QuoteRequest, environment: Environment): Promise<Quote[]> {
    const book = await this.getOrderBook(environment);
    const candidates = book.forRoute(request.from, request.to);
    const quotes: Quote[] = [];

    for (const offer of candidates) {
      const quote = this.evaluateOffer(offer, request);
      quotes.push(quote);
    }

    return quotes;
  }

  /** Clear: which offers would clear? Deterministic ranking. */
  async clear(request: ClearingRequest, environment: Environment): Promise<ClearingResult> {
    const quotes = await this.quote(request, environment);

    const valid = quotes.filter((q) => q.status === 'valid');
    const rejected = quotes.filter((q) => q.status !== 'valid');

    // Deterministic ordering: sort by (feeBps, latencyMs, riskScore).
    valid.sort((a, b) => {
      if (a.feeBps !== b.feeBps) return a.feeBps - b.feeBps;
      if (a.latencyMs !== b.latencyMs) return a.latencyMs - b.latencyMs;
      return a.riskScore - b.riskScore;
    });

    const winner = valid.length > 0 ? valid[0] : null;

    return {
      request,
      quotes: valid,
      winner,
      rejected,
      canClear: winner !== null,
      generatedAt: this.clock.now(),
    };
  }

  // ── private ──────────────────────────────────────────────────────────

  private evaluateOffer(offer: LiquidityOffer, request: QuoteRequest): Quote {
    // Check expiry.
    if (isExpired(offer, request.now)) {
      return { ...this.baseQuote(offer, request), status: 'expired' };
    }

    // Check rail.
    if (request.rail && offer.rail !== request.rail) {
      return { ...this.baseQuote(offer, request), status: 'rail_mismatch' };
    }

    // Check amount.
    if (!canServeAmount(offer, request.amount)) {
      return { ...this.baseQuote(offer, request), status: 'insufficient_capacity' };
    }

    // Check minimum.
    if (request.amount < offer.minAmount) {
      return { ...this.baseQuote(offer, request), status: 'below_minimum' };
    }

    // Valid — compute the fee from the pricing curve.
    // M-RT-5: utilization = 0 (no historical utilization tracking yet).
    // The compiler (M-RT-7/8) will pass the LP's actual utilization.
    const feeBps = quoteFee(offer, 0);
    const feeAmount = Math.round(request.amount * feeBps) / 10000;

    return {
      offerId: offer.id,
      lpId: offer.lpId,
      from: offer.from,
      to: offer.to,
      amount: request.amount,
      feeBps,
      feeAmount,
      latencyMs: offer.latencyMs,
      riskScore: offer.riskScore,
      status: 'valid',
    };
  }

  private baseQuote(offer: LiquidityOffer, request: QuoteRequest): Omit<Quote, 'status'> {
    return {
      offerId: offer.id,
      lpId: offer.lpId,
      from: offer.from,
      to: offer.to,
      amount: request.amount,
      feeBps: 0,
      feeAmount: 0,
      latencyMs: offer.latencyMs,
      riskScore: offer.riskScore,
    };
  }

  private async appendEvents(
    events: MarketplaceUncommittedEvent[],
    streamId: string,
    params: { environment: Environment; actorId: string; correlationId: string },
  ): Promise<void> {
    const expectedVersion = this.eventStore.streamVersion(streamId) ?? -1;
    await this.eventStore.append(
      events,
      new Map([[streamId, expectedVersion]]),
      {
        intentId: params.correlationId,
        correlationId: params.correlationId,
        actor: params.actorId,
        environment: params.environment,
        timestamp: this.clock.now(),
      },
    );
  }
}
