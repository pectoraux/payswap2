import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth-guards';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FileText,
  Receipt,
  ArrowDownToLine,
  Users,
  FileSpreadsheet,
  FileDown,
  Calendar,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

const REPORT_TYPES = [
  {
    id: 'financial',
    name: 'Financial Summary',
    description:
      'Revenue, fees, refunds and net settlement across the selected period.',
    icon: <Receipt className="h-4 w-4" />,
    tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  {
    id: 'tax',
    name: 'Tax Report',
    description:
      'VAT, withholding and tax-band breakdowns suitable for filing.',
    icon: <FileText className="h-4 w-4" />,
    tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  },
  {
    id: 'settlement',
    name: 'Settlement Report',
    description:
      'Payouts, settlement windows and bank reconciliation detail.',
    icon: <ArrowDownToLine className="h-4 w-4" />,
    tone: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  },
  {
    id: 'customer',
    name: 'Customer Report',
    description:
      'Cohort analysis, lifetime value and retention for your payers.',
    icon: <Users className="h-4 w-4" />,
    tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
];

const EXPORT_FORMATS = [
  { id: 'csv', name: 'CSV', icon: <FileText className="h-3.5 w-3.5" /> },
  { id: 'excel', name: 'Excel', icon: <FileSpreadsheet className="h-3.5 w-3.5" /> },
  { id: 'pdf', name: 'PDF', icon: <FileDown className="h-3.5 w-3.5" /> },
];

export default async function ReportsPage() {
  // Validates session + merchant role.
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Generate financial, tax and settlement reports for accounting.
        </p>
      </div>

      {/* Date range + export controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Date range</CardTitle>
          <CardDescription>Pick the window to report on</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="from" className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> From
              </Label>
              <Input id="from" type="date" defaultValue={monthAgo} className="sm:w-44" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to" className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> To
              </Label>
              <Input id="to" type="date" defaultValue={today} className="sm:w-44" />
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Export as
              </span>
              {EXPORT_FORMATS.map((f) => (
                <Button key={f.id} variant="outline" size="sm">
                  {f.icon}
                  {f.name}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report type cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {REPORT_TYPES.map((r) => (
          <Card key={r.id}>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${r.tone}`}
                >
                  {r.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base">{r.name}</CardTitle>
                  <CardDescription className="mt-1">{r.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400"
              >
                Generate report
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Saved reports placeholder */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved reports</CardTitle>
          <CardDescription>
            Previously generated reports are listed here for download.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <FileText className="h-6 w-6 text-emerald-500" />
            </div>
            <h3 className="mt-4 text-sm font-semibold">No saved reports yet</h3>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Generate a report above and it will appear here for re-download.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
