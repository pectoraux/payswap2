import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
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
import { Building2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function MerchantsPage() {
  const session = await getServerSession(authOptions);

  const merchants = await db.merchant.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const fmt = (n: number, c: string = 'GHS') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Merchants</h1>
        <p className="text-sm text-muted-foreground">
          Businesses onboarded onto the PaySwap platform.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All merchants</CardTitle>
          <CardDescription>
            {merchants.length} merchant{merchants.length === 1 ? '' : 's'} onboarded
          </CardDescription>
        </CardHeader>
        <CardContent>
          {merchants.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Building2 className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No merchants yet</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Approved waitlist entries become merchants and appear here.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Bond</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {merchants.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.email}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.country}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={m.tier} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={m.status} />
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {fmt(m.bond, m.currency)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(m.createdAt)}
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
