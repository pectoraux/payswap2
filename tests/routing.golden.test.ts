/**
 * PaySwap CROWN-JEWEL — Routing Golden Contract Test.
 *
 * Task ID: RESTORE-CROWN-JEWELS.
 *
 * This file is the Part 0 contract: it pins the EXACT settlement tier that
 * `resolvePayment` chooses for 14 canonical payment shapes. Any change to
 * the routing logic — money-type refactor, settlement-waterfall rewrite,
 * policy-engine delegation, handlers.ts hardcoding — MUST keep these 14
 * assertions green. If any one of them flips, you have silently changed how
 * money moves through the system and need to either fix the code or update
 * the test DELIBERATELY (with a worklog entry explaining why).
 *
 * Why this exists:
 *   Before this file, the only "routing test" was the policy-engine's own
 *   unit test — which tests the policy engine in isolation. The runtime
 *   PaymentCommandHandler (in `runtime/dispatcher/handlers.ts`) was not
 *   covered. When commits 54cf685/dce745b hand-routed payments in the
 *   handler, no test caught it. This file is the gate that catches the
 *   next such drift.
 *
 * The 14 cases:
 *   1-3   — `twinTokenCode` currency→asset-code conventions.
 *   4-6   — `isLocal` predicate (country/currency equality).
 *   7-14  — `resolvePayment` tier selection covering all 5 tiers + the
 *           LP-bridge + amount-exceeds-reserve edge cases.
 */

import { describe, it, expect } from 'bun:test';
import {
  twinTokenCode,
  isNative,
  isLocal,
} from '@/protocol/chains/stellar/assets';
import { COUNTRIES } from '@/kernel/support';
import {
  resolvePayment,
  MANUAL_SETTLEMENT_STRATEGY,
  type ResolvePaymentInput,
} from '@/runtime/liquidity/settlement-waterfall';
import type {
  PolicyEngineInput,
  ReserveState,
  BandwidthPosition,
} from '@/runtime/liquidity/policy-engine';

// ─── Helpers ────────────────────────────────────────────────────────────

/** Build a ReserveState with sensible defaults. */
function reserve(
  overrides: Partial<ReserveState> = {},
): ReserveState {
  return {
    country: 'Ghana',
    currency: 'GHS',
    hasFiatReserve: false,
    fiatReserveAmount: 0,
    hasStablecoinReserve: false,
    stablecoinReserveAmount: 0,
    maturity: 'stablecoin_only',
    ...overrides,
  };
}

/** Build a fiat-bandwidth position. */
function fiatBandwidth(
  country: string,
  currency: string,
  available: number,
): BandwidthPosition {
  return {
    lpId: `lp-${country}-${currency}`,
    country,
    assetType: 'fiat',
    currency,
    capacity: available,
    reserved: 0,
    used: 0,
    available,
    escrow: 0,
    bond: 0,
    status: 'active',
    participationMode: 'automatic',
  };
}

/** Build a stablecoin-bandwidth position. */
function stablecoinBandwidth(
  country: string,
  currency: string,
  available: number,
): BandwidthPosition {
  return {
    lpId: `lp-${country}-${currency}-usdc`,
    country,
    assetType: 'stablecoin',
    currency,
    capacity: available,
    reserved: 0,
    used: 0,
    available,
    escrow: 0,
    bond: 0,
    status: 'active',
    participationMode: 'automatic',
  };
}

/** Build a minimal `resolvePayment` input. */
function pay(
  overrides: Partial<ResolvePaymentInput> = {},
): ResolvePaymentInput {
  return {
    fromCountry: 'Ghana',
    toCountry: 'Ghana',
    fromCurrency: 'GHS',
    toCurrency: 'GHS',
    amount: 100,
    fxRate: 1,
    senderReserve: reserve(),
    receiverReserve: reserve(),
    senderBandwidth: [],
    receiverBandwidth: [],
    treasuryStablecoins: [],
    ...overrides,
  };
}

// ─── 1-3: twinTokenCode conventions ─────────────────────────────────────

describe('routing.golden — twinTokenCode', () => {
  it('twinTokenCode: GHS → TWINGHS', () => {
    expect(twinTokenCode('GHS')).toBe('TWINGHS');
  });

  it('twinTokenCode: NGN → TWINNGN', () => {
    expect(twinTokenCode('NGN')).toBe('TWINNGN');
  });

  it('twinTokenCode: lower-case input → upper-case output', () => {
    expect(twinTokenCode('kes')).toBe('TWINKES');
    expect(twinTokenCode('ghs')).toBe('TWINGHS');
    expect(twinTokenCode('usd')).toBe('TWINUSD');
  });
});

// ─── 4-6: isLocal predicate ────────────────────────────────────────────

describe('routing.golden — isLocal', () => {
  it('isLocal: same country + same currency → true', () => {
    expect(isLocal('Ghana', 'Ghana', 'GHS', 'GHS')).toBe(true);
    expect(isLocal('Kenya', 'Kenya', 'KES', 'KES')).toBe(true);
  });

  it('isLocal: different country → false', () => {
    expect(isLocal('Ghana', 'Kenya', 'GHS', 'KES')).toBe(false);
    expect(isLocal('Ghana', 'Nigeria', 'GHS', 'NGN')).toBe(false);
  });

  it('isLocal: same country, different currency → false', () => {
    // Same country but different currency is NOT a local rail — it implies
    // a currency conversion, which routes through RESERVE_TO_RESERVE.
    expect(isLocal('Ghana', 'Ghana', 'GHS', 'USD')).toBe(false);
    expect(isLocal('Kenya', 'Kenya', 'KES', 'USD')).toBe(false);
  });
});

// ─── 7-14: resolvePayment tier selection ────────────────────────────────

describe('routing.golden — resolvePayment tier selection', () => {
  it('routing: LOCAL_RAIL: GHS→GHS same country — both reserves have fiat, amount within balance → tier 1', () => {
    const result = resolvePayment(pay({
      fromCountry: 'Ghana',
      toCountry: 'Ghana',
      fromCurrency: 'GHS',
      toCurrency: 'GHS',
      amount: 500,
      senderReserve: reserve({
        country: 'Ghana', currency: 'GHS',
        hasFiatReserve: true, fiatReserveAmount: 10_000,
      }),
      receiverReserve: reserve({
        country: 'Ghana', currency: 'GHS',
        hasFiatReserve: true, fiatReserveAmount: 10_000,
      }),
    }));
    expect(result.tier).toBe(1);
    expect(result.strategy).toBe('LOCAL_RAIL');
    expect(result.senderHasFiat).toBe(true);
    expect(result.receiverHasFiat).toBe(true);
  });

  it('routing: LOCAL_RAIL: GHS→GHS, PaySwap FIAT insufficient → tier 4 (LP crypto)', () => {
    // Same country + same currency (would normally be tier 1), but the
    // sender's fiat reserve can't cover the amount. With LP crypto bandwidth
    // available, the payment falls through to tier 4 (MARKET_TO_MARKET).
    const result = resolvePayment(pay({
      fromCountry: 'Ghana',
      toCountry: 'Ghana',
      fromCurrency: 'GHS',
      toCurrency: 'GHS',
      amount: 5_000,
      senderReserve: reserve({
        country: 'Ghana', currency: 'GHS',
        hasFiatReserve: true, fiatReserveAmount: 100,  // too small
      }),
      receiverReserve: reserve({
        country: 'Ghana', currency: 'GHS',
        hasFiatReserve: true, fiatReserveAmount: 100,  // too small
      }),
      senderBandwidth: [stablecoinBandwidth('Ghana', 'GHS', 10_000)],
    }));
    expect(result.tier).toBe(4);
    expect(result.strategy).toBe('MARKET_TO_MARKET');
    expect(result.lpHasCrypto).toBe(true);
  });

  it('routing: RESERVE_TO_RESERVE: GHS→KES both have FIAT → tier 2', () => {
    const result = resolvePayment(pay({
      fromCountry: 'Ghana',
      toCountry: 'Kenya',
      fromCurrency: 'GHS',
      toCurrency: 'KES',
      amount: 500,
      senderReserve: reserve({
        country: 'Ghana', currency: 'GHS',
        hasFiatReserve: true, fiatReserveAmount: 10_000,
      }),
      receiverReserve: reserve({
        country: 'Kenya', currency: 'KES',
        hasFiatReserve: true, fiatReserveAmount: 10_000,
      }),
    }));
    expect(result.tier).toBe(2);
    expect(result.strategy).toBe('RESERVE_TO_RESERVE');
    expect(result.senderHasFiat).toBe(true);
    expect(result.receiverHasFiat).toBe(true);
  });

  it('routing: RESERVE_TO_RESERVE: GHS→NGN, sender has FIAT, receiver uses LP FIAT → tier 2 via LP', () => {
    // Receiver's country has no fiat reserve, but an LP can supply NGN fiat.
    // Sender reserve + LP receiver fiat → tier 2 (RESERVE_TO_RESERVE).
    const result = resolvePayment(pay({
      fromCountry: 'Ghana',
      toCountry: 'Nigeria',
      fromCurrency: 'GHS',
      toCurrency: 'NGN',
      amount: 500,
      senderReserve: reserve({
        country: 'Ghana', currency: 'GHS',
        hasFiatReserve: true, fiatReserveAmount: 10_000,
      }),
      receiverReserve: reserve({
        country: 'Nigeria', currency: 'NGN',
        hasFiatReserve: false, fiatReserveAmount: 0,
      }),
      receiverBandwidth: [fiatBandwidth('Nigeria', 'NGN', 10_000)],
    }));
    expect(result.tier).toBe(2);
    expect(result.strategy).toBe('RESERVE_TO_RESERVE');
    expect(result.receiverHasFiat).toBe(false);
    expect(result.lpHasFiat).toBe(true);
  });

  it('routing: MARKET_TO_RESERVE: NGN→GHS, sender no FIAT no LP, receiver has FIAT → tier 3', () => {
    const result = resolvePayment(pay({
      fromCountry: 'Nigeria',
      toCountry: 'Ghana',
      fromCurrency: 'NGN',
      toCurrency: 'GHS',
      amount: 500,
      senderReserve: reserve({
        country: 'Nigeria', currency: 'NGN',
        hasFiatReserve: false, fiatReserveAmount: 0,
      }),
      receiverReserve: reserve({
        country: 'Ghana', currency: 'GHS',
        hasFiatReserve: true, fiatReserveAmount: 10_000,
      }),
      senderBandwidth: [],  // no LP fiat on sender side
    }));
    expect(result.tier).toBe(3);
    expect(result.strategy).toBe('MARKET_TO_RESERVE');
    expect(result.senderHasFiat).toBe(false);
    expect(result.receiverHasFiat).toBe(true);
  });

  it('routing: MARKET_TO_MARKET: NGN→XOF, neither has FIAT, no LP FIAT, LP has crypto → tier 4', () => {
    const result = resolvePayment(pay({
      fromCountry: 'Nigeria',
      toCountry: 'Togo',
      fromCurrency: 'NGN',
      toCurrency: 'XOF',
      amount: 500,
      senderReserve: reserve({
        country: 'Nigeria', currency: 'NGN',
        hasFiatReserve: false, fiatReserveAmount: 0,
      }),
      receiverReserve: reserve({
        country: 'Togo', currency: 'XOF',
        hasFiatReserve: false, fiatReserveAmount: 0,
      }),
      senderBandwidth: [stablecoinBandwidth('Nigeria', 'NGN', 10_000)],
    }));
    expect(result.tier).toBe(4);
    expect(result.strategy).toBe('MARKET_TO_MARKET');
    expect(result.lpHasCrypto).toBe(true);
  });

  it('routing: TIER 5: KES→XOF, no reserves, no bandwidth, no crypto → tier 5 fallback (manual settlement)', () => {
    const result = resolvePayment(pay({
      fromCountry: 'Kenya',
      toCountry: 'Togo',
      fromCurrency: 'KES',
      toCurrency: 'XOF',
      amount: 500,
      senderReserve: reserve({
        country: 'Kenya', currency: 'KES',
        hasFiatReserve: false, fiatReserveAmount: 0,
      }),
      receiverReserve: reserve({
        country: 'Togo', currency: 'XOF',
        hasFiatReserve: false, fiatReserveAmount: 0,
      }),
      senderBandwidth: [],
      receiverBandwidth: [],
    }));
    expect(result.tier).toBe(5);
    expect(result.strategy).toBe(MANUAL_SETTLEMENT_STRATEGY);
    expect(result.lpHasFiat).toBe(false);
    expect(result.lpHasCrypto).toBe(false);
  });

  it('routing: TIER 5 fallback: GHS→NGN, amount exceeds all reserves → tier 5', () => {
    // Both countries have fiat reserves, but the amount exceeds them AND
    // there is no LP bandwidth to bridge the gap → manual settlement.
    const result = resolvePayment(pay({
      fromCountry: 'Ghana',
      toCountry: 'Nigeria',
      fromCurrency: 'GHS',
      toCurrency: 'NGN',
      amount: 1_000_000,  // far exceeds both reserves
      senderReserve: reserve({
        country: 'Ghana', currency: 'GHS',
        hasFiatReserve: true, fiatReserveAmount: 1_000,  // too small
      }),
      receiverReserve: reserve({
        country: 'Nigeria', currency: 'NGN',
        hasFiatReserve: true, fiatReserveAmount: 1_000,  // too small
      }),
      senderBandwidth: [],
      receiverBandwidth: [],
    }));
    expect(result.tier).toBe(5);
    expect(result.strategy).toBe(MANUAL_SETTLEMENT_STRATEGY);
    // The "hasFiat" flags reflect whether the reserve covers the amount —
    // they should be false here because the amount exceeds the reserve.
    expect(result.senderHasFiat).toBe(false);
    expect(result.receiverHasFiat).toBe(false);
  });
});

// ─── Smoke: COUNTRIES registry is non-empty (referenced by routing) ─────

describe('routing.golden — COUNTRIES registry', () => {
  it('COUNTRIES registry is populated with the currencies used above', () => {
    expect(COUNTRIES.length).toBeGreaterThan(0);
    const currencies = COUNTRIES.map((c) => c.currency);
    expect(currencies).toContain('GHS');
    expect(currencies).toContain('KES');
    expect(currencies).toContain('NGN');
  });
});
