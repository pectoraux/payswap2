import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant } from '@/lib/auth-guards';
import { getEnvironment } from '@/lib/environment';
import { db } from '@/lib/db';
import {
  DEFAULT_PLAN,
  getPlan,
  isPlanId,
  type PlanId,
} from '@/lib/subscription-plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Map a guard error to the appropriate HTTP response. */
function guardErrorResponse(code: string) {
  if (code === 'UNAUTHORIZED') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/** Safely parse the merchant `settings` JSON blob. */
function parseSettings(raw: string | null): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, any>)
      : {};
  } catch {
    return {};
  }
}

/** Build the usage snapshot for the current month. */
async function buildUsage(merchantId: string, env: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [transactions, apiKeys, webhooks, deliveries] = await Promise.all([
    db.payment.count({
      where: {
        merchantId,
        environment: env,
        createdAt: { gte: monthStart },
      },
    }),
    db.apiKey.count({
      where: { merchantId, environment: env, status: 'ACTIVE' },
    }),
    db.webhookEndpoint.count({
      where: { merchantId, environment: env, status: 'ACTIVE' },
    }),
    db.webhookDelivery.count({
      where: {
        createdAt: { gte: monthStart },
        endpoint: { merchantId, environment: env },
      },
    }),
  ]);

  return {
    monthStart: monthStart.toISOString(),
    transactions,
    apiCalls: deliveries, // webhook deliveries as a proxy for outbound API activity
    webhookDeliveries: deliveries,
    activeApiKeys: apiKeys,
    activeWebhooks: webhooks,
  };
}

/**
 * GET /api/subscription
 *
 * Returns the merchant's current subscription plan, the limits associated with
 * that plan, and a usage snapshot for the current billing period (month).
 */
export async function GET() {
  let merchantId: string;
  let merchant: any;
  try {
    const ctx = await requireMerchant();
    merchantId = ctx.merchantId;
    merchant = ctx.merchant;
  } catch (err) {
    const code = err instanceof Error ? err.message : 'UNAUTHORIZED';
    return guardErrorResponse(code);
  }

  const env = await getEnvironment();
  const settings = parseSettings(merchant.settings);
  const planId: PlanId = isPlanId(settings?.subscription?.plan)
    ? settings.subscription.plan
    : DEFAULT_PLAN;
  const plan = getPlan(planId);
  const usage = await buildUsage(merchantId, env);

  return NextResponse.json({
    plan: plan.id,
    name: plan.name,
    limits: plan.limits,
    usage,
  });
}

/**
 * PATCH /api/subscription
 *
 * Update the merchant's subscription plan. The plan is persisted inside the
 * merchant's `settings` JSON blob under `subscription.plan`.
 *
 * Body:
 *   { plan: 'starter' | 'growth' | 'scale' | 'enterprise' }
 */
export async function PATCH(req: NextRequest) {
  let merchantId: string;
  let merchant: any;
  let session: any;
  try {
    const ctx = await requireMerchant();
    merchantId = ctx.merchantId;
    merchant = ctx.merchant;
    session = ctx.session;
  } catch (err) {
    const code = err instanceof Error ? err.message : 'UNAUTHORIZED';
    return guardErrorResponse(code);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isPlanId(body?.plan)) {
    return NextResponse.json(
      { error: 'plan must be one of starter, growth, scale, enterprise' },
      { status: 400 },
    );
  }

  const newPlanId: PlanId = body.plan;
  const previous = parseSettings(merchant.settings);
  const previousPlan = isPlanId(previous?.subscription?.plan)
    ? previous.subscription.plan
    : DEFAULT_PLAN;

  const nextSettings = {
    ...previous,
    subscription: {
      ...(previous.subscription ?? {}),
      plan: newPlanId,
      updatedAt: new Date().toISOString(),
      previousPlan,
    },
  };

  const updated = await db.merchant.update({
    where: { id: merchantId },
    data: { settings: JSON.stringify(nextSettings) },
  });

  // Record an audit entry for the plan change.
  try {
    await db.auditLog.create({
      data: {
        userId: (session?.user as any)?.id ?? null,
        action: 'SUBSCRIPTION.UPDATE',
        resourceType: 'Merchant',
        resourceId: merchantId,
        result: 'SUCCESS',
        details: JSON.stringify({ from: previousPlan, to: newPlanId }),
      },
    });
  } catch {
    // best-effort
  }

  const env = await getEnvironment();
  const plan = getPlan(newPlanId);
  const usage = await buildUsage(merchantId, env);

  return NextResponse.json({
    plan: plan.id,
    name: plan.name,
    limits: plan.limits,
    usage,
    merchant: { id: updated.id, settings: updated.settings },
  });
}
