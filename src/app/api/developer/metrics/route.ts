import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { resolveDeveloperMerchantId } from '@/lib/developer-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/developer/metrics
 *
 * Returns usage metrics for the developer's console:
 *   - API calls in the last 24h (from auditLog where action like 'api.%')
 *   - Webhook deliveries in the last 24h
 *   - Test payments in the last 24h (from auditLog where action like '%payment%')
 *   - Error rate (errors / total in last 24h)
 *   - Per-hour timeseries of API calls for the chart
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  try {
    const merchantId = await resolveDeveloperMerchantId(userId);
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // === API calls in the last 24h ===
    // Look for audit log entries with userId=this developer in the last 24h.
    // These represent actions taken by the developer (API calls, page views,
    // settings changes, etc.).
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

    // Test payments in the last 24h — count audit log entries with action
    // containing 'payment' (case-insensitive).
    const testPayments24h = recentLogs.filter((l) =>
      l.action.toLowerCase().includes('payment'),
    ).length;

    // === Webhook deliveries in the last 24h ===
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

    // === Per-hour timeseries of API calls (for the chart) ===
    const buckets: { ts: number; count: number; errors: number }[] = [];
    const bucketMs = 60 * 60 * 1000; // 1 hour
    const bucketCount = 24;
    for (let i = bucketCount - 1; i >= 0; i--) {
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

    return NextResponse.json({
      ok: true,
      metrics: {
        apiCalls24h,
        webhookDeliveries24h,
        webhookSuccess24h,
        testPayments24h,
        errorRate,
        errors24h,
      },
      timeseries: {
        buckets,
        bucketCount,
        bucketMs,
        label: 'API calls per hour (last 24h)',
      },
    });
  } catch (err) {
    console.error('[api/developer/metrics] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
