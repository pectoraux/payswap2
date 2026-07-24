import { NextResponse } from 'next/server';
import { treasuryEngine, alertEngine, emergencyFreezeEngine } from '@/protocol/treasury-v2';
import { twinTokenEngine } from '@/protocol/twin-token/engine';
import { stellarChainAdapter } from '@/protocol/chains/stellar/adapter';
import { liquidityNetwork } from '@/protocol/liquidity-network';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let initialized = false;
function ensureInit() {
  if (initialized) return;
  try {
    treasuryEngine.init({
      twinTokenEngine,
      stellarAdapter: stellarChainAdapter as any,
      liquidityNetwork: liquidityNetwork as any,
    });
  } catch { /* idempotent — may already be initialized */ }
  initialized = true;
}

/** GET /api/treasury/status — full treasury snapshot */
export async function GET() {
  ensureInit();
  try {
    const status = treasuryEngine.status();
    const alerts = alertEngine.active();
    const freezes = emergencyFreezeEngine.activeFreezes();
    return NextResponse.json({ status, alerts, freezes, ts: Date.now() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'treasury status failed' }, { status: 500 });
  }
}
