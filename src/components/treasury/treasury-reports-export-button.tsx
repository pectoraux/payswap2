'use client';

import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export interface TreasuryReportRow {
  date: string;
  reserves: number;
  volume: number;
  fees: number;
  net: number;
}

export interface TreasuryReportsExportButtonProps {
  rows: TreasuryReportRow[];
  summary: {
    totalPayments: number;
    completedPayments: number;
    failedPayments: number;
    successRate: number;
    avgSettleMs: number | null;
    lpRevenue: number;
    openAlerts: number;
    failedPayouts: number;
    openDisputes: number;
    totalReserves: number;
    totalVolume: number;
    totalFees: number;
  };
  topLps: Array<{ lpId: string; volume: number; revenue: number }>;
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(
  rows: TreasuryReportRow[],
  summary: TreasuryReportsExportButtonProps['summary'],
  topLps: TreasuryReportsExportButtonProps['topLps'],
): string {
  const lines: string[] = [];

  // --- Daily treasury report ---
  lines.push('# PaySwap Treasury Report');
  lines.push(`# Generated,${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(
    ['metric', 'value']
      .map(csvCell)
      .join(','),
  );
  lines.push(['Total reserves (USD)', summary.totalReserves.toFixed(2)].map(csvCell).join(','));
  lines.push(['Total volume (USD)', summary.totalVolume.toFixed(2)].map(csvCell).join(','));
  lines.push(['Total fees (USD)', summary.totalFees.toFixed(2)].map(csvCell).join(','));
  lines.push(['Total payments', summary.totalPayments].map(csvCell).join(','));
  lines.push(['Completed payments', summary.completedPayments].map(csvCell).join(','));
  lines.push(['Failed payments', summary.failedPayments].map(csvCell).join(','));
  lines.push(['Success rate (%)', summary.successRate.toFixed(2)].map(csvCell).join(','));
  lines.push(['Avg settlement (ms)', summary.avgSettleMs ?? ''].map(csvCell).join(','));
  lines.push(['LP revenue (USD)', summary.lpRevenue.toFixed(2)].map(csvCell).join(','));
  lines.push(['Open AML alerts', summary.openAlerts].map(csvCell).join(','));
  lines.push(['Failed payouts', summary.failedPayouts].map(csvCell).join(','));
  lines.push(['Open disputes', summary.openDisputes].map(csvCell).join(','));
  lines.push('');

  lines.push('## Daily treasury report');
  lines.push(
    ['date', 'reserves_usd', 'volume_usd', 'fees_usd', 'net_position_usd']
      .map(csvCell)
      .join(','),
  );
  for (const r of rows) {
    lines.push(
      [r.date, r.reserves.toFixed(2), r.volume.toFixed(2), r.fees.toFixed(2), r.net.toFixed(2)]
        .map(csvCell)
        .join(','),
    );
  }
  lines.push('');

  lines.push('## Top LPs by volume');
  lines.push(['lp_id', 'volume_usd', 'revenue_usd'].map(csvCell).join(','));
  for (const lp of topLps) {
    lines.push(
      [lp.lpId, lp.volume.toFixed(2), lp.revenue.toFixed(2)].map(csvCell).join(','),
    );
  }

  return lines.join('\n');
}

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TreasuryReportsExportButton({
  rows,
  summary,
  topLps,
}: TreasuryReportsExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  function handleExport() {
    if (rows.length === 0 && summary.totalPayments === 0) {
      toast.error('Nothing to export — no reporting data yet');
      return;
    }
    setExporting(true);
    try {
      const csv = buildCsv(rows, summary, topLps);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadText(`payswap-treasury-${stamp}.csv`, csv, 'text/csv;charset=utf-8;');
      toast.success('Treasury report exported to CSV');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export CSV');
    } finally {
      setExporting(false);
    }
  }

  return (
    <Button
      onClick={handleExport}
      disabled={exporting}
      className="bg-emerald-600 text-white hover:bg-emerald-700"
    >
      {exporting ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Exporting…
        </>
      ) : (
        <>
          <FileDown className="mr-2 h-4 w-4" /> Export CSV
        </>
      )}
    </Button>
  );
}
