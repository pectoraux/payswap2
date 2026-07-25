import { NextRequest, NextResponse } from 'next/server';
import { webhookEngine } from '@/protocol/webhooks/engine';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/webhooks — register a webhook endpoint */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const body = await req.json();
  const { action } = body;

  if (action === 'register') {
    const endpoint = webhookEngine.register({
      merchantId: body.merchantId,
      url: body.url,
      events: body.events,
      secret: body.secret,
    });
    return NextResponse.json({ endpoint, secret: endpoint.secret });
  }

  if (action === 'emit') {
    const deliveries = await webhookEngine.emit({
      merchantId: body.merchantId,
      eventType: body.eventType,
      payload: body.payload,
    });
    return NextResponse.json({ deliveries });
  }

  if (action === 'list_deliveries') {
    return NextResponse.json({ deliveries: webhookEngine.allDeliveries() });
  }

  if (action === 'verify') {
    const valid = webhookEngine.verifySignature(body.body, body.signature, body.secret);
    return NextResponse.json({ valid });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

/** GET /api/webhooks — list all endpoints */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  return NextResponse.json({ endpoints: webhookEngine.allDeliveries() });
}
