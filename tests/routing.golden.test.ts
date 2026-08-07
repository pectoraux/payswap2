/**
 * CI-3: Golden routing test — the Part 0 contract.
 *
 * This test snapshots `resolvePayment()` output for a fixture matrix of
 * corridors × reserve states × amounts. It MUST stay stable across all
 * P1 (money types) and P3 (scale) work. If this snapshot changes, a ticket
 * overstepped — the routing model is supposed to be frozen.
 *
 * The fixtures cover:
 *   - LOCAL_RAIL (same country, same currency)
 *   - RESERVE_TO_RESERVE (both have FIAT)
 *   - RESERVE_TO_MARKET (sender has FIAT, receiver doesn't)
 *   - MARKET_TO_RESERVE (sender doesn't, receiver does)
 *   - MARKET_TO_MARKET (neither has FIAT)
 *   - Edge cases: insufficient reserves, tier fallback, no bandwidth
 *
 * Run: `bun test tests/routing.golden.test.ts`
 */

import { describe, it, expect } from 'bun:test';
import {
  resolvePayment,
  isLocal,
  twinTokenCode,
  type SettlementTier,
} from '../src/runtime/liquidity/settlement-waterfall';

// ── Fixture matrix ────────────────────────────────────────────────────────

interface RoutingFixture {
  name: string;
  input: Parameters<typeof resolvePayment>[0];
  expectedStrategy: string;
  expectedSendLegTier: SettlementTier;
  expectedReceiveLegTier: SettlementTier;
  expectedIsLocal: boolean;
}

const FIXTURES: RoutingFixture[] = [
  // ── LOCAL_RAIL ──
  {
    name: 'LOCAL_RAIL: GHS→GHS same country',
    input: {
      originCountry: 'Ghana', destinationCountry: 'Ghana',
      sourceCurrency: 'GHS', destinationCurrency: 'GHS',
      amount: 500,
      senderHasFiatReserve: true, senderFiatReserveAmount: 50_000,
      receiverHasFiatReserve: true, receiverFiatReserveAmount: 50_000,
      senderLpFiatAvailable: 30_000, receiverLpFiatAvailable: 30_000,
      payswapStablecoinAvailable: 20_000, payswapTwinTokenAvailable: 50_000,
      lpCryptoAvailable: 110_000,
    },
    expectedStrategy: 'LOCAL_RAIL',
    expectedSendLegTier: 1, // PaySwap FIAT
    expectedReceiveLegTier: 1, // PaySwap FIAT
    expectedIsLocal: true,
  },
  {
    name: 'LOCAL_RAIL: GHS→GHS, PaySwap FIAT insufficient → tier 4 (LP crypto)',
    input: {
      originCountry: 'Ghana', destinationCountry: 'Ghana',
      sourceCurrency: 'GHS', destinationCurrency: 'GHS',
      amount: 60_000, // exceeds PaySwap's 50K FIAT + 30K LP FIAT + 20K stablecoin individually
      senderHasFiatReserve: true, senderFiatReserveAmount: 50_000,
      receiverHasFiatReserve: true, receiverFiatReserveAmount: 50_000,
      senderLpFiatAvailable: 30_000, receiverLpFiatAvailable: 30_000,
      payswapStablecoinAvailable: 20_000, payswapTwinTokenAvailable: 50_000,
      lpCryptoAvailable: 110_000,
    },
    // resolveLeg tries: tier 1 (50K < 60K) → tier 2 (30K < 60K) → tier 3 (20K < 60K) → tier 4 (110K ≥ 60K)
    expectedStrategy: 'LOCAL_RAIL',
    expectedSendLegTier: 4, // LP crypto
    expectedReceiveLegTier: 4, // LP crypto
    expectedIsLocal: true,
  },

  // ── RESERVE_TO_RESERVE ──
  {
    name: 'RESERVE_TO_RESERVE: GHS→KES both have FIAT',
    input: {
      originCountry: 'Ghana', destinationCountry: 'Kenya',
      sourceCurrency: 'GHS', destinationCurrency: 'KES',
      amount: 5_000,
      senderHasFiatReserve: true, senderFiatReserveAmount: 50_000,
      receiverHasFiatReserve: true, receiverFiatReserveAmount: 40_000,
      senderLpFiatAvailable: 30_000, receiverLpFiatAvailable: 20_000,
      payswapStablecoinAvailable: 20_000, payswapTwinTokenAvailable: 50_000,
      lpCryptoAvailable: 110_000,
    },
    expectedStrategy: 'RESERVE_TO_RESERVE',
    expectedSendLegTier: 1, // PaySwap FIAT (sender)
    expectedReceiveLegTier: 1, // PaySwap FIAT (receiver)
    expectedIsLocal: false,
  },

  // ── RESERVE_TO_MARKET ──
  // Note: the strategy name is derived from the per-leg TIER, not from
  // hasFiatReserve. When receiver has no FIAT reserve but LP FIAT bandwidth
  // is available, the receive leg resolves to tier 2 (LP FIAT) = RESERVE.
  // The strategy name labels the tier result, not the boolean input.
  {
    name: 'RESERVE_TO_RESERVE: GHS→NGN, sender has FIAT, receiver uses LP FIAT',
    input: {
      originCountry: 'Ghana', destinationCountry: 'Nigeria',
      sourceCurrency: 'GHS', destinationCurrency: 'NGN',
      amount: 1_500,
      senderHasFiatReserve: true, senderFiatReserveAmount: 50_000,
      receiverHasFiatReserve: false, receiverFiatReserveAmount: 0,
      senderLpFiatAvailable: 30_000, receiverLpFiatAvailable: 15_000,
      payswapStablecoinAvailable: 20_000, payswapTwinTokenAvailable: 50_000,
      lpCryptoAvailable: 110_000,
    },
    expectedStrategy: 'RESERVE_TO_RESERVE', // both legs resolve to tier ≤ 2
    expectedSendLegTier: 1, // PaySwap FIAT (sender has reserve)
    expectedReceiveLegTier: 2, // LP FIAT (receiver has no FIAT but LP bandwidth)
    expectedIsLocal: false,
  },

  // ── MARKET_TO_RESERVE: sender no FIAT, no LP FIAT → tier 3; receiver has FIAT → tier 1 ──
  {
    name: 'MARKET_TO_RESERVE: NGN→GHS, sender no FIAT no LP, receiver has FIAT',
    input: {
      originCountry: 'Nigeria', destinationCountry: 'Ghana',
      sourceCurrency: 'NGN', destinationCurrency: 'GHS',
      amount: 5_000,
      senderHasFiatReserve: false, senderFiatReserveAmount: 0,
      receiverHasFiatReserve: true, receiverFiatReserveAmount: 50_000,
      senderLpFiatAvailable: 0, receiverLpFiatAvailable: 0,
      payswapStablecoinAvailable: 20_000, payswapTwinTokenAvailable: 50_000,
      lpCryptoAvailable: 110_000,
    },
    expectedStrategy: 'MARKET_TO_RESERVE',
    expectedSendLegTier: 3, // PaySwap crypto (sender has no FIAT, no LP FIAT)
    expectedReceiveLegTier: 1, // PaySwap FIAT (receiver has reserve)
    expectedIsLocal: false,
  },

  // ── MARKET_TO_MARKET: neither has FIAT, neither has LP FIAT ──
  // Send leg: tier 3 (PaySwap stablecoin). Receive leg: tier 4 (LP crypto)
  // because Togo has no twin token (no FIAT reserve → payswapTwinTokenAvailable=0).
  {
    name: 'MARKET_TO_MARKET: NGN→XOF, neither has FIAT, no LP FIAT',
    input: {
      originCountry: 'Nigeria', destinationCountry: 'Togo',
      sourceCurrency: 'NGN', destinationCurrency: 'XOF',
      amount: 10_000,
      senderHasFiatReserve: false, senderFiatReserveAmount: 0,
      receiverHasFiatReserve: false, receiverFiatReserveAmount: 0,
      senderLpFiatAvailable: 0, receiverLpFiatAvailable: 0,
      payswapStablecoinAvailable: 20_000, payswapTwinTokenAvailable: 0,
      lpCryptoAvailable: 110_000,
    },
    expectedStrategy: 'MARKET_TO_MARKET',
    expectedSendLegTier: 3, // PaySwap stablecoin (20K ≥ 10K)
    expectedReceiveLegTier: 4, // LP crypto (no twin token for XOF)
    expectedIsLocal: false,
  },

  // ── Edge: everything exhausted → tier 5 (auction) ──
  {
    name: 'TIER 5: KES→XOF, no reserves, no bandwidth, no crypto',
    input: {
      originCountry: 'Kenya', destinationCountry: 'Togo',
      sourceCurrency: 'KES', destinationCurrency: 'XOF',
      amount: 100_000,
      senderHasFiatReserve: false, senderFiatReserveAmount: 0,
      receiverHasFiatReserve: false, receiverFiatReserveAmount: 0,
      senderLpFiatAvailable: 0, receiverLpFiatAvailable: 0,
      payswapStablecoinAvailable: 0, payswapTwinTokenAvailable: 0,
      lpCryptoAvailable: 0,
    },
    expectedStrategy: 'MARKET_TO_MARKET',
    expectedSendLegTier: 5, // Auction
    expectedReceiveLegTier: 5, // Auction
    expectedIsLocal: false,
  },

  // ── Edge: large amount exceeds everything → tier 5 ──
  {
    name: 'TIER 5 fallback: GHS→NGN, amount exceeds all reserves',
    input: {
      originCountry: 'Ghana', destinationCountry: 'Nigeria',
      sourceCurrency: 'GHS', destinationCurrency: 'NGN',
      amount: 1_000_000,
      senderHasFiatReserve: true, senderFiatReserveAmount: 50_000,
      receiverHasFiatReserve: false, receiverFiatReserveAmount: 0,
      senderLpFiatAvailable: 30_000, receiverLpFiatAvailable: 15_000,
      payswapStablecoinAvailable: 20_000, payswapTwinTokenAvailable: 50_000,
      lpCryptoAvailable: 110_000,
    },
    expectedStrategy: 'MARKET_TO_MARKET', // both legs resolve to tier 5
    expectedSendLegTier: 5, // Auction (sender side: 1M > 50K+30K+20K)
    expectedReceiveLegTier: 5, // Auction (receiver side: 1M > 15K+50K+110K)
    expectedIsLocal: false,
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CI-3: Golden routing test (Part 0 contract)', () => {
  for (const fixture of FIXTURES) {
    it(`routing: ${fixture.name}`, () => {
      const result = resolvePayment(fixture.input);

      // Strategy name
      expect(result.strategy).toBe(fixture.expectedStrategy);

      // Per-leg tier
      expect(result.sendLeg.tier).toBe(fixture.expectedSendLegTier);
      expect(result.receiveLeg.tier).toBe(fixture.expectedReceiveLegTier);

      // isLocal
      expect(result.isLocal).toBe(fixture.expectedIsLocal);

      // Every leg has a source string (non-empty)
      expect(result.sendLeg.source).toBeTruthy();
      expect(result.receiveLeg.source).toBeTruthy();

      // allSkipped is an array (may be empty)
      expect(Array.isArray(result.allSkipped)).toBe(true);
    });
  }

  it('isLocal: same country + same currency → true', () => {
    expect(isLocal({
      originCountry: 'Ghana', destinationCountry: 'Ghana',
      sourceCurrency: 'GHS', destinationCurrency: 'GHS',
    })).toBe(true);
  });

  it('isLocal: different country → false', () => {
    expect(isLocal({
      originCountry: 'Ghana', destinationCountry: 'Nigeria',
      sourceCurrency: 'GHS', destinationCurrency: 'NGN',
    })).toBe(false);
  });

  it('isLocal: same country, different currency → false', () => {
    expect(isLocal({
      originCountry: 'Ghana', destinationCountry: 'Ghana',
      sourceCurrency: 'GHS', destinationCurrency: 'USD',
    })).toBe(false);
  });

  it('twinTokenCode: GHS → TWINGHS', () => {
    expect(twinTokenCode('GHS')).toBe('TWINGHS');
  });

  it('twinTokenCode: NGN → TWINNGN', () => {
    expect(twinTokenCode('NGN')).toBe('TWINNGN');
  });

  it('twinTokenCode: lower-case input → upper-case output', () => {
    expect(twinTokenCode('kes')).toBe('TWINKES');
  });
});
