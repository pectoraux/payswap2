import { NextRequest, NextResponse } from 'next/server';
import { emergencyFreezeEngine } from '@/protocol/treasury-v2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/treasury/freeze — emergency freeze (admin only in production).
 * Body: { scope: 'account'|'asset'|'corridor'; target; reason; initiatedBy; durationMs? }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { scope, target, reason, initiatedBy, durationMs } = body;
  let result;
  if (scope === 'account') result = emergencyFreezeEngine.freezeAccount(target, reason, initiatedBy, durationMs);
  else if (scope === 'asset') result = emergencyFreezeEngine.freezeAsset(target, reason, initiatedBy);
  else if (scope === 'corridor') result = emergencyFreezeEngine.freezeCorridor({ from: target.from, to: target.to }, reason, initiatedBy);
  else return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
  return NextResponse.json({ freeze: result });
}

/** GET /api/treasury/freeze — list active freezes */
export async function GET() {
  return NextResponse.json({ freezes: emergencyFreezeEngine.active() });
}
