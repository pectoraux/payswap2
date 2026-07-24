import { NextResponse } from 'next/server';
import { rebuildLedgerFromEvents } from '@/protocol/ledger';
import { eventEngine } from '@/kernel/event';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/ledger/balance-sheet — current balance sheet (A = L + E) */
export async function GET() {
  const rebuilt = rebuildLedgerFromEvents(eventEngine.read());
  const bs = rebuilt.getBalanceSheet();
  return NextResponse.json({ ...bs, ts: Date.now() });
}
