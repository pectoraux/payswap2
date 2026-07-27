import { NextRequest, NextResponse } from 'next/server';
import { qrService, type QRType, type QRInterval } from '@/protocol/qr/qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/merchant/qr — list all QR codes. */
export async function GET() {
  const codes = qrService.all();
  return NextResponse.json({ codes, count: codes.length });
}

/** POST /api/merchant/qr — generate QR of any of the 6 supported types. */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const { type, merchant, wallet, currency, amount, reference, expiresMs, interval } = body ?? {};
  if (!type || !merchant || !currency) {
    return NextResponse.json({ error: 'missing_fields', required: ['type', 'merchant', 'currency'] }, { status: 400 });
  }
  try {
    let qr;
    switch (type as QRType) {
      case 'static':
        if (!wallet) return NextResponse.json({ error: 'wallet_required_for_static' }, { status: 400 });
        qr = qrService.generateStatic({ merchant, wallet, currency });
        break;
      case 'dynamic':
        if (!wallet || amount == null) return NextResponse.json({ error: 'wallet_and_amount_required' }, { status: 400 });
        qr = qrService.generateDynamic({ merchant, wallet, currency, amount: Number(amount), reference, expiresMs });
        break;
      case 'invoice':
        if (amount == null || !reference) return NextResponse.json({ error: 'amount_and_reference_required' }, { status: 400 });
        qr = qrService.generateInvoice({ merchant, currency, amount: Number(amount), reference, expiresMs });
        break;
      case 'donation':
        qr = qrService.generateDonation({ merchant, currency, reference });
        break;
      case 'subscription':
        if (amount == null || !reference || !interval) return NextResponse.json({ error: 'amount_reference_interval_required' }, { status: 400 });
        qr = qrService.generateSubscription({ merchant, currency, amount: Number(amount), reference, interval: interval as QRInterval });
        break;
      case 'checkout':
        if (amount == null) return NextResponse.json({ error: 'amount_required' }, { status: 400 });
        qr = qrService.generateCheckout({ merchant, currency, amount: Number(amount), reference, expiresMs });
        break;
      default:
        return NextResponse.json({ error: 'unknown_qr_type', type }, { status: 400 });
    }
    return NextResponse.json({ qr });
  } catch (err) {
    return NextResponse.json({ error: 'qr_failed', message: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
