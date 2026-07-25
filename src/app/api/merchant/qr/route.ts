import { NextRequest, NextResponse } from 'next/server';
import { qrService } from '@/protocol/qr/qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/merchant/qr — generate a QR code for payment */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { type, merchant, wallet, currency, amount, reference, expiresMs, interval } = body;

  if (!merchant || !currency) {
    return NextResponse.json({ error: 'merchant and currency required' }, { status: 400 });
  }

  let qr;
  switch (type) {
    case 'static':
      qr = qrService.generateStatic({ merchant, wallet, currency });
      break;
    case 'dynamic':
      if (!amount) return NextResponse.json({ error: 'amount required for dynamic QR' }, { status: 400 });
      qr = qrService.generateDynamic({ merchant, wallet, currency, amount, reference, expiresMs });
      break;
    case 'invoice':
      if (!amount || !reference) return NextResponse.json({ error: 'amount and reference required for invoice QR' }, { status: 400 });
      qr = qrService.generateInvoice({ merchant, currency, amount, reference, expiresMs });
      break;
    case 'donation':
      qr = qrService.generateDonation({ merchant, currency, reference });
      break;
    case 'subscription':
      if (!amount || !reference || !interval) return NextResponse.json({ error: 'amount, reference, interval required' }, { status: 400 });
      qr = qrService.generateSubscription({ merchant, currency, amount, reference, interval });
      break;
    case 'checkout':
      if (!amount) return NextResponse.json({ error: 'amount required for checkout QR' }, { status: 400 });
      qr = qrService.generateCheckout({ merchant, currency, amount, reference, expiresMs });
      break;
    default:
      return NextResponse.json({ error: `Unknown QR type: ${type}` }, { status: 400 });
  }

  return NextResponse.json({
    qrId: qr.id,
    type: qr.type,
    payload: qr.payload,
    encoded: qr.encoded,
    expiresAt: qr.expiresAt,
    // In production: generate actual QR image
    qrUrl: `https://pay.payswap.com/qr/${qr.id}`,
  });
}

/** GET /api/merchant/qr — list all QR codes */
export async function GET() {
  return NextResponse.json({ codes: qrService.all() });
}
