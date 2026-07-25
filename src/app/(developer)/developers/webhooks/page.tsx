import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';
import { WebhookTester, type EndpointView, type DeliveryView } from './webhook-tester';

export const dynamic = 'force-dynamic';

/**
 * Webhook tester page.
 *
 * Server wrapper that loads the merchant's webhook endpoints + recent
 * deliveries from the DB and passes them as initial props to the interactive
 * client component.
 */
export default async function DeveloperWebhooksPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const env = await getEnvironment();

  // Developer portal is open to DEVELOPER/ADMIN roles, but webhook endpoints
  // are tied to a merchant. Resolve the caller's merchantId (if any) so the
  // tester shows real endpoints.
  const userId = (session?.user as any)?.id as string | undefined;
  const userRole = userId
    ? await db.userRole.findFirst({
        where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF', 'DEVELOPER'] } },
      })
    : null;
  const merchantId = userRole?.merchantId ?? null;

  let endpoints: EndpointView[] = [];
  let recentDeliveries: DeliveryView[] = [];

  if (merchantId) {
    const endpointRows = await db.webhookEndpoint.findMany({
      where: { merchantId, environment: env },
      orderBy: { createdAt: 'desc' },
    });
    endpoints = endpointRows.map((e) => ({
      id: e.id,
      url: e.url,
      events: e.events
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      status: e.status,
      createdAt: e.createdAt.toISOString(),
    }));

    if (endpoints.length > 0) {
      const deliveryRows = await db.webhookDelivery.findMany({
        where: { endpointId: { in: endpoints.map((e) => e.id) } },
        orderBy: { createdAt: 'desc' },
        take: 25,
      });
      recentDeliveries = deliveryRows.map((d) => ({
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
  }

  return (
    <WebhookTester
      endpoints={endpoints}
      recentDeliveries={recentDeliveries}
      hasMerchant={!!merchantId}
    />
  );
}
