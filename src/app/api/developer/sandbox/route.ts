import { NextRequest, NextResponse } from 'next/server';
import { sandboxService } from '@/protocol/developer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/developer/sandbox — create or reset a sandbox */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;
  if (action === 'create') {
    const sandbox = sandboxService.create(body.merchantId ?? 'demo-merchant');
    return NextResponse.json({ sandbox });
  }
  if (action === 'reset') {
    sandboxService.reset(body.sandboxId);
    return NextResponse.json({ ok: true });
  }
  if (action === 'seed') {
    sandboxService.seedTestData(body.sandboxId);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

/** GET /api/developer/sandbox — list sandboxes */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const merchantId = url.searchParams.get('merchantId') ?? undefined;
  return NextResponse.json({ sandboxes: sandboxService.listSandboxes(merchantId ?? '') });
}
