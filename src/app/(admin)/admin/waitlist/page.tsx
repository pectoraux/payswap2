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
import { WaitlistActions } from '@/components/admin/waitlist-actions';
import { Users } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function WaitlistPage() {
  const session = await getServerSession(authOptions);

  const entries = await db.waitlistEntry.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const pending = entries.filter((e) => e.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Waitlist</h1>
          <p className="text-sm text-muted-foreground">
            Review and approve merchant sign-up requests.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pending
          </span>
          <span className="text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {pending}
          </span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All entries</CardTitle>
          <CardDescription>
            {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} on the waitlist
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Users className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No waitlist entries</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                When businesses sign up, they will appear here for review.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Business type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.email}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.company || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.country}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.businessType || '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={e.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(e.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.status === 'PENDING' ? (
                        <WaitlistActions id={e.id} />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          Reviewed
                        </span>
                      )}
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
