import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { bandwidthEngine } from '@/runtime/liquidity';
import { db } from '@/lib/db';
import type { BandwidthAssetType } from '@/runtime/liquidity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  return NextResponse.json({ ok: true, positions: bandwidthEngine.listAll() });
}

/**
 * POST /api/runtime/bandwidth — register a new LP bandwidth position.
 *
 * Body:
 *   - lpId:           string  (resolved from the session if not provided)
 *   - country:        string  (ISO 3166-1 alpha-2, e.g. "GH")
 *   - assetType:      'fiat' | 'stablecoin' | 'twin_token'
 *   - currency:       string  (ISO 4217, e.g. "GHS")
 *   - capacity:       number  (> 0)
 *   - bond?:          number  (>= 0, default 0)
 *   - participationMode?: 'automatic' | 'manual' (default 'automatic')
 *
 * For fiat positions, an optional `debitAuthorization` may be included so the
 * position is immediately usable for debit-authorized settlement.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const userId = (session.user as { id?: string }).id;
  if (!userId) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const country = String(body.country ?? '').trim().toUpperCase();
  const currency = String(body.currency ?? '').trim().toUpperCase();
  const assetType = String(body.assetType ?? '').trim() as BandwidthAssetType;
  const capacity = Number(body.capacity ?? 0);
  const bond = Number(body.bond ?? 0);
  const participationMode =
    (String(body.participationMode ?? 'automatic') === 'manual'
      ? 'manual'
      : 'automatic') as 'automatic' | 'manual';

  if (!country || !/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json(
      { error: 'country must be a 2-letter ISO code' },
      { status: 400 },
    );
  }
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    return NextResponse.json(
      { error: 'currency must be a 3-letter ISO code' },
      { status: 400 },
    );
  }
  if (!['fiat', 'stablecoin', 'twin_token'].includes(assetType)) {
    return NextResponse.json(
      { error: 'assetType must be one of: fiat, stablecoin, twin_token' },
      { status: 400 },
    );
  }
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return NextResponse.json(
      { error: 'capacity must be a positive number' },
      { status: 400 },
    );
  }
  if (!Number.isFinite(bond) || bond < 0) {
    return NextResponse.json(
      { error: 'bond must be a non-negative number' },
      { status: 400 },
    );
  }

  // Resolve the LP id for the caller when not provided.
  let lpId = body.lpId ? String(body.lpId) : undefined;
  if (!lpId) {
    const account = await db.account.findFirst({
      where: { userId, type: 'LP' },
      include: { lpProfile: true },
    });
    if (account?.lpProfile?.id) {
      lpId = account.lpProfile.id;
    }
  }
  // Fall back to the demo seeded LP so admins / ops can preview the page.
  if (!lpId) lpId = 'seed-lp-1';

  const position = bandwidthEngine.register(
    lpId,
    country,
    assetType,
    currency,
    capacity,
    bond,
    participationMode,
  );

  // Optional: attach a debit authorization for fiat bandwidth.
  if (
    assetType === 'fiat' &&
    body.debitAuthorization &&
    typeof body.debitAuthorization === 'object'
  ) {
    const da = body.debitAuthorization as {
      connector?: string;
      accountId?: string;
    };
    const connector = (
      ['stripe', 'ach', 'bank', 'mobile_money'].includes(String(da.connector))
        ? String(da.connector)
        : 'bank'
    ) as 'stripe' | 'ach' | 'bank' | 'mobile_money';
    bandwidthEngine.authorizeDebit(position, connector, String(da.accountId ?? ''));
  }

  return NextResponse.json({ ok: true, position }, { status: 201 });
}
