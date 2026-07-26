import { NextRequest, NextResponse } from 'next/server';
import { checkpointManager } from '@/protocol/persistence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/persistence/rebuild — rebuild ledger from events (full or fast-forward) */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const method = body.method ?? 'auto';

  let result;
  if (method === 'full') {
    result = await checkpointManager.fullRebuild();
  } else {
    result = await checkpointManager.fastForwardRebuild();
  }

  return NextResponse.json(result);
}

/** GET /api/persistence/rebuild — get rebuild status info */
export async function GET() {
  const status = await checkpointManager.status();
  return NextResponse.json(status);
}
