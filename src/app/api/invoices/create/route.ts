import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CURRENCIES = new Set(['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR']);

interface InvoiceItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

/**
 * POST /api/invoices/create
 *
 * Create an Invoice for the authenticated merchant. A sequential invoice
 * number is generated per merchant (INV-NNNNN) and the subtotal / tax /
 * total are computed server-side from the supplied line items.
 *
 * Body:
 *   { customerEmail?, items: [{description, quantity, unitPrice}], tax?, currency?, dueDate? }
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

  const customerEmail =
    typeof body.customerEmail === 'string' && body.customerEmail.trim()
      ? body.customerEmail.trim()
      : null;

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: InvoiceItemInput[] = [];
  for (const raw of rawItems) {
    const description =
      typeof raw?.description === 'string' ? raw.description.trim() : '';
    const quantity = Number(raw?.quantity);
    const unitPrice = Number(raw?.unitPrice);
    if (!description) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) continue;
    items.push({ description, quantity, unitPrice });
  }

  if (items.length === 0) {
    return NextResponse.json(
      { error: 'At least one valid line item is required' },
      { status: 400 },
    );
  }

  const taxRate = Number(body.tax);
  const taxPercent = Number.isFinite(taxRate) && taxRate >= 0 ? taxRate : 0;
  const currency =
    typeof body.currency === 'string' && CURRENCIES.has(body.currency)
      ? body.currency
      : 'GHS';

  let dueDate: Date | null = null;
  if (typeof body.dueDate === 'string' && body.dueDate.trim()) {
    const parsed = new Date(body.dueDate);
    if (!Number.isNaN(parsed.getTime())) dueDate = parsed;
  }

  const subtotal = items.reduce(
    (sum, it) => sum + it.quantity * it.unitPrice,
    0,
  );
  const tax = (subtotal * taxPercent) / 100;
  const total = subtotal + tax;

  // Generate a sequential invoice number per merchant: INV-NNNNN.
  const existingCount = await db.invoice.count({ where: { merchantId } });
  const number = `INV-${String(existingCount + 1).padStart(5, '0')}`;

  // Link to a customer record if we already have one for this email.
  let customerId: string | null = null;
  if (customerEmail) {
    const existing = await db.customerRecord.findFirst({
      where: { merchantId, email: customerEmail },
    });
    if (existing) customerId = existing.id;
  }

  const invoice = await db.invoice.create({
    data: {
      merchantId,
      customerId,
      number,
      items: JSON.stringify(items),
      subtotal,
      tax,
      total,
      currency,
      status: 'DRAFT',
      dueDate,
    },
  });

  return NextResponse.json({ invoice }, { status: 201 });
}
