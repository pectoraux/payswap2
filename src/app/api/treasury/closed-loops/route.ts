import { NextResponse } from 'next/server';
import {
  closedLoopAuditLog,
  loopStatus,
  loopCapsConfig,
  pauseLoop,
  resumeLoop,
  runNetSettlementCycle,
  type ClosedLoopAction,
} from '@/protocol/treasury-v2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/treasury/closed-loops
 *
 * Returns the state of all 8 closed-loop controllers:
 *   - per-loop enabled/disabled status (human override)
 *   - per-loop caps (per-action + per-cycle)
 *   - recent actions (audit trail)
 *
 * This endpoint is the "is the system acting on what it computes?" view.
 * If a loop is `enabled: true` but `recentActions` is empty for an observer
 * that is firing, the loop is broken — the dashboard would otherwise say
 * "loop enabled" while nothing actually happens.
 */
export async function GET() {
  const status = loopStatus();
  const caps = loopCapsConfig();
  const recent = closedLoopAuditLog.recent(50);

  // Per-loop summary: count of acted/skipped/failed in the recent log.
  const loops: ClosedLoopAction['loop'][] = [
    'E1_drift_rebalance',
    'E2_low_rebalance',
    'E3_drift_pause',
    'E4_proposal_apply',
    'E5_backing_fallback',
    'E6_net_settle',
    'E7_fx_block',
    'E8_auction_refund',
  ];
  const perLoop = loops.map((loop) => {
    const actions = closedLoopAuditLog.forLoop(loop, 100);
    const acted = actions.filter((a) => a.result === 'acted').length;
    const skipped = actions.filter((a) => a.result === 'skipped').length;
    const failed = actions.filter((a) => a.result === 'failed').length;
    const lastAction = actions[0];
    return {
      loop,
      enabled: status[loop],
      cap: caps[loop],
      recentCount: actions.length,
      acted,
      skipped,
      failed,
      lastAction: lastAction
        ? {
            action: lastAction.action,
            result: lastAction.result,
            reason: lastAction.reason,
            ts: lastAction.ts,
          }
        : null,
    };
  });

  return NextResponse.json({
    loops: perLoop,
    recentActions: recent,
    summary: {
      totalLoops: loops.length,
      enabledLoops: loops.filter((l) => status[l]).length,
      totalActions: recent.length,
      totalActed: recent.filter((a) => a.result === 'acted').length,
      totalSkipped: recent.filter((a) => a.result === 'skipped').length,
      totalFailed: recent.filter((a) => a.result === 'failed').length,
      ts: Date.now(),
    },
  });
}

/**
 * POST /api/treasury/closed-loops
 *
 * Body:
 *   { action: 'pause', loop: ClosedLoopAction['loop'] }
 *     → human override: pause a loop (it will skip all future triggers)
 *
 *   { action: 'resume', loop: ClosedLoopAction['loop'] }
 *     → human override: resume a paused loop
 *
 *   { action: 'runNetSettleCycle' }
 *     → manually trigger the net settlement cycle (E6) instead of waiting
 *       for the periodic timer. Returns the actions taken.
 *
 *   { action: 'clearAudit' }
 *     → clear the closed-loop audit log (admin only, used for testing)
 */
export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = typeof body?.action === 'string' ? body.action : '';

  if (action === 'pause') {
    const loop = body?.loop as ClosedLoopAction['loop'] | undefined;
    if (!loop) {
      return NextResponse.json({ error: 'loop is required' }, { status: 400 });
    }
    pauseLoop(loop);
    return NextResponse.json({ paused: true, loop });
  }

  if (action === 'resume') {
    const loop = body?.loop as ClosedLoopAction['loop'] | undefined;
    if (!loop) {
      return NextResponse.json({ error: 'loop is required' }, { status: 400 });
    }
    resumeLoop(loop);
    return NextResponse.json({ resumed: true, loop });
  }

  if (action === 'runNetSettleCycle') {
    const actions = runNetSettlementCycle();
    return NextResponse.json({
      ran: true,
      actionsTaken: actions.length,
      actions,
      note: 'Net settlement cycle executed manually. The periodic timer (every 5 minutes) is unaffected.',
    });
  }

  if (action === 'clearAudit') {
    closedLoopAuditLog.reset();
    return NextResponse.json({ cleared: true });
  }

  return NextResponse.json({ error: `Unknown action: ${action || '(none)'}` }, { status: 400 });
}
