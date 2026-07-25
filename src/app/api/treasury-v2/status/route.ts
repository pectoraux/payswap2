import { NextResponse } from 'next/server';
import { treasuryEngine } from '@/protocol/treasury-v2';
import { twinTokenEngine } from '@/protocol/twin-token/engine';
import { stellarChainAdapter } from '@/protocol/chains/stellar/adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let initialized = false;
function ensureInit() {
  if (initialized) return;
  try {
    treasuryEngine.init({
      twinTokenEngine,
      stellarAdapter: stellarChainAdapter as any,
    });
  } catch { /* idempotent */ }
  initialized = true;
}

/** GET /api/treasury-v2/status — production treasury status */
export async function GET() {
  ensureInit();
  try {
    const status = treasuryEngine.status();
    return NextResponse.json({ status, ts: Date.now() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'treasury status failed' }, { status: 500 });
  }
}
