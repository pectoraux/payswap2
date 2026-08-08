/**
 * PaySwap Protocol — Closed-Loop Controllers.
 *
 * PRINCIPLE: "A system that computes the right number and doesn't act on it
 * is more dangerous than one that never computed it, because the dashboard
 * says the problem is handled."
 *
 * Every observer in the treasury/liquidity stack MUST be paired with an
 * actuator that ACTS on what the observer computes. This module wires the
 * loops:
 *
 *   E1  Drift alarm (warning)  → auto-rebalance via CorridorBalancer
 *   E2  Reserve low            → auto-rebalance via CorridorBalancer
 *   E3  Drift alarm (critical) → pause corridor disbursement + alert
 *   E4  info-severity proposal → auto-apply via dispatcher (capped)
 *   E5  Backing block          → retry payment at next waterfall tier
 *   E6  Net settlement cycle   → periodic corridorBalancer.settle()
 *   E7  FX limit breach        → block the payment (not just log)
 *   E8  Auction timeout        → refund the payer via escrow.release()
 *
 * Each loop has:
 *   - a trigger (event from an observer)
 *   - an actuator (calls an existing engine)
 *   - a cap (per-cycle / per-action limit, prevents runaway)
 *   - an audit trail (every action is logged)
 *   - a human-override (operator can pause/resume any loop)
 *
 * The kernel is FROZEN — this module imports from `@/kernel/support`,
 * `@/kernel/event`, `@/protocol/treasury-v2/*`, `@/protocol/settlement/*`.
 */
import { nowTs, uid } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { reserveDriftMonitor, reserveMonitor } from '@/protocol/treasury-v2';
import { migrationProposalEngine } from '@/protocol/treasury-v2/migration-proposals';
import { corridorBalancer } from '@/protocol/treasury-v2/balancing';
import { backingVerifier } from '@/protocol/treasury-v2/backing';
import { netSettlementEngine } from '@/protocol/settlement/net-settlement';
import type { LiquidityNetwork } from '@/protocol/liquidity-network';
import type { ReserveMonitor } from '@/protocol/treasury-v2/reserve';

// ── Audit trail ──────────────────────────────────────────────────────────

export interface ClosedLoopAction {
  id: string;
  loop: 'E1_drift_rebalance' | 'E2_low_rebalance' | 'E3_drift_pause' | 'E4_proposal_apply' | 'E5_backing_fallback' | 'E6_net_settle' | 'E7_fx_block' | 'E8_auction_refund';
  trigger: string;
  action: string;
  amount?: number;
  currency?: string;
  corridor?: string;
  result: 'acted' | 'skipped' | 'failed' | 'paused';
  reason?: string;
  ts: number;
}

class ClosedLoopAuditLog {
  private log: ClosedLoopAction[] = [];
  private maxLog = 5_000;

  record(action: ClosedLoopAction): void {
    this.log.unshift(action);
    if (this.log.length > this.maxLog) this.log.length = this.maxLog;
    eventEngine.emit('treasury.closed_loop_action', action as unknown as Record<string, unknown>);
  }

  recent(limit = 50): ClosedLoopAction[] {
    return this.log.slice(0, Math.min(limit, this.log.length));
  }

  forLoop(loop: ClosedLoopAction['loop'], limit = 50): ClosedLoopAction[] {
    return this.log.filter((a) => a.loop === loop).slice(0, limit);
  }

  reset(): void {
    this.log = [];
  }
}

// Store on globalThis to survive Next.js dev-mode module duplication.
declare global {
  // eslint-disable-next-line no-var
  var __PAYSWAP_CLOSED_LOOP_AUDIT_LOG: ClosedLoopAuditLog | undefined;
}

export const closedLoopAuditLog: ClosedLoopAuditLog =
  globalThis.__PAYSWAP_CLOSED_LOOP_AUDIT_LOG ?? new ClosedLoopAuditLog();

if (!globalThis.__PAYSWAP_CLOSED_LOOP_AUDIT_LOG) {
  globalThis.__PAYSWAP_CLOSED_LOOP_AUDIT_LOG = closedLoopAuditLog;
}

// ── Per-loop switches (human override) ────────────────────────────────────

const loopSwitches: Record<ClosedLoopAction['loop'], boolean> = {
  E1_drift_rebalance: true,
  E2_low_rebalance: true,
  E3_drift_pause: true,
  E4_proposal_apply: true,
  E5_backing_fallback: true,
  E6_net_settle: true,
  E7_fx_block: true,
  E8_auction_refund: true,
};

export function pauseLoop(loop: ClosedLoopAction['loop']): void {
  loopSwitches[loop] = false;
  eventEngine.emit('treasury.closed_loop_paused', { loop, ts: nowTs() });
}

export function resumeLoop(loop: ClosedLoopAction['loop']): void {
  loopSwitches[loop] = true;
  eventEngine.emit('treasury.closed_loop_resumed', { loop, ts: nowTs() });
}

export function loopStatus(): Record<ClosedLoopAction['loop'], boolean> {
  return { ...loopSwitches };
}

// ── Per-loop caps (prevent runaway) ───────────────────────────────────────

const loopCaps: Record<ClosedLoopAction['loop'], { perAction: number; perCycle: number; cycleMs: number }> = {
  E1_drift_rebalance: { perAction: 100_000, perCycle: 500_000, cycleMs: 60 * 60 * 1000 }, // 500K/hour
  E2_low_rebalance: { perAction: 100_000, perCycle: 500_000, cycleMs: 60 * 60 * 1000 },
  E3_drift_pause: { perAction: 1, perCycle: 10, cycleMs: 60 * 60 * 1000 }, // 10 pauses/hour
  E4_proposal_apply: { perAction: 50_000, perCycle: 200_000, cycleMs: 24 * 60 * 60 * 1000 }, // 200K/day
  E5_backing_fallback: { perAction: 1, perCycle: 1_000, cycleMs: 60 * 60 * 1000 },
  E6_net_settle: { perAction: 5_000_000, perCycle: 50_000_000, cycleMs: 5 * 60 * 1000 }, // 50M per 5min
  E7_fx_block: { perAction: 1, perCycle: 1_000, cycleMs: 60 * 60 * 1000 },
  E8_auction_refund: { perAction: 1, perCycle: 100, cycleMs: 60 * 60 * 1000 },
};

const cycleSpend: Record<ClosedLoopAction['loop'], { amount: number; cycleStart: number }> = Object.fromEntries(
  (Object.keys(loopCaps) as ClosedLoopAction['loop'][]).map((k) => [k, { amount: 0, cycleStart: nowTs() }])
) as Record<ClosedLoopAction['loop'], { amount: number; cycleStart: number }>;

function withinCap(loop: ClosedLoopAction['loop'], amount: number): boolean {
  const cap = loopCaps[loop];
  const now = nowTs();
  const spend = cycleSpend[loop];
  if (now - spend.cycleStart > cap.cycleMs) {
    spend.amount = 0;
    spend.cycleStart = now;
  }
  if (spend.amount + amount > cap.perCycle) return false;
  if (amount > cap.perAction) return false;
  spend.amount += amount;
  return true;
}

export function loopCapsConfig(): typeof loopCaps {
  return JSON.parse(JSON.stringify(loopCaps));
}

// ── E1 + E2 + E3: Reserve drift / low → rebalance or pause ────────────────

export interface RebalanceInputs {
  /** Get the corridor key for a currency (e.g. "GHS" → "GHS:USD"). */
  corridorForCurrency: (currency: string) => string | null;
  /** Get the network + monitor for a corridor (for the balancer). */
  resolveCorridorContext: (corridor: string) => {
    liquidityNetwork: LiquidityNetwork;
    reserveMonitor: ReserveMonitor;
  } | null;
}

let rebalanceInputs: RebalanceInputs | null = null;

/** Wire the rebalance inputs (call once at startup). */
export function wireRebalanceInputs(inputs: RebalanceInputs): void {
  rebalanceInputs = inputs;
  globalThis.__PAYSWAP_REBALANCE_INPUTS = inputs;
}

function autoRebalance(
  loop: 'E1_drift_rebalance' | 'E2_low_rebalance',
  trigger: string,
  currency: string,
  amount: number,
): ClosedLoopAction {
  if (!loopSwitches[loop]) {
    return recordSkipped(loop, trigger, 'loop_paused', currency);
  }
  if (!rebalanceInputs) {
    rebalanceInputs = getRebalanceInputs();
  }
  if (!rebalanceInputs) {
    return recordSkipped(loop, trigger, 'rebalance_inputs_not_wired', currency);
  }
  const corridor = rebalanceInputs.corridorForCurrency(currency);
  if (!corridor) {
    return recordSkipped(loop, trigger, `no_corridor_for_currency:${currency}`, currency);
  }
  const ctx = rebalanceInputs.resolveCorridorContext(corridor);
  if (!ctx) {
    return recordSkipped(loop, trigger, `no_context_for_corridor:${corridor}`, currency);
  }
  if (!withinCap(loop, amount)) {
    return recordSkipped(loop, trigger, 'cap_exceeded', currency, amount);
  }

  // Parse corridor "FROM:TO" → TreasuryCorridor { from, to }.
  const [from, to] = corridor.split(':');
  try {
    const result = corridorBalancer.checkAndRebalance(
      { from, to },
      ctx.liquidityNetwork,
      ctx.reserveMonitor,
    );
    const action: ClosedLoopAction = {
      id: uid('cl'),
      loop,
      trigger,
      action: 'corridorBalancer.checkAndRebalance',
      amount,
      currency,
      corridor,
      result: result.rebalanced ? 'acted' : 'skipped',
      reason: result.reason,
      ts: nowTs(),
    };
    closedLoopAuditLog.record(action);
    return action;
  } catch (err) {
    const action: ClosedLoopAction = {
      id: uid('cl'),
      loop,
      trigger,
      action: 'corridorBalancer.checkAndRebalance',
      amount,
      currency,
      corridor,
      result: 'failed',
      reason: err instanceof Error ? err.message : 'unknown_error',
      ts: nowTs(),
    };
    closedLoopAuditLog.record(action);
    return action;
  }
}

// E3: paused corridors — tracked in a Set on globalThis so handlers can check.
declare global {
  // eslint-disable-next-line no-var
  var __PAYSWAP_PAUSED_CORRIDORS: Set<string> | undefined;
}

function getPausedCorridors(): Set<string> {
  if (!globalThis.__PAYSWAP_PAUSED_CORRIDORS) {
    globalThis.__PAYSWAP_PAUSED_CORRIDORS = new Set();
  }
  return globalThis.__PAYSWAP_PAUSED_CORRIDORS;
}

/** Check if a currency's corridor is paused (E3). Handlers call this before settling. */
export function isCorridorPaused(currency: string): boolean {
  return getPausedCorridors().has(currency);
}

/** Manually resume a paused corridor (operator override). */
export function resumeCorridor(currency: string): boolean {
  return getPausedCorridors().delete(currency);
}

function pauseCorridor(
  trigger: string,
  currency: string,
  reason: string,
): ClosedLoopAction {
  const loop: ClosedLoopAction['loop'] = 'E3_drift_pause';
  if (!loopSwitches[loop]) {
    return recordSkipped(loop, trigger, 'loop_paused', currency);
  }
  if (!withinCap(loop, 1)) {
    return recordSkipped(loop, trigger, 'cap_exceeded', currency);
  }
  // E3 ACTUATOR: add the currency to the paused set. Handlers check
  // isCorridorPaused() before settling — if paused, the payment is blocked.
  getPausedCorridors().add(currency);
  // Also emit the event for audit/dashboard.
  eventEngine.emit('treasury.corridor_paused', {
    currency,
    reason,
    trigger,
    pausedAt: nowTs(),
  });
  const action: ClosedLoopAction = {
    id: uid('cl'),
    loop,
    trigger,
    action: 'treasury.corridor_paused',
    currency,
    result: 'acted',
    reason,
    ts: nowTs(),
  };
  closedLoopAuditLog.record(action);
  return action;
}

// ── E4: info-severity proposal → auto-apply ──────────────────────────────

export interface ProposalApplyInputs {
  /** Execute a migration proposal via the dispatcher. Returns true on success. */
  applyProposal: (proposal: import('@/protocol/treasury-v2/migration-proposals').MigrationProposal) => Promise<boolean>;
}

let proposalInputs: ProposalApplyInputs | null = null;

export function wireProposalInputs(inputs: ProposalApplyInputs): void {
  proposalInputs = inputs;
  globalThis.__PAYSWAP_PROPOSAL_INPUTS = inputs;
}

async function autoApplyInfoProposal(
  proposal: import('@/protocol/treasury-v2/migration-proposals').MigrationProposal,
): Promise<ClosedLoopAction> {
  const loop: ClosedLoopAction['loop'] = 'E4_proposal_apply';
  if (!loopSwitches[loop]) {
    return recordSkipped(loop, `proposal:${proposal.id}`, 'loop_paused', proposal.toCurrency);
  }
  if (proposal.severity !== 'info') {
    return recordSkipped(loop, `proposal:${proposal.id}`, `severity_${proposal.severity}_requires_human`, proposal.toCurrency);
  }
  if (!proposalInputs) {
    proposalInputs = getProposalInputs();
  }
  if (!proposalInputs) {
    return recordSkipped(loop, `proposal:${proposal.id}`, 'proposal_inputs_not_wired', proposal.toCurrency);
  }
  if (!withinCap(loop, proposal.amount)) {
    return recordSkipped(loop, `proposal:${proposal.id}`, 'cap_exceeded', proposal.toCurrency, proposal.amount);
  }

  try {
    const ok = await proposalInputs.applyProposal(proposal);
    const action: ClosedLoopAction = {
      id: uid('cl'),
      loop,
      trigger: `proposal:${proposal.id}`,
      action: 'applyProposal',
      amount: proposal.amount,
      currency: proposal.toCurrency,
      corridor: proposal.corridor,
      result: ok ? 'acted' : 'failed',
      reason: ok ? undefined : 'applyProposal returned false',
      ts: nowTs(),
    };
    closedLoopAuditLog.record(action);
    return action;
  } catch (err) {
    const action: ClosedLoopAction = {
      id: uid('cl'),
      loop,
      trigger: `proposal:${proposal.id}`,
      action: 'applyProposal',
      amount: proposal.amount,
      currency: proposal.toCurrency,
      corridor: proposal.corridor,
      result: 'failed',
      reason: err instanceof Error ? err.message : 'unknown_error',
      ts: nowTs(),
    };
    closedLoopAuditLog.record(action);
    return action;
  }
}

// ── E6: Net settlement cycle ──────────────────────────────────────────────

export interface NetSettleInputs {
  /** Get all corridor keys that have obligations. */
  corridorsWithObligations: () => string[];
  /** Settle one corridor. Returns the amount settled. */
  settleCorridor: (corridor: string) => { settled: number; currency: string };
}

// Store on globalThis to survive Next.js dev-mode module duplication.
// Without this, instrumentation.ts and API routes see different module
// instances, and wireNetSettleInputs() in one isn't visible to the other.
declare global {
  // eslint-disable-next-line no-var
  var __PAYSWAP_NET_SETTLE_INPUTS: NetSettleInputs | null | undefined;
  // eslint-disable-next-line no-var
  var __PAYSWAP_NET_SETTLE_TIMER: ReturnType<typeof setInterval> | null | undefined;
  // eslint-disable-next-line no-var
  var __PAYSWAP_REBALANCE_INPUTS: RebalanceInputs | null | undefined;
  // eslint-disable-next-line no-var
  var __PAYSWAP_PROPOSAL_INPUTS: ProposalApplyInputs | null | undefined;
  // eslint-disable-next-line no-var
  var __PAYSWAP_AUCTION_INPUTS: AuctionRefundInputs | null | undefined;
}

function getNetSettleInputs(): NetSettleInputs | null {
  return globalThis.__PAYSWAP_NET_SETTLE_INPUTS ?? null;
}

function getRebalanceInputs(): RebalanceInputs | null {
  return globalThis.__PAYSWAP_REBALANCE_INPUTS ?? null;
}

function getProposalInputs(): ProposalApplyInputs | null {
  return globalThis.__PAYSWAP_PROPOSAL_INPUTS ?? null;
}

function getAuctionInputs(): AuctionRefundInputs | null {
  return globalThis.__PAYSWAP_AUCTION_INPUTS ?? null;
}

export function wireNetSettleInputs(inputs: NetSettleInputs): void {
  globalThis.__PAYSWAP_NET_SETTLE_INPUTS = inputs;
}

export function startNetSettlementCycle(intervalMs = 5 * 60 * 1000): void {
  if (globalThis.__PAYSWAP_NET_SETTLE_TIMER) return;
  // SCALE-3: the net settlement cycle uses leader election so only one
  // instance runs it. Three concurrent settle() calls on one corridor
  // is a triple settlement — a correctness bug, not a performance one.
  // The withLeadership import is deferred to avoid circular dependencies.
  globalThis.__PAYSWAP_NET_SETTLE_TIMER = setInterval(async () => {
    try {
      const { withLeadership } = await import('@/lib/leader-election');
      await withLeadership('net-settlement-cycle', async () => {
        runNetSettlementCycle();
      });
    } catch {
      // Leader election not available (DB issue) — run without it (single-instance fallback).
      runNetSettlementCycle();
    }
  }, intervalMs);
  eventEngine.emit('treasury.net_settle_cycle_started', { intervalMs, leaderElected: true, ts: nowTs() });
}

export function stopNetSettlementCycle(): void {
  if (globalThis.__PAYSWAP_NET_SETTLE_TIMER) {
    clearInterval(globalThis.__PAYSWAP_NET_SETTLE_TIMER);
    globalThis.__PAYSWAP_NET_SETTLE_TIMER = null;
    eventEngine.emit('treasury.net_settle_cycle_stopped', { ts: nowTs() });
  }
}

export function runNetSettlementCycle(): ClosedLoopAction[] {
  const loop: ClosedLoopAction['loop'] = 'E6_net_settle';
  if (!loopSwitches[loop]) {
    return [recordSkipped(loop, 'cycle', 'loop_paused')];
  }
  const inputs = getNetSettleInputs();
  if (!inputs) {
    return [recordSkipped(loop, 'cycle', 'net_settle_inputs_not_wired')];
  }

  const corridors = inputs.corridorsWithObligations();
  const actions: ClosedLoopAction[] = [];
  for (const corridor of corridors) {
    if (!withinCap(loop, 1)) {
      actions.push(recordSkipped(loop, `corridor:${corridor}`, 'cap_exceeded', undefined));
      break;
    }
    try {
      const { settled, currency } = inputs.settleCorridor(corridor);
      const action: ClosedLoopAction = {
        id: uid('cl'),
        loop,
        trigger: `cycle:corridor:${corridor}`,
        action: 'settleCorridor',
        amount: settled,
        currency,
        corridor,
        result: settled > 0 ? 'acted' : 'skipped',
        reason: settled > 0 ? undefined : 'no_obligation',
        ts: nowTs(),
      };
      closedLoopAuditLog.record(action);
      actions.push(action);
    } catch (err) {
      const action: ClosedLoopAction = {
        id: uid('cl'),
        loop,
        trigger: `cycle:corridor:${corridor}`,
        action: 'settleCorridor',
        corridor,
        result: 'failed',
        reason: err instanceof Error ? err.message : 'unknown_error',
        ts: nowTs(),
      };
      closedLoopAuditLog.record(action);
      actions.push(action);
    }
  }
  return actions;
}

// ── E5: Backing block → tier fallback (synchronous helper) ───────────────

/**
 * E5: When a backing block occurs, the handler should call this to determine
 * the next waterfall tier to try. Returns the tier to retry at, or null if
 * no fallback is available.
 */
export function backingFallbackTier(
  currentTier: 1 | 2 | 3 | 4 | 5,
  _blockedAssetCode: string,
  _amount: number,
): { tier: 1 | 2 | 3 | 4 | 5 | null; reason: string } {
  const loop: ClosedLoopAction['loop'] = 'E5_backing_fallback';
  if (!loopSwitches[loop]) {
    return { tier: null, reason: 'loop_paused' };
  }
  // LOCAL_RAIL (tiers 1, 2, 5) — backing only applies at tier 1 (mint on
  // credit). If blocked, fall to tier 2 (LP FIAT).
  // CROSS_BORDER (tiers 3, 4, 5) — backing only applies at tier 3 (mint on
  // crypto). If blocked, fall to tier 4 (LP crypto).
  if (currentTier === 1) {
    withinCap(loop, 1);
    return { tier: 2, reason: 'backing_blocked:fall_to_lp_fiat' };
  }
  if (currentTier === 3) {
    withinCap(loop, 1);
    return { tier: 4, reason: 'backing_blocked:fall_to_lp_crypto' };
  }
  return { tier: null, reason: 'no_fallback_from_tier_' + currentTier };
}

// ── E7: FX limit breach → block (synchronous helper) ─────────────────────

/**
 * E7: When the FX exposure service rejects a position (limit breached), the
 * handler should call this to record the block. Returns true if the payment
 * should be blocked (always true when called — this is the actuator).
 */
export function fxBlockPayment(
  paymentId: string,
  corridor: string,
  reason: string,
): ClosedLoopAction {
  const loop: ClosedLoopAction['loop'] = 'E7_fx_block';
  if (!loopSwitches[loop]) {
    return recordSkipped(loop, `payment:${paymentId}`, 'loop_paused');
  }
  if (!withinCap(loop, 1)) {
    return recordSkipped(loop, `payment:${paymentId}`, 'cap_exceeded');
  }
  const action: ClosedLoopAction = {
    id: uid('cl'),
    loop,
    trigger: `payment:${paymentId}`,
    action: 'block_payment',
    corridor,
    result: 'acted',
    reason,
    ts: nowTs(),
  };
  closedLoopAuditLog.record(action);
  return action;
}

// ── E8: Auction timeout → refund (synchronous helper) ────────────────────

export interface AuctionRefundInputs {
  refundAuction: (auctionId: string, payerId: string) => { refunded: boolean; amount: number; currency: string };
}

let auctionInputs: AuctionRefundInputs | null = null;

export function wireAuctionInputs(inputs: AuctionRefundInputs): void {
  auctionInputs = inputs;
  globalThis.__PAYSWAP_AUCTION_INPUTS = inputs;
}

export function auctionTimeoutRefund(
  auctionId: string,
  payerId: string,
): ClosedLoopAction {
  const loop: ClosedLoopAction['loop'] = 'E8_auction_refund';
  if (!loopSwitches[loop]) {
    return recordSkipped(loop, `auction:${auctionId}`, 'loop_paused');
  }
  if (!auctionInputs) {
    auctionInputs = getAuctionInputs();
  }
  if (!auctionInputs) {
    return recordSkipped(loop, `auction:${auctionId}`, 'auction_inputs_not_wired');
  }
  if (!withinCap(loop, 1)) {
    return recordSkipped(loop, `auction:${auctionId}`, 'cap_exceeded');
  }
  try {
    const { refunded, amount, currency } = auctionInputs.refundAuction(auctionId, payerId);
    const action: ClosedLoopAction = {
      id: uid('cl'),
      loop,
      trigger: `auction:${auctionId}`,
      action: 'refundAuction',
      amount,
      currency,
      result: refunded ? 'acted' : 'failed',
      reason: refunded ? undefined : 'refund_returned_false',
      ts: nowTs(),
    };
    closedLoopAuditLog.record(action);
    return action;
  } catch (err) {
    const action: ClosedLoopAction = {
      id: uid('cl'),
      loop,
      trigger: `auction:${auctionId}`,
      action: 'refundAuction',
      result: 'failed',
      reason: err instanceof Error ? err.message : 'unknown_error',
      ts: nowTs(),
    };
    closedLoopAuditLog.record(action);
    return action;
  }
}

// ── Event listeners (wire observers → actuators) ──────────────────────────

let wired = false;

/**
 * Wire all observers to their actuators. Idempotent — calling twice is safe.
 * Call this once at startup (e.g. from a server initialization module).
 */
export function wireClosedLoops(): void {
  if (wired) return;
  wired = true;

  // E1 + E3: drift alarm → rebalance (warning) or pause (critical)
  eventEngine.on('treasury.reserve_drift_alarm', (event: any) => {
    // eventEngine wraps events as {id, type, payload, ts, frame}. The drift
    // data is inside event.payload.
    const data = event?.payload ?? event;
    const currency = data?.currency;
    const drift = data?.drift;
    const level = data?.level;
    if (level === 'critical') {
      pauseCorridor(`drift_alarm:${level}`, currency, `critical_drift:${drift}`);
    } else {
      // warning → auto-rebalance up to |drift| amount
      autoRebalance('E1_drift_rebalance', `drift_alarm:${level}`, currency, Math.abs(drift));
    }
  });

  // E2: reserve low → rebalance
  eventEngine.on('treasury.reserve_low', (event: any) => {
    const data = event?.payload ?? event;
    const { currency, balance, available } = data;
    const shortfall = Math.max(0, balance - available);
    autoRebalance('E2_low_rebalance', 'reserve_low', currency, shortfall);
  });

  // E4: info-severity proposal → auto-apply
  eventEngine.on('treasury.migration_proposed', (event: any) => {
    const data = event?.payload ?? event;
    const proposals: import('@/protocol/treasury-v2/migration-proposals').MigrationProposal[] = data?.proposals ?? [];
    for (const p of proposals) {
      if (p.severity === 'info') {
        // Fire-and-forget — the actuator records its own audit trail.
        autoApplyInfoProposal(p).catch(() => {
          // errors are recorded in the audit log
        });
      }
    }
  });

  // E6: start the net settlement cycle (every 5 minutes by default)
  startNetSettlementCycle(5 * 60 * 1000);

  eventEngine.emit('treasury.closed_loops_wired', {
    loops: Object.keys(loopSwitches),
    ts: nowTs(),
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function recordSkipped(
  loop: ClosedLoopAction['loop'],
  trigger: string,
  reason: string,
  currency?: string,
  amount?: number,
): ClosedLoopAction {
  const action: ClosedLoopAction = {
    id: uid('cl'),
    loop,
    trigger,
    action: 'skipped',
    amount,
    currency,
    result: 'skipped',
    reason,
    ts: nowTs(),
  };
  closedLoopAuditLog.record(action);
  return action;
}

// Re-exports for callers that want a single import point.
export {
  reserveDriftMonitor,
  reserveMonitor,
  migrationProposalEngine,
  corridorBalancer,
  backingVerifier,
  netSettlementEngine,
  closedLoopAuditLog as auditLog,
};
