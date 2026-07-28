/**
 * GET /api/developer/time-machine/replay?seq=N
 *
 * Replays events from seq 0 to seq N (inclusive) and returns the reconstructed
 * state at that point in time:
 *   - Balance sheet (assets, liabilities, solvency) at that point
 *   - Event count by type as of that point
 *   - Key metrics: total payments, total payouts, total volume, unique customers,
 *     unique merchants
 *   - The last 10 events leading up to seq N (context window)
 *
 * Implementation: we create FRESH TreasuryProjection + PaymentProjection
 * instances and call .rebuild(events) on the slice 0..N+1. The live runtime
 * projections are untouched. The runtime's event store is read-only here.
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { runtime } from '@/runtime';
import { TreasuryProjection } from '@/runtime/engines/treasury/projection';
import { PaymentProjection } from '@/runtime/engines/payments/projection';

export const dynamic = 'force-dynamic';

interface ReplayEvent {
  seq: number;
  ts: number;
  type: string;
  streamId: string;
  aggregateId: string;
  payloadSummary: string;
}

interface ReplayResponse {
  ok: true;
  seq: number;
  ts: number;
  totalEventsReplayed: number;
  balanceSheet: {
    fiatReserves: number;
    stablecoinReserves: number;
    treasuryInventory: number;
    totalAssets: number;
    twinTokensOutstanding: number;
    pendingSettlements: number;
    totalLiabilities: number;
    totalEquity: number;
    isBalanced: boolean;
  };
  eventCounts: { type: string; count: number }[];
  metrics: {
    payments: number;
    payouts: number;
    refunds: number;
    walletCredits: number;
    walletDebits: number;
    treasuryAccounts: number;
    totalVolume: number;
    uniqueCustomers: number;
    uniqueMerchants: number;
    uniqueLPs: number;
  };
  lastEvents: ReplayEvent[];
  generatedAt: number;
}

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  const url = new URL(req.url);
  const rawSeq = url.searchParams.get('seq');
  const totalEvents = runtime.eventStore.size();

  if (totalEvents === 0) {
    return NextResponse.json({
      ok: true,
      seq: 0,
      ts: 0,
      totalEventsReplayed: 0,
      balanceSheet: {
        fiatReserves: 0,
        stablecoinReserves: 0,
        treasuryInventory: 0,
        totalAssets: 0,
        twinTokensOutstanding: 0,
        pendingSettlements: 0,
        totalLiabilities: 0,
        totalEquity: 0,
        isBalanced: true,
      },
      eventCounts: [],
      metrics: {
        payments: 0,
        payouts: 0,
        refunds: 0,
        walletCredits: 0,
        walletDebits: 0,
        treasuryAccounts: 0,
        totalVolume: 0,
        uniqueCustomers: 0,
        uniqueMerchants: 0,
        uniqueLPs: 0,
      },
      lastEvents: [],
      generatedAt: Date.now(),
    } satisfies ReplayResponse);
  }

  // Clamp seq to the valid range. The slider may momentarily set seq > lastSeq.
  const requestedSeq = rawSeq === null ? totalEvents - 1 : parseInt(rawSeq, 10);
  const seq = Number.isFinite(requestedSeq)
    ? Math.max(0, Math.min(requestedSeq, totalEvents - 1))
    : totalEvents - 1;

  try {
    // 1. Read all events from 0 to seq (inclusive). Cap at 20k events to bound
    //    memory; reads are paginated to avoid huge single-shot reads.
    const REPLAY_CAP = 20_000;
    const effectiveCount = Math.min(seq + 1, REPLAY_CAP);
    const events: typeof batch = [];
    let cursor = 0;
    let batch: Awaited<ReturnType<typeof runtime.eventStore.readAll>> = [];
    while (cursor < effectiveCount) {
      const take = Math.min(500, effectiveCount - cursor);
      batch = await runtime.eventStore.readAll(cursor, take);
      if (batch.length === 0) break;
      events.push(...batch);
      cursor += batch.length;
    }

    // 2. Build fresh projections from this slice. We do NOT touch the live
    //    runtime.treasury / runtime.payments projections — those reflect the
    //    CURRENT state. Rebuild gives us the point-in-time state.
    const treasuryProj = new TreasuryProjection();
    await treasuryProj.rebuild(events);

    const paymentProj = new PaymentProjection();
    await paymentProj.rebuild(events);

    // 3. Derive the balance sheet from the fresh treasury projection.
    const accounts = treasuryProj.list({ take: 100_000 });
    const reserves = accounts.filter((a) => a.kind === 'reserve');
    const stablecoinAccounts = accounts.filter((a) => a.reference?.includes('stablecoin'));
    const treasuryAccounts = accounts.filter((a) => a.kind === 'treasury');

    const fiatReserves = reserves.reduce((s, a) => s + a.availableBalance, 0);
    const stablecoinReserves = stablecoinAccounts.reduce((s, a) => s + a.availableBalance, 0);
    const treasuryInventory = treasuryAccounts.reduce((s, a) => s + a.availableBalance, 0);

    // Twin tokens: scan events directly for twin token mint/burn events.
    // We don't import the TwinTokenProjection here because it's tied to a
    // global singleton in the runtime. A simple fold is sufficient for the
    // time machine's "snapshot at seq" view.
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

    // 4. Event counts by type (only types we care about for the metrics panel).
    const eventCountsMap = new Map<string, number>();
    for (const ev of events) {
      eventCountsMap.set(ev.type, (eventCountsMap.get(ev.type) ?? 0) + 1);
    }
    const eventCounts = [...eventCountsMap.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    // 5. Key metrics. We count events of each type and extract volume from
    //    payment.recorded payloads. For unique entities (customers, merchants,
    //    LPs), we scan streamIds — payment streams encode merchantId, treasury
    //    streams encode ownerId, LP streams encode lpId.
    const payments = eventCountsMap.get('payment.recorded') ?? 0;
    const payouts = eventCountsMap.get('payout.recorded') ?? eventCountsMap.get('payout.created') ?? 0;
    const refunds = eventCountsMap.get('refund.requested') ?? eventCountsMap.get('refund.recorded') ?? 0;
    const walletCredits = eventCountsMap.get('wallet.credited') ?? 0;
    const walletDebits = eventCountsMap.get('wallet.debited') ?? 0;
    const treasuryAccountCount = treasuryProj.count();

    let totalVolume = 0;
    const customerIds = new Set<string>();
    const merchantIds = new Set<string>();
    const lpIds = new Set<string>();
    for (const ev of events) {
      const p = ev.payload as Record<string, unknown>;
      if (ev.type === 'payment.recorded') {
        totalVolume += Number(p.amount ?? 0);
        if (typeof p.merchantId === 'string') merchantIds.add(p.merchantId);
        if (typeof p.customerId === 'string' && p.customerId) customerIds.add(p.customerId);
      }
      if (ev.type === 'payout.recorded' || ev.type === 'payout.created') {
        totalVolume += Number(p.amount ?? 0);
        if (typeof p.merchantId === 'string') merchantIds.add(p.merchantId);
      }
      if (ev.type === 'lp.registered' && typeof p.lpId === 'string') {
        lpIds.add(p.lpId);
      }
      if (ev.type === 'treasury.account.created') {
        if (typeof p.ownerId === 'string') {
          // Owners are LPs / merchants / treasury entities. We treat them as
          // unique economic actors.
          if (p.kind === 'lp_position' && typeof p.reference === 'string') {
            lpIds.add(p.reference);
          }
        }
      }
    }

    // 6. Last 10 events leading up to seq (context window).
    const lastSlice = events.slice(-10);
    const lastEvents: ReplayEvent[] = lastSlice.map((ev) => {
      const p = ev.payload as Record<string, unknown>;
      let aggregateId = ev.streamId;
      // Try to extract a cleaner aggregate id from the payload.
      for (const key of ['paymentId', 'payoutId', 'refundId', 'walletId', 'accountId', 'lpId', 'transferId', 'offerId']) {
        if (typeof p[key] === 'string') {
          aggregateId = String(p[key]);
          break;
        }
      }
      const payloadSummary = summarizePayload(ev.type, p);
      return {
        seq: ev.globalPosition,
        ts: ev.metadata.timestamp,
        type: ev.type,
        streamId: ev.streamId,
        aggregateId,
        payloadSummary,
      };
    });

    const response: ReplayResponse = {
      ok: true,
      seq,
      ts: events.length > 0 ? events[events.length - 1].metadata.timestamp : 0,
      totalEventsReplayed: events.length,
      balanceSheet: {
        fiatReserves,
        stablecoinReserves,
        treasuryInventory,
        totalAssets,
        twinTokensOutstanding,
        pendingSettlements,
        totalLiabilities,
        totalEquity,
        isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      },
      eventCounts,
      metrics: {
        payments,
        payouts,
        refunds,
        walletCredits,
        walletDebits,
        treasuryAccounts: treasuryAccountCount,
        totalVolume,
        uniqueCustomers: customerIds.size,
        uniqueMerchants: merchantIds.size,
        uniqueLPs: lpIds.size,
      },
      lastEvents,
      generatedAt: Date.now(),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[api/developer/time-machine/replay GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/** Build a one-line human-readable summary of an event payload. */
function summarizePayload(type: string, p: Record<string, unknown>): string {
  const num = (k: string) => (typeof p[k] === 'number' ? p[k] : undefined);
  const str = (k: string) => (typeof p[k] === 'string' ? p[k] : undefined);
  const amount = num('amount');
  const currency = str('currency') ?? str('sourceCurrency');
  switch (type) {
    case 'payment.recorded':
      return `${amount ?? '?'} ${currency ?? ''} via ${str('method') ?? '?'} — ${str('corridor') ?? '?'}`.trim();
    case 'payment.completed':
      return `settled ${amount ?? '?'} ${currency ?? ''} via LP ${str('lpId') ?? '?'}`.trim();
    case 'payment.failed':
      return `failed: ${str('reason') ?? 'unknown'}`;
    case 'payment.refunded':
      return `refunded ${amount ?? '?'}`;
    case 'payout.recorded':
    case 'payout.created':
      return `${amount ?? '?'} ${currency ?? ''} → ${str('destination') ?? '?'}`.trim();
    case 'refund.requested':
    case 'refund.recorded':
      return `${amount ?? '?'} ${currency ?? ''} — ${str('reason') ?? ''}`.trim();
    case 'wallet.credited':
    case 'wallet.debited':
      return `${amount ?? '?'} ${currency ?? ''} — ${str('reason') ?? ''}`.trim();
    case 'treasury.account.created':
      return `${str('kind') ?? '?'} ${currency ?? ''} ${str('reference') ? `(${str('reference')})` : ''}`.trim();
    case 'treasury.account.credited':
    case 'treasury.account.debited':
      return `${amount ?? '?'} ${currency ?? ''} — ${str('reason') ?? ''}`.trim();
    case 'treasury.transfer.executed':
      return `${amount ?? '?'} ${currency ?? ''}`.trim();
    case 'lp.registered':
      return `LP ${str('name') ?? str('lpId') ?? '?'}`;
    case 'lp.corridor.added':
      return `${str('from') ?? '?'} → ${str('to') ?? '?'} cap=${amount ?? '?'}`;
    default:
      // Generic fallback: show the first 3 stringifiable keys.
      const keys = Object.keys(p).slice(0, 3).filter((k) => {
        const v = p[k];
        return typeof v === 'string' || typeof v === 'number';
      });
      return keys.map((k) => `${k}=${p[k]}`).join(' ') || '{}';
  }
}
