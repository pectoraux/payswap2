import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { resolveDeveloperMerchantId } from '@/lib/developer-context';
import { PageHeader } from '@/components/role-ui';
import {
  WebhooksManager,
  type EndpointView,
  type DeliveryView,
} from './webhooks-manager';

export const dynamic = 'force-dynamic';

export default async function DeveloperWebhooksPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) redirect('/login');

  const merchantId = await resolveDeveloperMerchantId(userId);

  let endpoints: EndpointView[] = [];
  let deliveries: DeliveryView[] = [];

  if (merchantId) {
    const endpointRows = await db.webhookEndpoint.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });

    const endpointIds = endpointRows.map((e) => e.id);
    const deliveryRows =
      endpointIds.length > 0
        ? await db.webhookDelivery.findMany({
            where: { endpointId: { in: endpointIds } },
            orderBy: { createdAt: 'desc' },
            take: 25,
          })
        : [];

    // Compute per-endpoint stats.
    const stats = new Map<
      string,
      { total: number; success: number; lastDeliveryAt: Date | null }
    >();
    for (const d of deliveryRows) {
      const s = stats.get(d.endpointId) ?? { total: 0, success: 0, lastDeliveryAt: null };
      s.total += 1;
      if (d.status === 'DELIVERED') s.success += 1;
      if (!s.lastDeliveryAt || d.createdAt > s.lastDeliveryAt) {
        s.lastDeliveryAt = d.createdAt;
      }
      stats.set(d.endpointId, s);
    }

    endpoints = endpointRows.map((e) => {
      const s = stats.get(e.id);
      return {
        id: e.id,
        url: e.url,
        events: e.events,
        status: e.status,
        createdAt: e.createdAt.toISOString(),
        deliveryCount: s?.total ?? 0,
        successRate: s && s.total > 0 ? s.success / s.total : null,
        lastDeliveryAt: s?.lastDeliveryAt ? s.lastDeliveryAt.toISOString() : null,
      };
    });

    deliveries = deliveryRows.map((d) => ({
      id: d.id,
      endpointId: d.endpointId,
      eventType: d.eventType,
      status: d.status,
      responseStatus: d.responseStatus,
      responseBody: d.responseBody,
      attempts: d.attempts,
      createdAt: d.createdAt.toISOString(),
      deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
    }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Register endpoints, subscribe to events, and inspect delivery results — all in your sandbox."
      />
      <WebhooksManager initialEndpoints={endpoints} initialDeliveries={deliveries} />
    </div>
  );
}
