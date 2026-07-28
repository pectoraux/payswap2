/**
 * GET /api/runtime/ledger — canonical economic ledger & solvency report.
 * (M-ECO-35.)
 *
 * Returns the complete regulator-ready export:
 *   - Balance Sheet (Assets = Liabilities + Equity)
 *   - Solvency Report (reserve/twin/stablecoin/escrow coverage)
 *   - Proof of Reserves
 *   - Proof of Twin Tokens (backing ratio)
 *   - Treasury Ledger
 *   - LP Capital Ledgers
 *   - Journal Entries (double-entry accounting)
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const format = url.searchParams.get('format');

    if (format === 'regulator') {
      return NextResponse.json({ ok: true, ...runtime.ledger.getRegulatorExport() });
    }
    if (format === 'solvency') {
      return NextResponse.json({ ok: true, ...runtime.ledger.getSolvencyReport() });
    }
    if (format === 'proof') {
      return NextResponse.json({
        ok: true,
        proofOfReserves: runtime.ledger.getProofOfReserves(),
        proofOfTwinTokens: runtime.ledger.getProofOfTwinTokens(),
      });
    }

    // Default: full balance sheet + solvency.
    return NextResponse.json({
      ok: true,
      balanceSheet: runtime.ledger.getBalanceSheet(),
      solvencyReport: runtime.ledger.getSolvencyReport(),
      treasuryLedger: runtime.ledger.getTreasuryLedger(),
      lpLedgers: runtime.ledger.getLPCapitalLedgers(),
      generatedAt: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
