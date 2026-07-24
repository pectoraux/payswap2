import { NextResponse } from 'next/server';
import { transactionEngine } from '@/protocol/payments/transaction-engine';
import { settlementEscrow } from '@/protocol/settlement/escrow';
import { collateralVault } from '@/protocol/settlement/collateral-vault';
import { settlementCapacityVault } from '@/protocol/settlement/capacity-vault';
import { lpLifecycle } from '@/protocol/lp-lifecycle-manager';
import { merchantRegistry } from '@/protocol/merchant-registry';
import { disputeEngine } from '@/protocol/settlement/dispute-engine';
import { treasury } from '@/protocol/treasury';
import { governanceEngine } from '@/protocol/governance/engine';
import { connectorRegistry } from '@/protocol/connectors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/protocol/health — production protocol health metrics */
export async function GET() {
  const payments = transactionEngine.listPayments();
  const settled = payments.filter((p) => p.state === 'settled');
  const failed = payments.filter((p) => p.state === 'failed');
  const active = payments.filter((p) => p.state !== 'settled' && p.state !== 'failed');
  const avgSettlementMs = settled.length > 0
    ? settled.reduce((s, p) => s + (Date.now() - p.createdAt), 0) / settled.length
    : 0;

  const lps = lpLifecycle.all();
  const activeLps = lps.filter((lp) => lp.state === 'active');
  const totalExposure = activeLps.reduce((s, lp) => s + lp.currentExposure, 0);
  const totalAuthorized = activeLps.reduce((s, lp) => s + lp.authorizedExposure, 0);

  const merchants = merchantRegistry.all();
  const disputes = disputeEngine.all();
  const activeDisputes = disputes.filter((d) => d.state !== 'resolved');

  const escrowEntries = settlementEscrow.all();
  const frozenEscrow = escrowEntries.filter((e) => e.state === 'frozen');

  const collateralEntries = collateralVault.all();
  const totalCollateral = collateralEntries.reduce((s, c) => s + c.remainingAmount, 0);

  const capacityStakes = settlementCapacityVault.activeStakes();
  const totalCapacity = capacityStakes.reduce((s, st) => s + st.amount, 0);

  const treasuryPositions = treasury.allPositions();
  const governanceProposals = governanceEngine.all();

  return NextResponse.json({
    timestamp: Date.now(),
    settlement: {
      totalPayments: payments.length,
      settled: settled.length,
      failed: failed.length,
      active: active.length,
      settlementRate: payments.length > 0 ? settled.length / payments.length : 0,
      avgSettlementMs: Math.round(avgSettlementMs),
      frozenEscrowCount: frozenEscrow.length,
      frozenEscrowValue: frozenEscrow.reduce((s, e) => s + e.amount, 0),
    },
    liquidity: {
      totalLPs: lps.length,
      activeLPs: activeLps.length,
      totalCapacity,
      totalExposure,
      totalAuthorized,
      utilization: totalAuthorized > 0 ? totalExposure / totalAuthorized : 0,
      totalCollateral,
    },
    merchants: {
      total: merchants.length,
      byTier: {
        premium: merchants.filter((m) => m.tier === 'premium').length,
        trusted: merchants.filter((m) => m.tier === 'trusted').length,
        verified: merchants.filter((m) => m.tier === 'verified').length,
        unverified: merchants.filter((m) => m.tier === 'unverified').length,
      },
    },
    disputes: {
      total: disputes.length,
      active: activeDisputes.length,
      resolved: disputes.filter((d) => d.state === 'resolved').length,
      byOutcome: {
        lp_wins: disputes.filter((d) => d.outcome === 'lp_wins').length,
        merchant_wins: disputes.filter((d) => d.outcome === 'merchant_wins').length,
        collateral_slash: disputes.filter((d) => d.outcome === 'collateral_slash').length,
      },
    },
    treasury: {
      positions: treasuryPositions.map((p) => ({
        currency: p.currency,
        stablecoin: p.stablecoinBalance,
        emergency: p.emergencyBalance,
        fiat: p.fiatBalance,
        total: p.totalReserves,
      })),
      pendingRecommendations: treasury.pendingRecommendations().length,
    },
    governance: {
      totalProposals: governanceProposals.length,
      active: governanceEngine.active().length,
      parameters: governanceEngine.allParameters(),
    },
    connectors: {
      registered: connectorRegistry.all().length,
      types: connectorRegistry.all().map((c) => c['config'].type),
    },
  });
}
