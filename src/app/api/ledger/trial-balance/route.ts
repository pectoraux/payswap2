import { NextResponse } from 'next/server';
import { ledgerEngine, rebuildLedgerFromEvents } from '@/protocol/ledger';
import { eventEngine } from '@/kernel/event';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/ledger/trial-balance — full trial balance rebuilt from events */
export async function GET() {
  const rebuilt = rebuildLedgerFromEvents(eventEngine.read());
  const tb = rebuilt.getTrialBalance();
  const journal = rebuilt.getJournal();
  const legs = journal.reduce((s, j) => s + j.entries.length, 0);
  const activeAccounts = Object.keys(tb.accounts).filter((k) => tb.accounts[k].debit !== 0 || tb.accounts[k].credit !== 0);
  return NextResponse.json({
    trialBalance: { balanced: tb.balanced, totalDebits: tb.totalDebits, totalCredits: tb.totalCredits },
    journals: journal.length,
    legs,
    activeAccounts,
    accounts: tb.accounts,
    ts: Date.now(),
  });
}
