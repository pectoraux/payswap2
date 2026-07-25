import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_METHODS = new Set(['bank', 'mobile_money', 'onchain']);

/**
 * POST /api/payouts/create
 *
 * Create a Payout (withdrawal) record for the authenticated merchant. The
 * payout starts in the REQUESTED state and is picked up by the ops pipeline
 * for processing.
 *
 * Body:
 *   { method, sourceAmount, sourceCurrency, destinationCurrency, destination }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const method = typeof body.method === 'string' ? body.method : '';
  const sourceAmount = Number(body.sourceAmount);
  const sourceCurrency =
    typeof body.sourceCurrency === 'string' ? body.sourceCurrency : 'GHS';
  const destinationCurrency =
    typeof body.destinationCurrency === 'string'
      ? body.destinationCurrency
      : sourceCurrency;
  const destination =
    typeof body.destination === 'string' && body.destination.trim()
      ? body.destination.trim()
      : null;

  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json(
      { error: 'Invalid payout method' },
      { status: 400 },
    );
  }
  if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }
  if (!destination) {
    return NextResponse.json(
      { error: 'Destination is required' },
      { status: 400 },
    );
  }

  // Simple fee estimate: 50 bps of source amount. The ops pipeline can
  // recompute this later, but we want the merchant dashboard to show a
  // sensible net amount immediately.
  const feeBps = 50;
  const fee = (sourceAmount * feeBps) / 10000;
  const netAmount = sourceAmount - fee;
  const fxRate = sourceCurrency === destinationCurrency ? 1 : 1;

  const payout = await db.payout.create({
    data: {
      merchantId,
      method,
      sourceAmount,
      sourceAsset: `TWIN${sourceCurrency}`,
      sourceCurrency,
      destinationCurrency,
      destination,
      fxRate,
      feeBps,
      fee,
      netAmount,
      status: 'REQUESTED',
      reason: `Payout request ${randomUUID().slice(0, 8).toUpperCase()}`,
    },
  });

  return NextResponse.json({ payout }, { status: 201 });
}
