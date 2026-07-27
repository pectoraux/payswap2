/**
 * GET /api/developer/overview
 *
 * Returns the developer's sandbox state, API keys, recent audit-log events,
 * and their published extensions. Used by the developer console home page
 * as a single round-trip summary.
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { resolveDeveloperMerchantId } from '@/lib/developer-context';
import { getOrCreateDeveloperSandbox } from '@/lib/developer-sandbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  try {
    const merchantId = await resolveDeveloperMerchantId(userId).catch(() => null);
    const sandbox = getOrCreateDeveloperSandbox(userId, merchantId ?? 'dev-sandbox');

    const apiKeys = merchantId
      ? (await db.apiKey.findMany({
          where: { merchantId },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })).map((k) => ({
          id: k.id,
          label: k.label,
          keyPrefix: k.keyPrefix,
          scopes: k.scopes,
          status: k.status,
          lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
          createdAt: k.createdAt.toISOString(),
        }))
      : [];

    const recentEvents = (await db.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })).map((e) => ({
      id: e.id,
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId ?? null,
      result: e.result,
      createdAt: e.createdAt.toISOString(),
    }));

    const extensions = (await db.extension.findMany({
      where: { developerId: userId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true, slug: true, name: true, status: true, version: true,
        installCount: true, rating: true, updatedAt: true,
      },
    })).map((e) => ({ ...e, updatedAt: e.updatedAt.toISOString() }));

    return NextResponse.json({
      ok: true,
      sandbox: {
        id: sandbox.id,
        state: sandbox.state,
        createdAt: sandbox.createdAt,
        lastActivityAt: sandbox.lastActivityAt,
        resetAt: sandbox.resetAt ?? null,
        testPayments: sandbox.payments?.length ?? 0,
        testInvoices: sandbox.invoices?.length ?? 0,
        testCustomers: sandbox.customers?.length ?? 0,
        testProducts: sandbox.products?.length ?? 0,
        connectors: sandbox.connectors?.length ?? 0,
        apiKeys: sandbox.apiKeys?.length ?? 0,
      },
      apiKeys,
      recentEvents,
      extensions,
      merchantId,
    });
  } catch (err) {
    console.error('[api/developer/overview GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
