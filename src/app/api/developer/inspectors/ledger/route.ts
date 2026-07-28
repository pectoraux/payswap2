/**
 * GET /api/developer/inspectors/ledger
 *
 * Reads from payswapRuntime.ledger (the Economic Ledger Engine) + payswapRuntime.treasury
 * (the Treasury Kernel).
 *
 * Returns:
 *   - balanceSheet: network balance sheet (assets = liabilities + equity)
 *   - solvency: solvency report (reserve coverage, twin coverage, ratio)
 *   - proofOfReserves: per-currency reserve breakdown
 *   - proofOfTwinTokens: twin token backing proof
 *   - journalEntries: double-entry journal entries
 *   - accounts: treasury accounts (from the treasury projection)
 *   - lpLedgers: per-LP capital ledgers
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { runtime as payswapRuntime } from '@/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AccountView {
  id: string;
  kind: string;
  ownerId: string;
  currency: string;
  availableBalance: number;
  reservedBalance: number;
  totalBalance: number;
  reference: string | null;
  isActive: boolean;
  createdAt: string;
  lastUpdated: string;
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    const ledger = payswapRuntime.ledger;
    const balanceSheet = ledger.getBalanceSheet();
    const solvency = ledger.getSolvencyReport();
    const proofOfReserves = ledger.getProofOfReserves();
    const proofOfTwinTokens = ledger.getProofOfTwinTokens();
    const journalEntries = ledger.getJournalEntries();
    const lpLedgers = ledger.getLPCapitalLedgers();
    const treasuryLedger = ledger.getTreasuryLedger();

    // Treasury accounts (from the projection).
    const accounts = await payswapRuntime.treasury.list({ take: 10_000 });
    const accountViews: AccountView[] = accounts.map((a) => ({
      id: a.id,
      kind: a.kind,
      ownerId: a.ownerId,
      currency: a.currency,
      availableBalance: a.availableBalance,
      reservedBalance: a.reservedBalance,
      totalBalance: a.totalBalance,
      reference: a.reference,
      isActive: a.isActive,
      createdAt: a.createdAt.toISOString(),
      lastUpdated: a.lastUpdated.toISOString(),
    }));

    // Currency list for filter.
    const currencies = Array.from(new Set(accountViews.map((a) => a.currency))).sort();

    return NextResponse.json({
      ok: true,
      balanceSheet: {
        assets: balanceSheet.assets,
        liabilities: balanceSheet.liabilities,
        equity: balanceSheet.equity,
        isBalanced: balanceSheet.isBalanced,
        imbalance: balanceSheet.imbalance,
        generatedAt: balanceSheet.generatedAt,
      },
      solvency: {
        reserveCoverage: solvency.reserveCoverage,
        twinCoverage: solvency.twinCoverage,
        stablecoinCoverage: solvency.stablecoinCoverage,
        escrowCoverage: solvency.escrowCoverage,
        settlementExposure: solvency.settlementExposure,
        lpExposure: solvency.lpExposure,
        countryExposure: solvency.countryExposure,
        networkSolvent: solvency.networkSolvent,
        solvencyRatio: solvency.solvencyRatio,
      },
      proofOfReserves: {
        fiatReserves: proofOfReserves.fiatReserves,
        stablecoinReserves: proofOfReserves.stablecoinReserves,
        totalFiat: proofOfReserves.totalFiat,
        totalStablecoins: proofOfReserves.totalStablecoins,
        totalReserves: proofOfReserves.totalReserves,
      },
      proofOfTwinTokens: {
        twinTokenSupply: proofOfTwinTokens.twinTokenSupply,
        totalSupply: proofOfTwinTokens.totalSupply,
        backedByFiat: proofOfTwinTokens.backedByFiat,
        backedByStablecoins: proofOfTwinTokens.backedByStablecoins,
        totalBacking: proofOfTwinTokens.totalBacking,
        backingRatio: proofOfTwinTokens.backingRatio,
        isFullyBacked: proofOfTwinTokens.isFullyBacked,
      },
      journalEntries: journalEntries.map((j) => ({
        entryId: j.entryId,
        eventId: j.eventId,
        timestamp: j.timestamp,
        description: j.description,
        debits: j.debits,
        credits: j.credits,
        isBalanced: j.isBalanced,
      })),
      lpLedgers: lpLedgers.map((l) => ({
        lpId: l.lpId,
        capitalDeposited: l.capitalDeposited,
        bandwidth: l.bandwidth,
        escrow: l.escrow,
        feesEarned: l.feesEarned,
        slashed: l.slashed,
        currentExposure: l.currentExposure,
        netPosition: l.netPosition,
      })),
      treasuryLedger: {
        totalAssets: treasuryLedger.totalAssets,
        fiatReserves: treasuryLedger.fiatReserves,
        stablecoinReserves: treasuryLedger.stablecoinReserves,
        escrow: treasuryLedger.escrow,
        customerFunds: treasuryLedger.customerFunds,
        lpFunds: treasuryLedger.lpFunds,
        lockedFunds: treasuryLedger.lockedFunds,
        freeFunds: treasuryLedger.freeFunds,
        yieldingFunds: treasuryLedger.yieldingFunds,
        netProfit: treasuryLedger.netProfit,
      },
      accounts: accountViews,
      currencies,
      stats: {
        totalAccounts: accountViews.length,
        totalAssets: balanceSheet.assets.totalAssets,
        totalLiabilities: balanceSheet.liabilities.totalLiabilities,
        totalEquity: balanceSheet.equity.totalEquity,
        isBalanced: balanceSheet.isBalanced,
        imbalance: balanceSheet.imbalance,
        networkSolvent: solvency.networkSolvent,
        solvencyRatio: solvency.solvencyRatio,
      },
    });
  } catch (err) {
    console.error('[api/developer/inspectors/ledger] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
