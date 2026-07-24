import { NextResponse } from 'next/server';
import { ledgerEngine, rebuildLedgerFromEvents } from '@/protocol/ledger';
import { eventEngine } from '@/kernel/event';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/ledger/trial-balance — current trial balance (rebuilt from events) */
export async function GET() {
  // Rebuild from the live event stream for a fresh, consistent view
  const rebuilt = rebuildLedgerFromEvents(eventEngine.read());
  const tb = rebuilt.getTrialBalance();
  return NextResponse.json({
    totalDebits: tb.totalDebits,
    totalCredits: tb.totalCredits,
    balanced: tb.balanced,
    accounts: tb.accounts,
    entryCount: rebuilt.getJournal().length,
    ts: Date.now(),
  });
}
