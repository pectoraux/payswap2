import { NextResponse } from 'next/server';
import { rebuildLedgerFromEvents, dailyReconciliation } from '@/protocol/ledger';
import { eventEngine } from '@/kernel/event';
import { twinTokenEngine } from '@/protocol/twin-token/engine';
import { payoutService } from '@/protocol/payouts/payout-service';
import { merchantPlatform } from '@/protocol/merchant/platform';
import { settlementEscrow as escrowEngine } from '@/protocol/settlement/escrow';
import { collateralVault } from '@/protocol/settlement/collateral-vault';
import { lpLifecycle } from '@/protocol/lp-lifecycle-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/ledger/reconciliation — full daily reconciliation report */
export async function GET() {
  const rebuilt = rebuildLedgerFromEvents(eventEngine.read());
  const report = dailyReconciliation({
    asOfTs: Date.now(),
    ledger: rebuilt,
    twinTokenEngine,
    escrowModule: escrowEngine,
    collateralVault,
    payoutService,
    merchantPlatform,
    lpLifecycle,
  });
  return NextResponse.json(report);
}
