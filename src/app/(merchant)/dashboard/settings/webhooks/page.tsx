import { redirect } from 'next/navigation';
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
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Webhook, Plus, Link as LinkIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function WebhooksPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session?.user as any)?.id;
  const userRole = await db.userRole.findFirst({
    where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF'] } },
  });
  const merchantId = userRole?.merchantId;
  if (!merchantId) redirect('/unauthorized');

  const webhooks = await db.webhookEndpoint.findMany({
    where: { merchantId },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Webhooks</h1>
          <p className="text-sm text-muted-foreground">
            Receive real-time event notifications at your endpoints.
          </p>
        </div>
        <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Plus className="mr-2 h-4 w-4" /> Add endpoint
        </Button>
      </div>

      {webhooks.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Webhook className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No webhooks yet</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Register an endpoint to receive event payloads from PaySwap.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {webhooks.map((w) => {
            const events = w.events
              .split(',')
              .map((e) => e.trim())
              .filter(Boolean);
            return (
              <Card key={w.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <LinkIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="truncate font-mono text-xs">
                          {w.url}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          Endpoint
                        </CardDescription>
                      </div>
                    </div>
                    <StatusBadge status={w.status} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Subscribed events
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {events.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No events</span>
                    ) : (
                      events.map((e) => (
                        <span
                          key={e}
                          className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                        >
                          {e}
                        </span>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
