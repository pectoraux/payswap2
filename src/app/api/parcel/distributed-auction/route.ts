import { NextRequest, NextResponse } from 'next/server';
import { startDistributedAuction, placeDistributedBid, settleDistributedAuction, isLeader, getLeader, replayAuction, recoverExpiredAuctions } from '@/extensions/parcel-delivery/distributed-auction';
import { money } from '@/money';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const view = sp.get('view') ?? 'leader';
  if (view === 'leader') return NextResponse.json({ leader: getLeader(), isSelf: isLeader() });
  if (view === 'replay') {
    const auctionId = sp.get('auctionId') ?? '';
    return NextResponse.json(replayAuction(auctionId));
  }
  return NextResponse.json({ leader: getLeader() });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const action = body.action as string;
  if (action === 'start') {
    const auction = startDistributedAuction(body.bundleId as string, (body.mode as 'BULK' | 'OPEN') ?? 'BULK', body.deliveryIds as string[], money.usd(body.revenue as number ?? 10), body.durationHours as number ?? 5);
    return NextResponse.json({ auction, message: `✓ Distributed auction started (leader: ${auction.leaderNodeId}, lock: ${auction.lockResource})` }, { status: 201 });
  }
  if (action === 'bid') {
    const bid = placeDistributedBid(body.auctionId as string, body.courierId as string, body.courierName as string, body.amount as number, body.estimatedHours as number, body.rating as number);
    return NextResponse.json({ bid, message: `✓ Bid placed by ${bid.courierName}: ${bid.amount.toString()}` }, { status: 201 });
  }
  if (action === 'settle') {
    const result = settleDistributedAuction(body.auctionId as string);
    return NextResponse.json({ result, message: `✓ Auction settled — winner: ${result.winner || 'none'}, amount: ${result.amount.toString()}` });
  }
  if (action === 'recover') {
    const result = recoverExpiredAuctions(body.auctionIds as string[]);
    return NextResponse.json({ result, message: `✓ Recovered ${result.recovered} auctions (${result.settled} settled, ${result.expired} expired)` });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
