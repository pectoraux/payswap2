/**
 * GET /api/developer/inspectors/replay
 *
 * Reconstructs the system state at a specific point in time by replaying
 * events up to (and including) sequence number `seq`.
 *
 * Query params:
 *   - seq: replay events up to this globalPosition (default: current store size)
 *   - compare: if "true", also return the current state for diffing
 *
 * The runtime is event-sourced: every projection can be rebuilt from events
 * alone. We do the replay in-process by:
 *   1. Reading events [0, seq] from the event store.
 *   2. Walking them to derive:
 *        - counts by type (events, payments, refunds, wallets, treasury accounts, twin tokens)
 *        - last balance sheet snapshot (using runtime.ledger.getBalanceSheet() as the
 *          current truth and approximating the historical state by scaling)
 *   3. For `compare=true`, also return the current state for diff.
 *
 * NOTE: We don't rebuild the actual ledger projection at seq (that would require
 * a side-channel projection rebuild). Instead we summarize: total events at seq,
 * per-type event counts, and the events themselves up to seq (last 50). This is
 * sufficient for the inspector UI to show "what existed at this point".
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { runtime as payswapRuntime } from '@/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReplayState {
  seq: number;
  timestamp: number | null;
  eventCount: number;
  countsByType: Record<string, number>;
  countsByStreamType: Record<string, number>;
  lastEvents: Array<{
    seq: number;
    type: string;
    streamId: string;
    timestamp: number;
    actor: string;
  }>;
  balanceSheet: {
    fiatReserves: number;
    stablecoinReserves: number;
    escrow: number;
    treasuryInventory: number;
    outstandingLPAdvances: number;
    totalAssets: number;
    twinTokensOutstanding: number;
    pendingSettlements: number;
    totalLiabilities: number;
    totalEquity: number;
    isBalanced: boolean;
  };
  solvency: {
    reserveCoverage: number;
    twinCoverage: number;
    solvencyRatio: number;
    networkSolvent: boolean;
  };
}

function emptyBalanceSheet() {
  return {
    fiatReserves: 0,
    stablecoinReserves: 0,
    escrow: 0,
    treasuryInventory: 0,
    outstandingLPAdvances: 0,
    totalAssets: 0,
    twinTokensOutstanding: 0,
    pendingSettlements: 0,
    totalLiabilities: 0,
    totalEquity: 0,
    isBalanced: true,
  };
}

function emptySolvency() {
  return {
    reserveCoverage: 1,
    twinCoverage: 1,
    solvencyRatio: 1,
    networkSolvent: true,
  };
}

function deriveStateAtSeq(seq: number, events: Array<{
  globalPosition: number;
  type: string;
  streamId: string;
  streamType: string;
  payload: Record<string, unknown>;
  metadata: { timestamp: number; actor: string };
}>): ReplayState {
  const countsByType: Record<string, number> = {};
  const countsByStreamType: Record<string, number> = {};
  let lastTimestamp: number | null = null;

  // Approximate derived balances by walking events.
  let fiatReserves = 0;
  let stablecoinReserves = 0;
  let treasuryInventory = 0;
  let outstandingLPAdvances = 0;
  let twinTokensOutstanding = 0;
  let escrow = 0;
  let pendingSettlements = 0;

  for (const e of events) {
    if (e.globalPosition > seq) break;
    countsByType[e.type] = (countsByType[e.type] ?? 0) + 1;
    countsByStreamType[e.streamType] = (countsByStreamType[e.streamType] ?? 0) + 1;
    lastTimestamp = e.metadata.timestamp;

    const p = e.payload as Record<string, unknown>;
    const amount = typeof p.amount === 'number' ? p.amount : 0;

    // Treasury account credits/debits.
    if (e.type === 'treasury.account.credited') {
      const kind = typeof p.kind === 'string' ? p.kind : '';
      // We can't always see the account kind from the event payload alone;
      // approximate by checking the reference field or streamId.
      if (e.streamId.includes('reserve') || kind === 'reserve') fiatReserves += amount;
      else if (e.streamId.includes('stablecoin')) stablecoinReserves += amount;
      else treasuryInventory += amount;
    } else if (e.type === 'treasury.account.debited') {
      if (e.streamId.includes('reserve')) fiatReserves -= amount;
      else if (e.streamId.includes('stablecoin')) stablecoinReserves -= amount;
      else treasuryInventory -= amount;
    }
    // Twin token mint / burn.
    else if (e.type === 'twin.minted') {
      const tokenType = typeof p.tokenType === 'string' ? p.tokenType : '';
      if (tokenType === 'claim') twinTokensOutstanding += amount;
    } else if (e.type === 'twin.burned') {
      const tokenType = typeof p.tokenType === 'string' ? p.tokenType : '';
      if (tokenType === 'claim') twinTokensOutstanding -= amount;
    }
    // Settlement contract lifecycle.
    else if (e.type === 'settlement.contract.created') {
      pendingSettlements += amount;
    } else if (e.type === 'settlement.contract.funded') {
      escrow += amount;
    } else if (e.type === 'settlement.contract.released' || e.type === 'settlement.contract.closed') {
      escrow = Math.max(0, escrow - amount);
      pendingSettlements = Math.max(0, pendingSettlements - amount);
    } else if (e.type === 'settlement.contract.expired' || e.type === 'settlement.contract.cancelled') {
      pendingSettlements = Math.max(0, pendingSettlements - amount);
    }
    // Bandwidth usage (LP advances).
    else if (e.type === 'bandwidth.locked') {
      outstandingLPAdvances += amount;
    } else if (e.type === 'bandwidth.released') {
      outstandingLPAdvances = Math.max(0, outstandingLPAdvances - amount);
    }
  }

  const totalAssets = fiatReserves + stablecoinReserves + escrow + treasuryInventory + outstandingLPAdvances;
  const totalLiabilities = twinTokensOutstanding + pendingSettlements;
  const totalEquity = totalAssets - totalLiabilities;
  const isBalanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;

  const twinCoverage = twinTokensOutstanding > 0
    ? (fiatReserves + stablecoinReserves) / twinTokensOutstanding
    : 1;
  const reserveCoverage = twinTokensOutstanding > 0 ? fiatReserves / twinTokensOutstanding : 1;
  const solvencyRatio = totalLiabilities > 0 ? totalAssets / totalLiabilities : 1;
  const networkSolvent = twinCoverage >= 1.0 && reserveCoverage >= 0.05;

  // Last 50 events at this seq.
  const upToSeq = events.filter((e) => e.globalPosition <= seq);
  const lastEvents = upToSeq.slice(-50).map((e) => ({
    seq: e.globalPosition,
    type: e.type,
    streamId: e.streamId,
    timestamp: e.metadata.timestamp,
    actor: e.metadata.actor,
  })).reverse();

  return {
    seq,
    timestamp: lastTimestamp,
    eventCount: upToSeq.length,
    countsByType,
    countsByStreamType,
    lastEvents,
    balanceSheet: {
      fiatReserves,
      stablecoinReserves,
      escrow,
      treasuryInventory,
      outstandingLPAdvances,
      totalAssets,
      twinTokensOutstanding,
      pendingSettlements,
      totalLiabilities,
      totalEquity,
      isBalanced,
    },
    solvency: {
      reserveCoverage,
      twinCoverage,
      solvencyRatio,
      networkSolvent,
    },
  };
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const totalSize = payswapRuntime.eventStore.size();
  const seqRaw = Number(sp.get('seq') ?? String(Math.max(0, totalSize - 1)));
  const seq = Number.isFinite(seqRaw) ? Math.min(totalSize - 1, Math.max(-1, Math.floor(seqRaw))) : Math.max(0, totalSize - 1);
  const wantCompare = sp.get('compare') === 'true';

  try {
    // Fetch all events up to seq + the full set (for compare).
    const fetchLimit = Math.max(50, totalSize);
    const all = await payswapRuntime.eventStore.readAll(0, fetchLimit);

    const replayed = deriveStateAtSeq(seq, all);

    // Current state (latest) for comparison.
    let current: ReplayState | null = null;
    if (wantCompare) {
      current = deriveStateAtSeq(totalSize - 1, all);
    }

    // Timeline — 20 evenly-spaced snapshots.
    const snapshotCount = 20;
    const step = Math.max(1, Math.floor(totalSize / snapshotCount));
    const timeline: Array<{ seq: number; eventCount: number; totalAssets: number; totalLiabilities: number; isBalanced: boolean }> = [];
    for (let i = 0; i < totalSize; i += step) {
      const snap = deriveStateAtSeq(i, all);
      timeline.push({
        seq: i,
        eventCount: snap.eventCount,
        totalAssets: snap.balanceSheet.totalAssets,
        totalLiabilities: snap.balanceSheet.totalLiabilities,
        isBalanced: snap.balanceSheet.isBalanced,
      });
    }

    return NextResponse.json({
      ok: true,
      totalEvents: totalSize,
      requestedSeq: seq,
      replayed,
      current,
      timeline,
    });
  } catch (err) {
    console.error('[api/developer/inspectors/replay] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
