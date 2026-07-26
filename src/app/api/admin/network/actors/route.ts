import { NextResponse } from 'next/server';
import { requireAdminSession, forbidden } from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/network/actors — list active merchants and LPs for
 * the Scenario Builder's actor selection UI.
 *
 * Requires ADMIN or SUPER_ADMIN role.
 */
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return forbidden();

  const [merchants, lps] = await Promise.all([
    db.merchant.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        country: true,
        currency: true,
        businessType: true,
        tier: true,
      },
      orderBy: { name: 'asc' },
      take: 100,
    }),
    db.lPProfile.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        name: true,
        country: true,
        currencies: true,
        stake: true,
        tier: true,
        reputation: true,
      },
      orderBy: { name: 'asc' },
      take: 50,
    }),
  ]);

  return NextResponse.json({
    merchants: merchants.map((m) => ({
      id: m.id,
      name: m.name,
      country: m.country,
      currency: m.currency,
      businessType: m.businessType,
      tier: m.tier,
    })),
    lps: lps.map((lp) => ({
      id: lp.id,
      name: lp.name,
      country: lp.country,
      currencies: lp.currencies,
      stake: lp.stake,
      tier: lp.tier,
      reputation: lp.reputation,
    })),
  });
}
