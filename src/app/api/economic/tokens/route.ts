import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { economicEngine } from '@/economic';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeToken(t: ReturnType<typeof economicEngine.listTokens>[number]) {
  return { ...t };
}
function serializeBalance(b: ReturnType<typeof economicEngine.balances>[number]) {
  return { ...b, updatedAt: new Date(b.updatedAt).toISOString() };
}
function serializeOp(o: ReturnType<typeof economicEngine.operations>[number]) {
  return { ...o, ts: new Date(o.ts).toISOString() };
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const tokenId = sp.get('tokenId') ?? undefined;
  const view = sp.get('view') ?? 'tokens';
  if (view === 'balances') {
    const balances = economicEngine.balances({ tokenId }).map(serializeBalance);
    return NextResponse.json({ balances, count: balances.length });
  }
  if (view === 'operations') {
    const limit = sp.get('limit') ? Number(sp.get('limit')) : 100;
    const ops = economicEngine.operations({ tokenId, limit }).map(serializeOp);
    return NextResponse.json({ operations: ops, count: ops.length });
  }
  const tokens = economicEngine.listTokens().map(serializeToken);
  return NextResponse.json({ tokens, count: tokens.length });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const userId = (session.user as { id?: string })?.id as string | undefined;
  const actorEmail = (session.user as { email?: string })?.email as string | undefined;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const op = typeof body?.op === 'string' ? body.op : '';
  const tokenId = typeof body?.tokenId === 'string' ? body.tokenId : '';
  const amount = typeof body?.amount === 'number' ? body.amount : 0;
  const to = typeof body?.to === 'string' ? body.to : '';
  const from = typeof body?.from === 'string' ? body.from : '';
  const toType = (typeof body?.toType === 'string' ? body.toType : 'CUSTOMER') as 'EXTENSION' | 'USER' | 'MERCHANT' | 'CUSTOMER' | 'TREASURY' | 'LP';
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 500) : '';

  if (!['mint', 'burn', 'transfer', 'consume'].includes(op)) {
    return NextResponse.json({ error: 'op must be one of: mint, burn, transfer, consume' }, { status: 400 });
  }
  if (!tokenId) return NextResponse.json({ error: 'tokenId is required' }, { status: 400 });
  if (amount <= 0) return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 });

  try {
    let result;
    const toLabel = to;
    if (op === 'mint') {
      if (!to) return NextResponse.json({ error: 'to is required for mint' }, { status: 400 });
      result = economicEngine.mint(tokenId, to, toType, toLabel, amount, reason || `admin mint via API`, undefined, undefined);
    } else if (op === 'burn') {
      if (!from) return NextResponse.json({ error: 'from is required for burn' }, { status: 400 });
      result = economicEngine.burn(tokenId, from, amount, reason || 'admin burn via API');
    } else if (op === 'transfer') {
      if (!from || !to) return NextResponse.json({ error: 'from and to are required for transfer' }, { status: 400 });
      result = economicEngine.transfer(tokenId, from, to, toType, toLabel, amount, reason || 'admin transfer via API');
    } else {
      if (!from) return NextResponse.json({ error: 'from is required for consume' }, { status: 400 });
      result = economicEngine.consume(tokenId, from, amount, reason || 'admin consume via API');
    }

    try {
      await db.auditLog.create({
        data: {
          userId: userId ?? null,
          action: `ECONOMIC.TOKEN_${op.toUpperCase()}`,
          resourceType: 'Token',
          resourceId: tokenId,
          result: 'SUCCESS',
          details: JSON.stringify({ op, tokenId, amount, from: from || null, to: to || null, operationId: result.id, actorEmail: actorEmail ?? null }),
        },
      });
    } catch { /* best-effort */ }

    return NextResponse.json({ operation: serializeOp(result) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Operation failed' }, { status: 400 });
  }
}
