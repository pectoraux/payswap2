import { NextResponse } from 'next/server';
import { rebuildLedgerFromEvents, reconcileTwinTokenBacking, reconcileTreasury, dailyReconciliation } from '@/protocol/ledger';
import { eventEngine } from '@/kernel/event';
import { twinTokenEngine } from '@/protocol/twin-token/engine';
import { payoutService } from '@/protocol/payouts/payout-service';
import { merchantPlatform } from '@/protocol/merchant/platform';
import { settlementEscrow } from '@/protocol/settlement/escrow';
import { collateralVault } from '@/protocol/settlement/collateral-vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/ledger/reconciliation — full daily reconciliation report (rebuilt from events) */
export async function GET() {
  const rebuilt = rebuildLedgerFromEvents(eventEngine.read());
  const report = dailyReconciliation({
    asOfTs: Date.now(),
    ledger: rebuilt,
    twinTokenEngine,
    escrowModule: settlementEscrow as any,
    collateralVault: collateralVault as any,
    payoutService: payoutService as any,
    merchantPlatform: merchantPlatform as any,
  });
  const twinTokenBacking = reconcileTwinTokenBacking(rebuilt, twinTokenEngine);
  const treasury = reconcileTreasury(rebuilt);
  const tb = rebuilt.getTrialBalance();

  // Shape the response to match what the Infra tab expects
  return NextResponse.json({
    report: {
      passed: (report as any)?.passed ?? false,
      escrow: { passed: (report as any)?.escrow?.reconciled ?? true, metrics: { frozenCount: (report as any)?.escrow?.count ?? 0 } },
      payouts: { passed: (report as any)?.payouts?.reconciled ?? true, metrics: { completedCount: payoutService.list().filter((p: any) => p.state === 'completed').length } },
      twinTokenBacking: { passed: (twinTokenBacking as any)?.reconciled ?? false, discrepancies: (twinTokenBacking as any)?.assets?.filter((a: any) => !a.reconciled).map((a: any) => a.code) ?? [] },
    },
    twinTokenBacking: {
      passed: (twinTokenBacking as any)?.reconciled ?? false,
      discrepancies: (twinTokenBacking as any)?.assets?.filter((a: any) => !a.reconciled).map((a: any) => ({ code: a.code, discrepancy: a.discrepancy })) ?? [],
    },
    treasury: {
      passed: (treasury as any)?.reconciled ?? false,
      metrics: { balanced: (treasury as any)?.reconciled ? 1 : 0 },
    },
    trialBalance: { balanced: tb.balanced, totalDebits: tb.totalDebits, totalCredits: tb.totalCredits },
    ts: Date.now(),
  });
}
