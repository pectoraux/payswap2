/**
 * GET /api/developer/time-machine/diff?fromSeq=A&toSeq=B
 *
 * Compares the system state at two points in time. Returns:
 *   - new events in (A, B]
 *   - balance sheet delta (assets/liabilities/equity at B minus at A)
 *   - new entities created (treasury accounts, LPs)
 *   - volume processed between A and B
 *
 * Implementation: we instantiate two fresh TreasuryProjection instances — one
 * rebuilt from events 0..A, one from events 0..B — and diff their states. The
 * events in the (A, B] window are the "new events" section.
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { runtime } from '@/runtime';
import { TreasuryProjection } from '@/runtime/engines/treasury/projection';

export const dynamic = 'force-dynamic';

interface DiffEvent {
  seq: number;
  ts: number;
  type: string;
  streamId: string;
}

interface DiffResponse {
  ok: true;
  fromSeq: number;
  toSeq: number;
  fromTs: number;
  toTs: number;
  newEventCount: number;
  newEvents: DiffEvent[];
  balanceSheetDelta: {
    fiatReserves: number;
    stablecoinReserves: number;
    treasuryInventory: number;
    totalAssets: number;
    twinTokensOutstanding: number;
    pendingSettlements: number;
    totalLiabilities: number;
    totalEquity: number;
  };
  balanceSheetAtFrom: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
  };
  balanceSheetAtTo: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
  };
  eventCountByType: { type: string; count: number }[];
  newTreasuryAccounts: { accountId: string; kind: string; currency: string; reference: string | null }[];
  newLps: string[];
  volumeBetween: number;
  generatedAt: number;
}

async function readEvents(from: number, toExclusive: number): Promise<Awaited<ReturnType<typeof runtime.eventStore.readAll>>> {
  const out: Awaited<ReturnType<typeof runtime.eventStore.readAll>> = [];
  let cursor = from;
  while (cursor < toExclusive) {
    const take = Math.min(500, toExclusive - cursor);
    const batch = await runtime.eventStore.readAll(cursor, take);
    if (batch.length === 0) break;
    out.push(...batch);
    cursor += batch.length;
  }
  return out;
}

async function buildBalanceSheetUpTo(seqInclusive: number) {
  const events = await readEvents(0, seqInclusive + 1);
  const treasuryProj = new TreasuryProjection();
  await treasuryProj.rebuild(events);

  const accounts = treasuryProj.list({ take: 100_000 });
  const reserves = accounts.filter((a) => a.kind === 'reserve');
  const stablecoinAccounts = accounts.filter((a) => a.reference?.includes('stablecoin'));
  const treasuryAccounts = accounts.filter((a) => a.kind === 'treasury');

  const fiatReserves = reserves.reduce((s, a) => s + a.availableBalance, 0);
  const stablecoinReserves = stablecoinAccounts.reduce((s, a) => s + a.availableBalance, 0);
  const treasuryInventory = treasuryAccounts.reduce((s, a) => s + a.availableBalance, 0);

  let twinTokensOutstanding = 0;
  let pendingSettlements = 0;
  for (const ev of events) {
    const p = ev.payload as Record<string, unknown>;
    if (ev.type === 'twin_token.minted' || ev.type === 'twintoken.minted') {
      twinTokensOutstanding += Number(p.amount ?? 0);
    } else if (ev.type === 'twin_token.burned' || ev.type === 'twintoken.burned') {
      twinTokensOutstanding -= Number(p.amount ?? 0);
    } else if (ev.type === 'settlement_contract.locked' || ev.type === 'settlement.locked') {
      pendingSettlements += Number(p.amount ?? 0);
    } else if (ev.type === 'settlement_contract.released' || ev.type === 'settlement.released' || ev.type === 'settlement_contract.completed') {
      pendingSettlements = Math.max(0, pendingSettlements - Number(p.amount ?? 0));
    }
  }

  const totalAssets = fiatReserves + stablecoinReserves + treasuryInventory;
  const totalLiabilities = twinTokensOutstanding + pendingSettlements;
  const totalEquity = totalAssets - totalLiabilities;

  return {
    events,
    accounts,
    fiatReserves,
    stablecoinReserves,
    treasuryInventory,
    totalAssets,
    twinTokensOutstanding,
    pendingSettlements,
    totalLiabilities,
    totalEquity,
  };
}

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  const url = new URL(req.url);
  const totalEvents = runtime.eventStore.size();
  const fromSeqRaw = url.searchParams.get('fromSeq');
  const toSeqRaw = url.searchParams.get('toSeq');

  const fromSeq = fromSeqRaw === null ? 0 : Math.max(0, Math.min(parseInt(fromSeqRaw, 10) || 0, totalEvents - 1));
  const toSeq = toSeqRaw === null ? Math.max(0, totalEvents - 1) : Math.max(0, Math.min(parseInt(toSeqRaw, 10) || 0, totalEvents - 1));

  if (fromSeq > toSeq) {
    return NextResponse.json(
      { ok: false, error: 'fromSeq must be <= toSeq' },
      { status: 400 },
    );
  }

  try {
    // Empty store → return zero-state diff.
    if (totalEvents === 0) {
      return NextResponse.json({
        ok: true,
        fromSeq: 0,
        toSeq: 0,
        fromTs: 0,
        toTs: 0,
        newEventCount: 0,
        newEvents: [],
        balanceSheetDelta: {
          fiatReserves: 0,
          stablecoinReserves: 0,
          treasuryInventory: 0,
          totalAssets: 0,
          twinTokensOutstanding: 0,
          pendingSettlements: 0,
          totalLiabilities: 0,
          totalEquity: 0,
        },
        balanceSheetAtFrom: { totalAssets: 0, totalLiabilities: 0, totalEquity: 0 },
        balanceSheetAtTo: { totalAssets: 0, totalLiabilities: 0, totalEquity: 0 },
        eventCountByType: [],
        newTreasuryAccounts: [],
        newLps: [],
        volumeBetween: 0,
        generatedAt: Date.now(),
      } satisfies DiffResponse);
    }

    // Build balance sheets at both points.
    const atFrom = await buildBalanceSheetUpTo(fromSeq);
    const atTo = await buildBalanceSheetUpTo(toSeq);

    // New events = events in (fromSeq, toSeq]. Note: fromSeq inclusive in the
    // "before" snapshot, so the new window is fromSeq+1 .. toSeq.
    const newEventsSlice = await readEvents(fromSeq + 1, toSeq + 1);

    // Diff balance sheet.
    const balanceSheetDelta = {
      fiatReserves: atTo.fiatReserves - atFrom.fiatReserves,
      stablecoinReserves: atTo.stablecoinReserves - atFrom.stablecoinReserves,
      treasuryInventory: atTo.treasuryInventory - atFrom.treasuryInventory,
      totalAssets: atTo.totalAssets - atFrom.totalAssets,
      twinTokensOutstanding: atTo.twinTokensOutstanding - atFrom.twinTokensOutstanding,
      pendingSettlements: atTo.pendingSettlements - atFrom.pendingSettlements,
      totalLiabilities: atTo.totalLiabilities - atFrom.totalLiabilities,
      totalEquity: atTo.totalEquity - atFrom.totalEquity,
    };

    // New treasury accounts created in the window.
    const fromAccountIds = new Set(atFrom.accounts.map((a) => a.id));
    const newTreasuryAccounts = atTo.accounts
      .filter((a) => !fromAccountIds.has(a.id))
      .map((a) => ({ accountId: a.id, kind: a.kind, currency: a.currency, reference: a.reference }));

    // New LPs registered in the window.
    const fromLps = new Set<string>();
    for (const ev of atFrom.events) {
      if (ev.type === 'lp.registered') {
        const p = ev.payload as Record<string, unknown>;
        if (typeof p.lpId === 'string') fromLps.add(p.lpId);
      }
    }
    const newLpsSet = new Set<string>();
    for (const ev of newEventsSlice) {
      if (ev.type === 'lp.registered') {
        const p = ev.payload as Record<string, unknown>;
        if (typeof p.lpId === 'string' && !fromLps.has(p.lpId)) newLpsSet.add(p.lpId);
      }
    }

    // Event count by type in the window.
    const eventCountByTypeMap = new Map<string, number>();
    for (const ev of newEventsSlice) {
      eventCountByTypeMap.set(ev.type, (eventCountByTypeMap.get(ev.type) ?? 0) + 1);
    }
    const eventCountByType = [...eventCountByTypeMap.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    // Volume between = sum of payment.recorded + payout amounts in window.
    let volumeBetween = 0;
    for (const ev of newEventsSlice) {
      const p = ev.payload as Record<string, unknown>;
      if (ev.type === 'payment.recorded' || ev.type === 'payout.recorded' || ev.type === 'payout.created') {
        volumeBetween += Number(p.amount ?? 0);
      }
    }

    const newEvents: DiffEvent[] = newEventsSlice
      .slice(-100) // cap the returned event list
      .map((ev) => ({
        seq: ev.globalPosition,
        ts: ev.metadata.timestamp,
        type: ev.type,
        streamId: ev.streamId,
      }));

    const response: DiffResponse = {
      ok: true,
      fromSeq,
      toSeq,
      fromTs: atFrom.events.length > 0 ? atFrom.events[atFrom.events.length - 1].metadata.timestamp : 0,
      toTs: atTo.events.length > 0 ? atTo.events[atTo.events.length - 1].metadata.timestamp : 0,
      newEventCount: newEventsSlice.length,
      newEvents,
      balanceSheetDelta,
      balanceSheetAtFrom: {
        totalAssets: atFrom.totalAssets,
        totalLiabilities: atFrom.totalLiabilities,
        totalEquity: atFrom.totalEquity,
      },
      balanceSheetAtTo: {
        totalAssets: atTo.totalAssets,
        totalLiabilities: atTo.totalLiabilities,
        totalEquity: atTo.totalEquity,
      },
      eventCountByType,
      newTreasuryAccounts,
      newLps: [...newLpsSet],
      volumeBetween,
      generatedAt: Date.now(),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[api/developer/time-machine/diff GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
