import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORT_ROLES = new Set(['SUPPORT', 'ADMIN', 'SUPER_ADMIN']);

/** Convert a Prisma model row to a flattened search-result shape. */
interface SearchResult {
  id: string;
  type: 'PAYMENT' | 'PAYOUT' | 'MERCHANT' | 'CUSTOMER';
  label: string;
  subtitle: string;
  status: string;
  amount?: number;
  currency?: string;
  createdAt: Date;
  url: string;
}

/**
 * GET /api/support/search?q=<term>
 *
 * Global support search across payments, payouts, merchants and customers.
 * Matches case-insensitively on IDs, references, names, emails, phone numbers
 * and destinations. Returns up to 25 hits per category, grouped by type.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => SUPPORT_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({
      query: q,
      payments: [],
      payouts: [],
      merchants: [],
      customers: [],
      total: 0,
    });
  }

  // Use contains (case-insensitive on PostgreSQL by default for citext-like
  // comparisons on string columns). We add `mode: 'insensitive'` explicitly
  // to make the intent clear and resilient to future migrations.
  const insensitive = { contains: q, mode: 'insensitive' as const };

  const [payments, payouts, merchants, customers] = await Promise.all([
    db.payment.findMany({
      where: {
        OR: [
          { id: q },
          { reference: insensitive },
          { description: insensitive },
          { txHash: insensitive },
          { metadata: insensitive },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    db.payout.findMany({
      where: {
        OR: [
          { id: q },
          { destination: insensitive },
          { txHash: insensitive },
          { reason: insensitive },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    db.merchant.findMany({
      where: {
        OR: [
          { id: q },
          { name: insensitive },
          { email: insensitive },
          { legalName: insensitive },
          { phone: insensitive },
          { website: insensitive },
          { registrationNumber: insensitive },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    db.customer.findMany({
      where: {
        OR: [
          { id: q },
          { name: insensitive },
          { email: insensitive },
          { phone: insensitive },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ]);

  const paymentResults: SearchResult[] = payments.map((p) => ({
    id: p.id,
    type: 'PAYMENT',
    label: p.reference || p.id,
    subtitle: p.description || '—',
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    createdAt: p.createdAt,
    url: `/dashboard/payments/${p.id}`,
  }));

  const payoutResults: SearchResult[] = payouts.map((p) => ({
    id: p.id,
    type: 'PAYOUT',
    label: p.id,
    subtitle: p.destination || p.method || '—',
    status: p.status,
    amount: p.sourceAmount,
    currency: p.sourceCurrency,
    createdAt: p.createdAt,
    url: `/dashboard/payouts/${p.id}`,
  }));

  const merchantResults: SearchResult[] = merchants.map((m) => ({
    id: m.id,
    type: 'MERCHANT',
    label: m.name,
    subtitle: m.email,
    status: m.status,
    createdAt: m.createdAt,
    url: `/admin/merchants`,
  }));

  const customerResults: SearchResult[] = customers.map((c) => ({
    id: c.id,
    type: 'CUSTOMER',
    label: c.name,
    subtitle: c.email,
    status: 'ACTIVE',
    createdAt: c.createdAt,
    url: `/dashboard/customers/${c.id}`,
  }));

  const total =
    paymentResults.length +
    payoutResults.length +
    merchantResults.length +
    customerResults.length;

  return NextResponse.json({
    query: q,
    payments: paymentResults,
    payouts: payoutResults,
    merchants: merchantResults,
    customers: customerResults,
    total,
  });
}
