import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CURRENCIES = new Set(['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR']);
const INTERVALS = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);

/**
 * POST /api/subscriptions/create
 *
 * Create a new recurring billing plan (Subscription) for the authenticated
 * merchant. The plan starts in the ACTIVE state with the current billing
 * period set to "now → now + interval" so the merchant can immediately
 * subscribe customers to it.
 *
 * Body:
 *   {
 *     planName: string,
 *     amount: number,
 *     currency?: string,         // default GHS
 *     interval?: string,          // DAILY | WEEKLY | MONTHLY | YEARLY (default MONTHLY)
 *     description?: string,
 *     trialDays?: number,         // optional trial period in days
 *   }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const env = await getEnvironment();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const planName =
    typeof body.planName === 'string' ? body.planName.trim() : '';
  if (!planName) {
    return NextResponse.json(
      { error: 'Plan name is required' },
      { status: 400 },
    );
  }
  if (planName.length > 100) {
    return NextResponse.json(
      { error: 'Plan name must be 100 characters or fewer' },
      { status: 400 },
    );
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json(
      { error: 'A valid amount is required' },
      { status: 400 },
    );
  }

  const currency =
    typeof body.currency === 'string' && CURRENCIES.has(body.currency)
      ? body.currency
      : 'GHS';

  const intervalRaw =
    typeof body.interval === 'string'
      ? body.interval.trim().toUpperCase()
      : 'MONTHLY';
  const interval = INTERVALS.has(intervalRaw) ? intervalRaw : 'MONTHLY';

  const trialDaysRaw = Number(body.trialDays);
  const trialDays =
    Number.isFinite(trialDaysRaw) && trialDaysRaw > 0
      ? Math.floor(trialDaysRaw)
      : 0;

  // Compute the first billing period so the merchant can see the plan is live.
  const now = new Date();
  const periodEnd = new Date(now);
  switch (interval) {
    case 'DAILY':
      periodEnd.setDate(periodEnd.getDate() + 1);
      break;
    case 'WEEKLY':
      periodEnd.setDate(periodEnd.getDate() + 7);
      break;
    case 'YEARLY':
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      break;
    case 'MONTHLY':
    default:
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      break;
  }

  const trialEnd =
    trialDays > 0 ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000) : null;

  const subscription = await db.subscription.create({
    data: {
      merchantId,
      planName,
      amount,
      currency,
      interval,
      status: 'ACTIVE',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      trialEnd,
      environment: env,
    },
  });

  // Best-effort audit log so plan creation is traceable.
  try {
    await db.auditLog.create({
      data: {
        userId: (session?.user as any)?.id ?? null,
        action: 'SUBSCRIPTION_PLAN.CREATE',
        resourceType: 'Subscription',
        resourceId: subscription.id,
        result: 'SUCCESS',
        details: JSON.stringify({
          planName,
          amount,
          currency,
          interval,
          trialDays,
        }),
      },
    });
  } catch {
    // Audit log failures must never block the plan creation itself.
  }

  return NextResponse.json({ subscription }, { status: 201 });
}
