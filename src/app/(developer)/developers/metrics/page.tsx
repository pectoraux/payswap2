import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { resolveDeveloperMerchantId } from '@/lib/developer-context';
import { PageHeader } from '@/components/role-ui';
import { MetricsViewer } from './metrics-viewer';

export const dynamic = 'force-dynamic';

export default async function DeveloperMetricsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) redirect('/login');

  const merchantId = await resolveDeveloperMerchantId(userId);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Pull 24h of audit log entries for this developer.
  const recentLogs = await db.auditLog.findMany({
    where: {
      OR: [
        { userId },
        ...(merchantId ? [{ details: { contains: merchantId } }] : []),
      ],
      createdAt: { gte: yesterday },
    },
    select: { action: true, result: true, createdAt: true },
  });

  const apiCalls24h = recentLogs.length;
  const errors24h = recentLogs.filter((l) => l.result === 'ERROR').length;
  const errorRate = apiCalls24h > 0 ? errors24h / apiCalls24h : 0;
  const testPayments24h = recentLogs.filter((l) =>
    l.action.toLowerCase().includes('payment'),
  ).length;

  let webhookDeliveries24h = 0;
  let webhookSuccess24h = 0;
  if (merchantId) {
    const endpoints = await db.webhookEndpoint.findMany({
      where: { merchantId },
      select: { id: true },
    });
    if (endpoints.length > 0) {
      const deliveries = await db.webhookDelivery.findMany({
        where: {
          endpointId: { in: endpoints.map((e) => e.id) },
          createdAt: { gte: yesterday },
        },
        select: { status: true },
      });
      webhookDeliveries24h = deliveries.length;
      webhookSuccess24h = deliveries.filter((d) => d.status === 'DELIVERED').length;
    }
  }

  const buckets: { ts: number; count: number; errors: number }[] = [];
  const bucketMs = 60 * 60 * 1000;
  for (let i = 23; i >= 0; i--) {
    const bucketStart = new Date(now.getTime() - i * bucketMs);
    const bucketEnd = new Date(bucketStart.getTime() + bucketMs);
    const inBucket = recentLogs.filter((l) => {
      return l.createdAt >= bucketStart && l.createdAt < bucketEnd;
    });
    buckets.push({
      ts: bucketStart.getTime(),
      count: inBucket.length,
      errors: inBucket.filter((l) => l.result === 'ERROR').length,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Metrics"
        description="Your usage over the last 24 hours — API calls, webhook deliveries, test payments, and error rate."
      />
      <MetricsViewer
        initialMetrics={{
          apiCalls24h,
          webhookDeliveries24h,
          webhookSuccess24h,
          testPayments24h,
          errorRate,
          errors24h,
        }}
        initialBuckets={buckets}
      />
    </div>
  );
}
