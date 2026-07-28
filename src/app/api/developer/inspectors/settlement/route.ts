/**
 * GET /api/developer/inspectors/settlement
 *
 * Reads from payswapRuntime.settlementOrchestrator (the durable workflow actor
 * projection) and payswapRuntime.settlementContracts (the settlement contract
 * lifecycle projection).
 *
 * Returns:
 *   - actors: all settlement workflow actors (active + completed)
 *   - contracts: all settlement contracts (from payswapRuntime.settlementContracts)
 *   - bandwidth: bandwidth positions per LP (from payswapRuntime.bandwidth)
 *   - stats: aggregate counts
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { runtime as payswapRuntime } from '@/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SettlementActorView {
  settlementId: string;
  workflowState: string;
  currentStep: string;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
  lpId: string | null;
  amount: number;
  currency: string;
  strategy: string;
  totalDurationMs: number;
  timeoutCount: number;
  compensationCount: number;
  timers: Array<{
    timerId: string;
    timerType: string;
    firesAt: number;
    fired: boolean;
    action: string;
  }>;
  compensationPlan: Array<{
    step: number;
    action: string;
    description: string;
    executed: boolean;
  }>;
  history: Array<{
    step: number;
    fromState: string;
    toState: string;
    event: string;
    timestamp: number;
    durationMs: number;
    success: boolean;
    reason?: string;
  }>;
}

interface SettlementContractView {
  contractId: string;
  fromCountry: string;
  toCountry: string;
  amount: number;
  currency: string;
  lpId: string | null;
  stablecoinAmount: number;
  stablecoinCurrency: string;
  status: string;
  escrowLocked: boolean;
  createdAt: number;
  fundedAt: number | null;
  claimedAt: number | null;
  confirmedAt: number | null;
  releasedAt: number | null;
  closedAt: number | null;
  expiresAt: number;
  disputeId: string | null;
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    const actors = payswapRuntime.settlementOrchestrator.list();
    const contracts = payswapRuntime.settlementContracts.list();
    const bandwidth = payswapRuntime.bandwidth.list();

    const actorViews: SettlementActorView[] = actors.map((a) => ({
      settlementId: a.settlementId,
      workflowState: a.workflowState,
      currentStep: a.currentStep,
      retryCount: a.retryCount,
      maxRetries: a.maxRetries,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      lpId: a.metrics.lpId,
      amount: a.metrics.amount,
      currency: a.metrics.currency,
      strategy: a.metrics.strategy,
      totalDurationMs: a.metrics.totalDurationMs,
      timeoutCount: a.metrics.timeoutCount,
      compensationCount: a.metrics.compensationCount,
      timers: a.timers.map((t) => ({
        timerId: t.timerId,
        timerType: t.timerType,
        firesAt: t.firesAt,
        fired: t.fired,
        action: t.action,
      })),
      compensationPlan: a.compensationPlan.map((c) => ({
        step: c.step,
        action: c.action,
        description: c.description,
        executed: c.executed,
      })),
      history: a.history.map((h) => ({
        step: h.step,
        fromState: h.fromState,
        toState: h.toState,
        event: h.event,
        timestamp: h.timestamp,
        durationMs: h.durationMs,
        success: h.success,
        reason: h.reason,
      })),
    }));

    const contractViews: SettlementContractView[] = contracts.map((c) => ({
      contractId: c.contractId,
      fromCountry: c.fromCountry,
      toCountry: c.toCountry,
      amount: c.amount,
      currency: c.currency,
      lpId: c.lpId,
      stablecoinAmount: c.stablecoinAmount,
      stablecoinCurrency: c.stablecoinCurrency,
      status: c.status,
      escrowLocked: c.escrowLocked,
      createdAt: c.createdAt,
      fundedAt: c.fundedAt,
      claimedAt: c.claimedAt,
      confirmedAt: c.confirmedAt,
      releasedAt: c.releasedAt,
      closedAt: c.closedAt,
      expiresAt: c.expiresAt,
      disputeId: c.disputeId,
    }));

    // Stats by status.
    const actorStatusCounts: Record<string, number> = {};
    for (const a of actors) {
      actorStatusCounts[a.workflowState] = (actorStatusCounts[a.workflowState] ?? 0) + 1;
    }
    const contractStatusCounts: Record<string, number> = {};
    for (const c of contracts) {
      contractStatusCounts[c.status] = (contractStatusCounts[c.status] ?? 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      actors: actorViews,
      contracts: contractViews,
      bandwidthPositions: bandwidth.map((b) => ({
        owner: b.owner,
        country: b.country,
        assetType: b.assetType,
        capacity: b.capacity,
        reserved: b.reserved,
        used: b.used,
        available: b.available,
        escrow: b.escrow,
        bond: b.bond,
        status: b.status,
        participationMode: b.participationMode,
      })),
      stats: {
        totalActors: actors.length,
        activeActors: actors.filter((a) => !['completed', 'cancelled', 'failed'].includes(a.workflowState)).length,
        totalContracts: contracts.length,
        activeContracts: contracts.filter((c) => !['closed', 'expired', 'disputed'].includes(c.status)).length,
        bandwidthPositions: bandwidth.length,
        actorStatusCounts,
        contractStatusCounts,
      },
    });
  } catch (err) {
    console.error('[api/developer/inspectors/settlement] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
