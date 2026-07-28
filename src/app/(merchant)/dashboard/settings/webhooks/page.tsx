import { Webhook as WebhookIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { formatRelative, statusBadgeClass } from '@/lib/format';
import { CreateWebhookDialog } from '@/components/merchant/create-webhook-dialog';

export const dynamic = 'force-dynamic';

function parseEvents(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export default async function WebhooksPage() {
  const { merchant } = await requireMerchant();

  const endpoints = await db.webhookEndpoint.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { deliveries: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Receive real-time event notifications when payments and payouts change state."
        actions={<CreateWebhookDialog />}
      />

      {endpoints.length === 0 ? (
        <Card>
          <EmptyState
            icon={<WebhookIcon className="h-5 w-5" />}
            title="No webhook endpoints"
            description="Register an HTTPS endpoint to receive event payloads. We sign every delivery with HMAC-SHA256."
            action={{ label: 'Add endpoint', href: '/dashboard/settings/webhooks' }}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>Events</TableHead>
                <TableHead className="text-right">Deliveries</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {endpoints.map((w) => {
                const events = parseEvents(w.events);
                return (
                  <TableRow key={w.id}>
                    <TableCell className="max-w-[280px] truncate font-mono text-xs">
                      {w.url}
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[260px] flex-wrap gap-1">
                        {events.length === 0 ? (
                          <span className="text-xs text-muted-foreground">All events</span>
                        ) : (
                          events.slice(0, 3).map((e) => (
                            <Badge key={e} variant="secondary" className="text-[10px]">
                              {e}
                            </Badge>
                          ))
                        )}
                        {events.length > 3 && (
                          <Badge variant="outline" className="text-[10px]">
                            +{events.length - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {w._count.deliveries}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusBadgeClass(w.status)}>
                        {w.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelative(w.createdAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
