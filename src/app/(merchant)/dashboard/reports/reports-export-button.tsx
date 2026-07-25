'use client';

import { Button } from '@/components/ui/button';
import { FileDown, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export interface PaymentRow {
  id: string;
  reference: string | null;
  amount: number;
  currency: string;
  fee: number;
  netAmount: number;
  status: string;
  method: string | null;
  description: string | null;
  createdAt: string;
  settledAt: string | null;
}

interface ReportsExportButtonProps {
  rows: PaymentRow[];
}

/** Escape a single CSV cell, quoting when it contains commas, quotes or newlines. */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build the CSV string for a list of payment rows. */
function buildCsv(rows: PaymentRow[]): string {
  const header = [
    'id',
    'reference',
    'status',
    'method',
    'amount',
    'fee',
    'net_amount',
    'currency',
    'description',
    'created_at',
    'settled_at',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.reference,
        r.status,
        r.method,
        r.amount.toFixed(2),
        r.fee.toFixed(2),
        r.netAmount.toFixed(2),
        r.currency,
        r.description,
        r.createdAt,
        r.settledAt ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n');
}

/** Trigger a browser download of the given text as a file. */
function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportsExportButton({ rows }: ReportsExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  function handleExport() {
    if (rows.length === 0) {
      toast.error('Nothing to export — no completed payments yet');
      return;
    }
    setExporting(true);
    try {
      const csv = buildCsv(rows);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadText(`payswap-payments-${stamp}.csv`, csv, 'text/csv;charset=utf-8;');
      toast.success(`Exported ${rows.length} payments to CSV`);
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
