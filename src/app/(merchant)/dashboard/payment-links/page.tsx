import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import { Link2, ExternalLink } from 'lucide-react';
import { CreatePaymentLinkDialog } from '@/components/merchant/create-payment-link-dialog';

export const dynamic = 'force-dynamic';

export default async function PaymentLinksPage() {
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const { merchant } = ctx;
  const merchantId = merchant.id;

  const env = await getEnvironment();

  const links = await db.paymentLink.findMany({
    where: { merchantId, environment: env },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const fmt = (n: number, c: string = merchant?.currency || 'GHS') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const totalCollected = links.reduce((s, l) => s + l.totalCollected, 0);
  const totalPayments = links.reduce((s, l) => s + l.paymentCount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payment links</h1>
          <p className="text-sm text-muted-foreground">
            Reusable links your customers can pay through anytime.
          </p>
        </div>
        <CreatePaymentLinkDialog />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total links
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums">{links.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Payments collected
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums">{totalPayments}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total collected
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {fmt(totalCollected)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All payment links</CardTitle>
          <CardDescription>
            {links.length} link{links.length === 1 ? '' : 's'} created
          </CardDescription>
        </CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Link2 className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium">No payment links yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click <span className="font-medium text-foreground">Create Link</span> above to start
                collecting payments without a website.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">
                      {l.description || (
                        <span className="text-muted-foreground">Untitled</span>
                      )}
                    </TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      {fmt(l.amount, l.currency)}
                    </TableCell>
                    <TableCell className="max-w-[16rem]">
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 truncate font-mono text-xs text-emerald-600 hover:underline dark:text-emerald-400"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{l.url}</span>
                      </a>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={l.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.paymentCount}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {fmt(l.totalCollected, l.currency)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(l.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
