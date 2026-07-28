'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FileOutput,
  Loader2,
  Hash,
  CalendarRange,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

export type ExportType =
  | 'full'
  | 'aml'
  | 'travel_rule'
  | 'proof_of_reserves'
  | 'audit_trail';

export interface RegulatorExportDTO {
  exportId: string;
  type: ExportType;
  period: { from: number; to: number };
  generatedAt: number;
  data: unknown;
  hash: string;
  signature?: string;
}

const EXPORT_TYPES: { value: ExportType; label: string; description: string }[] = [
  {
    value: 'full',
    label: 'Full',
    description: 'Combined AML + Travel Rule + Proof of Reserves + Audit Trail',
  },
  {
    value: 'aml',
    label: 'AML',
    description: 'AML alerts + SARs filed in the period',
  },
  {
    value: 'travel_rule',
    label: 'Travel Rule',
    description: 'Cross-border transactions above $1,000 threshold',
  },
  {
    value: 'proof_of_reserves',
    label: 'Proof of Reserves',
    description: 'Current proof of reserves snapshot',
  },
  {
    value: 'audit_trail',
    label: 'Audit Trail',
    description: 'Immutable audit log entries for the period',
  },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function thirtyDaysAgoISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function fmtDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Render an arbitrary export `data` payload in a readable format.
 * We render common shapes (summary, arrays) as cards / tables, then fall back
 * to a pretty-printed JSON view for everything else.
 */
function ExportDataView({ data }: { data: unknown }) {
  if (data === null || data === undefined) {
    return (
      <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
        No data attached to this export.
      </div>
    );
  }

  // Helper for proof_of_reserves (nested ProofOfReserves payload)
  if (
    typeof data === 'object' &&
    data !== null &&
    'reserves' in data &&
    'liabilities' in data &&
    'proof' in data
  ) {
    const por = data as {
      proofId: string;
      verified: boolean;
      reserves: { totalReserves: number; fiatByCurrency: Record<string, number> };
      liabilities: { totalLiabilities: number };
      proof: { solvencyRatio: number; reserveRatio: number; hash: string };
    };
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Total Reserves" value={String(por.reserves.totalReserves)} />
          <Stat label="Total Liabilities" value={String(por.liabilities.totalLiabilities)} />
          <Stat label="Verified" value={por.verified ? 'Yes' : 'No'} />
          <Stat label="Solvency Ratio" value={String(por.proof.solvencyRatio)} />
          <Stat label="Reserve Ratio" value={String(por.proof.reserveRatio)} />
          <Stat label="Proof ID" value={por.proofId} mono />
        </div>
        <details className="rounded-md border p-2 text-xs">
          <summary className="cursor-pointer font-medium">Raw JSON</summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted p-2 text-[10px]">
            {JSON.stringify(data, null, 2)}
          </pre>
        </details>
      </div>
    );
  }

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const summary = typeof obj.summary === 'object' && obj.summary !== null
      ? (obj.summary as Record<string, unknown>)
      : null;

    // Render array keys as count badges + tables
    const arrayKeys = Object.keys(obj).filter((k) => Array.isArray(obj[k]));

    return (
      <div className="space-y-3">
        {summary && (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Summary
            </div>
            <div className="flex flex-wrap gap-3">
              {Object.entries(summary).map(([k, v]) => (
                <div
                  key={k}
                  className="rounded-md border bg-background px-2 py-1 text-xs"
                >
                  <span className="text-muted-foreground">{k}</span>{' '}
                  <span className="font-semibold tabular-nums">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {arrayKeys.map((key) => {
          const arr = obj[key] as unknown[];
          return (
            <details key={key} className="rounded-md border p-2 text-xs">
              <summary className="cursor-pointer font-medium">
                {key}{' '}
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {arr.length} item{arr.length === 1 ? '' : 's'}
                </Badge>
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted p-2 text-[10px]">
                {JSON.stringify(arr, null, 2)}
              </pre>
            </details>
          );
        })}

        {arrayKeys.length === 0 && !summary && (
          <pre className="max-h-96 overflow-auto rounded bg-muted p-2 text-[10px]">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  return (
    <pre className="max-h-96 overflow-auto rounded bg-muted p-2 text-[10px]">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border bg-card/50 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={
          'mt-1 truncate text-sm font-semibold ' + (mono ? 'font-mono' : 'tabular-nums')
        }
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Admin: Regulator Exports console.
 *
 * The export data is generated on demand — the page loads empty and lets the
 * admin pick a type + date range, then calls /api/regulatory/export.
 */
export function RegulatorExportsViewer() {
  const [type, setType] = React.useState<ExportType>('full');
  const [from, setFrom] = React.useState<string>(thirtyDaysAgoISO());
  const [to, setTo] = React.useState<string>(todayISO());
  const [loading, setLoading] = React.useState(false);
  const [exp, setExp] = React.useState<RegulatorExportDTO | null>(null);

  async function generate(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    try {
      const params = new URLSearchParams({ type });
      if (from) params.set('from', new Date(from).toISOString());
      if (to) {
        const toDate = new Date(to);
        // Include the full end day.
        toDate.setHours(23, 59, 59, 999);
        params.set('to', toDate.toISOString());
      }
      const res = await fetch(`/api/regulatory/export?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.export) {
        throw new Error(data?.error || `Failed (${res.status})`);
      }
      setExp(data.export as RegulatorExportDTO);
      toast.success(`Export generated · ${data.export.exportId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  }

  const selectedType = EXPORT_TYPES.find((t) => t.value === type);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileOutput className="h-4 w-4" />
            Generate Regulator Export
          </CardTitle>
          <CardDescription>
            Produces a structured JSON report (AML, Travel Rule, Proof of
            Reserves, Audit Trail, or Full) signed with the regulator signing
            key when configured.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={generate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5 lg:col-span-2">
                <Label htmlFor="export-type">Export type</Label>
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as ExportType)}
                >
                  <SelectTrigger id="export-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPORT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  {selectedType?.description}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="export-from">From</Label>
                <Input
                  id="export-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="export-to">To</Label>
                <Input
                  id="export-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    <FileOutput className="mr-1.5 h-4 w-4" /> Generate Export
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {exp && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Export ready
                </CardTitle>
                <CardDescription>
                  {exp.type.replace(/_/g, ' ')} · {fmtDate(exp.generatedAt)}
                </CardDescription>
              </div>
              <Badge variant="outline" className="font-mono">
                <Hash className="mr-1 h-3 w-3" />
                {exp.exportId}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Period From" value={fmtDate(exp.period.from)} />
              <Stat label="Period To" value={fmtDate(exp.period.to)} />
              <Stat
                label="Signature"
                value={exp.signature ? 'Signed' : 'Unsigned'}
              />
              <Stat label="Generated At" value={fmtDate(exp.generatedAt)} />
            </div>

            <div className="rounded-md border bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <CalendarRange className="h-3.5 w-3.5" />
                Integrity Hash (SHA-256)
              </div>
              <code className="mt-1 block break-all font-mono text-[10px]">
                {exp.hash}
              </code>
              {exp.signature && (
                <>
                  <div className="mt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Signature
                  </div>
                  <code className="mt-1 block break-all font-mono text-[10px]">
                    {exp.signature}
                  </code>
                </>
              )}
            </div>

            <div>
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Export Payload
              </div>
              <ExportDataView data={exp.data} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
