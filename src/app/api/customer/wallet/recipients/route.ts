import { NextRequest, NextResponse } from 'next/server';
import { resolveCustomer, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/customer/wallet/recipients?q=<query>
 *
 * Returns merchants + customers (excluding the caller) whose name /
 * email / phone match the query. Used for the transfer autocomplete.
 */
export async function GET(req: NextRequest) {
  const ctx = await resolveCustomer();
  if (!ctx) return unauthorized();

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2) {
    return NextResponse.json({ ok: true, recipients: [] });
  }

  // SQLite has no insensitive mode — LIKE is case-insensitive for ASCII
  // by default. We split into multiple OR clauses so partial matches at
  // the start, middle or end of name/email/phone all work.
  const like = `%${q}%`;

  const [merchants, customers] = await Promise.all([
    db.merchant.findMany({
      where: {
        OR: [
          { name: { contains: q } },
          { email: { contains: q } },
          { phone: { contains: q } },
        ],
        status: { not: 'CLOSED' },
      },
      take: 10,
      select: { id: true, name: true, email: true, phone: true, country: true },
    }),
    db.customer.findMany({
      where: {
        AND: [
          { id: { not: ctx.customer.id } },
          {
            OR: [
              { name: { contains: q } },
              { email: { contains: q } },
              { phone: { contains: q } },
            ],
          },
        ],
      },
      take: 10,
      select: { id: true, name: true, email: true, phone: true, country: true },
    }),
  ]);

  void like; // for clarity — we use `contains: q` above (SQLite-friendly)

  const recipients = [
    ...merchants.map((m) => ({
      type: 'MERCHANT' as const,
      id: m.id,
      name: m.name,
      email: m.email,
      phone: m.phone ?? null,
      country: m.country ?? null,
    })),
    ...customers.map((c) => ({
      type: 'CUSTOMER' as const,
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone ?? null,
      country: c.country ?? null,
    })),
  ];

  return NextResponse.json({ ok: true, recipients });
}
