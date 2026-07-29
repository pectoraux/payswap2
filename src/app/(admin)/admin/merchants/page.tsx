import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Building2 } from 'lucide-react';
import { requireAdmin } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { formatCurrency, formatDate, statusBadgeClass } from '@/lib/format';

export const dynamic = 'force-dynamic';

const TIER_BADGE: Record<string, string> = {
  UNVERIFIED: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  VERIFIED: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
  TRUSTED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  PREMIUM: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
};

export default async function AdminMerchantsPage() {
  await requireAdmin();

  const merchants = await db.merchant.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Merchants"
        description="Every merchant account on the platform, with tier, status and bond."
      />

      {merchants.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-5 w-5" />}
            title="No merchants yet"
            description="Approve waitlist entries to convert them into merchants. New merchants show up here automatically."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Bond</TableHead>
                <TableHead className="text-right">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {merchants.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{m.name}</span>
                      {m.legalName && (
                        <span className="text-[11px] text-muted-foreground">{m.legalName}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.email}</TableCell>
                  <TableCell className="text-muted-foreground">{m.country}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={TIER_BADGE[m.tier] ?? ''}>
                      {m.tier}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(m.status)}>
                      {m.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(Number(m.bond), m.currency)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(m.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
