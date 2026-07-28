/**
 * GET /api/developer/inspectors/treasury-lp
 *
 * Reads from:
 *   - payswapRuntime.treasury (treasury accounts)
 *   - payswapRuntime.twinTokens (twin token positions)
 *   - payswapRuntime.lpRuntime (LP profiles + offers)
 *   - payswapRuntime.bandwidth (LP bandwidth positions)
 *   - payswapRuntime.ledger (balance sheet + solvency)
 *
 * Returns two payloads: treasury state and LP state. The UI renders them
 * in two tabs.
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { runtime as payswapRuntime } from '@/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReserveView {
  accountId: string;
  country: string;
  currency: string;
  fiatAmount: number;
  stablecoinAmount: number;
  total: number;
  reference: string | null;
  isActive: boolean;
}

interface TwinTokenView {
  accountId: string;
  tokenType: string;
  currency: string;
  balance: number;
  backedAmount: number;
  lastUpdated: number;
}

interface LPView {
  lpId: string;
  name: string;
  isActive: boolean;
  supportedCorridors: Array<{ from: string; to: string; capacity: number; spreadBps: number; latencyMs: number }>;
  totalCapacity: number;
  reserveRequirement: number;
  confidence: number;
  riskScore: number;
  registeredAt: number;
  lastUpdated: number;
  // Joined from bandwidth + treasury.
  bandwidthPositions: Array<{
    country: string;
    assetType: string;
    capacity: number;
    reserved: number;
    used: number;
    available: number;
    escrow: number;
    bond: number;
    status: string;
  }>;
  treasuryAccounts: Array<{
    id: string;
    currency: string;
    availableBalance: number;
    reservedBalance: number;
  }>;
  tier: string;
}

interface LPOfferView {
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

function tierForLP(lp: { confidence: number; riskScore: number; totalCapacity: number }): string {
  const score = lp.confidence * 0.4 + (1 - lp.riskScore) * 0.3 + Math.min(1, lp.totalCapacity / 100_000) * 0.3;
  if (score >= 0.8) return 'Platinum';
  if (score >= 0.65) return 'Gold';
  if (score >= 0.5) return 'Silver';
  return 'Bronze';
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    // === Treasury ===
    const accounts = await payswapRuntime.treasury.list({ take: 10_000 });
    const reserveAccounts = accounts.filter((a) => a.kind === 'reserve');

    // Group reserves by country (reference) + currency.
    const reserveMap = new Map<string, ReserveView>();
    for (const a of reserveAccounts) {
      const country = a.reference ?? a.ownerId;
      const key = `${country}:${a.currency}`;
      const existing = reserveMap.get(key);
      if (existing) {
        // Heuristic: if the reference contains "stablecoin" treat as stablecoin amount.
        if ((a.reference ?? '').includes('stablecoin')) {
          existing.stablecoinAmount += a.availableBalance;
        } else {
          existing.fiatAmount += a.availableBalance;
        }
        existing.total += a.availableBalance;
      } else {
        const isStablecoin = (a.reference ?? '').includes('stablecoin');
        reserveMap.set(key, {
          accountId: a.id,
          country,
          currency: a.currency,
          fiatAmount: isStablecoin ? 0 : a.availableBalance,
          stablecoinAmount: isStablecoin ? a.availableBalance : 0,
          total: a.availableBalance,
          reference: a.reference,
          isActive: a.isActive,
        });
      }
    }
    const reserves = Array.from(reserveMap.values()).sort((a, b) => b.total - a.total);

    // Twin token positions.
    const twinPositions = payswapRuntime.twinTokens.list();
    const twinViews: TwinTokenView[] = twinPositions.map((t) => ({
      accountId: t.accountId,
      tokenType: t.tokenType,
      currency: t.currency,
      balance: t.balance,
      backedAmount: t.backedAmount,
      lastUpdated: t.lastUpdated,
    }));

    // Balance sheet + solvency.
    const balanceSheet = payswapRuntime.ledger.getBalanceSheet();
    const solvency = payswapRuntime.ledger.getSolvencyReport();
    const proofTwin = payswapRuntime.ledger.getProofOfTwinTokens();

    // === LP ===
    const lps = payswapRuntime.lpRuntime.listLPs();
    const offers = payswapRuntime.lpRuntime.listOffers();
    const bandwidth = payswapRuntime.bandwidth.listAll();

    const lpViews: LPView[] = lps.map((lp) => {
      const lpBandwidth = bandwidth.filter((b) => b.lpId === lp.lpId);
      const lpAccounts = accounts.filter((a) => a.ownerId === lp.lpId || a.reference === lp.lpId);
      return {
        lpId: lp.lpId,
        name: lp.name,
        isActive: lp.isActive,
        supportedCorridors: lp.supportedCorridors.map((c) => ({
          from: c.from,
          to: c.to,
          capacity: c.capacity,
          spreadBps: c.spreadBps,
          latencyMs: c.latencyMs,
        })),
        totalCapacity: lp.totalCapacity,
        reserveRequirement: lp.reserveRequirement,
        confidence: lp.confidence,
        riskScore: lp.riskScore,
        registeredAt: lp.registeredAt,
        lastUpdated: lp.lastUpdated,
        bandwidthPositions: lpBandwidth.map((b) => ({
          country: b.country,
          assetType: b.assetType,
          capacity: b.capacity,
          reserved: b.reserved,
          used: b.used,
          available: b.available,
          escrow: b.escrow,
          bond: b.bond,
          status: b.status,
        })),
        treasuryAccounts: lpAccounts.map((a) => ({
          id: a.id,
          currency: a.currency,
          availableBalance: a.availableBalance,
          reservedBalance: a.reservedBalance,
        })),
        tier: tierForLP(lp),
      };
    });

    const offerViews: LPOfferView[] = offers.map((o) => ({
      offerId: o.offerId,
      lpId: o.lpId,
      from: o.from,
      to: o.to,
      capacity: o.capacity,
      spreadBps: o.spreadBps,
      latencyMs: o.latencyMs,
      confidence: o.confidence,
      riskScore: o.riskScore,
      expiresAt: o.expiresAt,
      publishedAt: o.publishedAt,
    }));

    // Stats.
    const totalReserves = balanceSheet.assets.fiatReserves + balanceSheet.assets.stablecoinReserves;
    const twinTokenSupply = twinPositions
      .filter((t) => t.tokenType === 'claim')
      .reduce((s, t) => s + t.balance, 0);

    return NextResponse.json({
      ok: true,
      treasury: {
        reserves,
        twinTokens: twinViews,
        balanceSheet: {
          fiatReserves: balanceSheet.assets.fiatReserves,
          stablecoinReserves: balanceSheet.assets.stablecoinReserves,
          totalReserves,
          escrow: balanceSheet.assets.escrow,
          treasuryInventory: balanceSheet.assets.treasuryInventory,
          totalAssets: balanceSheet.assets.totalAssets,
          twinTokensOutstanding: balanceSheet.liabilities.twinTokensOutstanding,
          totalLiabilities: balanceSheet.liabilities.totalLiabilities,
          isBalanced: balanceSheet.isBalanced,
        },
        solvency: {
          reserveCoverage: solvency.reserveCoverage,
          twinCoverage: solvency.twinCoverage,
          solvencyRatio: solvency.solvencyRatio,
          networkSolvent: solvency.networkSolvent,
          countryExposure: solvency.countryExposure,
        },
        twinTokenProof: {
          totalSupply: proofTwin.totalSupply,
          totalBacking: proofTwin.totalBacking,
          backingRatio: proofTwin.backingRatio,
          isFullyBacked: proofTwin.isFullyBacked,
        },
      },
      lp: {
        lps: lpViews,
        offers: offerViews,
        totalLPs: lps.length,
        activeLPs: lps.filter((l) => l.isActive).length,
        totalOffers: offers.length,
        totalCapacity: lps.reduce((s, l) => s + l.totalCapacity, 0),
        totalBandwidth: bandwidth.reduce((s, b) => s + b.available, 0),
      },
      stats: {
        totalReserves,
        twinTokenSupply,
        solvencyRatio: solvency.solvencyRatio,
        networkSolvent: solvency.networkSolvent,
        totalLPs: lps.length,
        totalLPCapacity: lps.reduce((s, l) => s + l.totalCapacity, 0),
      },
    });
  } catch (err) {
    console.error('[api/developer/inspectors/treasury-lp] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
