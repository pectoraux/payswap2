/**
 * Settlement Orchestrator — durable workflow actors for settlement. (M-ECO-32.)
 *
 * Every settlement becomes an event-sourced state machine (Saga pattern)
 * capable of surviving crashes, restarts, retries, network failures, and
 * delayed confirmations.
 *
 *   SettlementActor
 *   ├── WorkflowState (Pending→Funding→Marketplace→WaitingForLP→WaitingRecipient
 *   │                 →Confirmed→Released→Completed, with Expired/Cancelled/Failed/Compensating)
 *   ├── CurrentStep
 *   ├── Timers (LP timeout, recipient timeout, marketplace timeout, settlement timeout, dispute timeout)
 *   ├── RetryPolicy (exponential backoff, max attempts, escalation)
 *   ├── CompensationPlan (every step has compensation — Saga: success→next, failure→compensate)
 *   ├── History (event log per settlement)
 *   └── Metrics (latency, success rate, retry count)
 *
 * Actors are reconstructed entirely from events — no mutable state outside
 * the event log. On crash + restart, the RecoveryManager restores all
 * active actors and they continue exactly where they stopped.
 */

import type { StoredEvent } from '../events';
import { uid } from '../types';

// ─── Workflow States ───────────────────────────────────────────────────────

export type WorkflowState =
  | 'pending' | 'funding' | 'marketplace' | 'waiting_for_lp'
  | 'waiting_recipient' | 'confirmed' | 'released' | 'completed'
  | 'expired' | 'cancelled' | 'failed' | 'compensating';

/** Legal transitions between workflow states. */
export const WORKFLOW_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  pending: ['funding', 'cancelled', 'failed'],
  funding: ['marketplace', 'waiting_for_lp', 'cancelled', 'failed', 'compensating'],
  marketplace: ['waiting_for_lp', 'failed', 'compensating', 'expired'],
  waiting_for_lp: ['waiting_recipient', 'failed', 'compensating', 'expired'],
  waiting_recipient: ['confirmed', 'expired', 'failed', 'compensating'],
  confirmed: ['released', 'failed', 'compensating'],
  released: ['completed'],
  completed: [],
  expired: ['compensating', 'cancelled'],
  cancelled: [],
  failed: ['compensating'],
  compensating: ['cancelled', 'failed'],
};

// ─── Settlement Actor ──────────────────────────────────────────────────────

export interface SettlementActor {
  settlementId: string;
  workflowState: WorkflowState;
  currentStep: string;
  retryCount: number;
  maxRetries: number;
  timers: SettlementTimer[];
  compensationPlan: CompensationStep[];
  history: SettlementHistoryEntry[];
  metrics: SettlementMetrics;
  createdAt: number;
  updatedAt: number;
}

export interface SettlementTimer {
  timerId: string;
  timerType: 'lp_timeout' | 'recipient_timeout' | 'marketplace_timeout' | 'settlement_timeout' | 'dispute_timeout';
  firesAt: number; // epoch ms
  fired: boolean;
  action: string;
}

export interface CompensationStep {
  step: number;
  action: string;
  description: string;
  executed: boolean;
}

export interface SettlementHistoryEntry {
  step: number;
  fromState: WorkflowState;
  toState: WorkflowState;
  event: string;
  timestamp: number;
  durationMs: number;
  success: boolean;
  reason?: string;
}

export interface SettlementMetrics {
  totalDurationMs: number;
  retryCount: number;
  timeoutCount: number;
  compensationCount: number;
  lpId: string | null;
  amount: number;
  currency: string;
  strategy: string;
}

// ─── Settlement Orchestrator Projection ────────────────────────────────────

/**
 * SettlementOrchestrator — manages all settlement actors.
 *
 * Reconstructs actors from events. On crash + restart, all active actors
 * are restored and continue from their last state.
 */
export class SettlementOrchestrator {
  readonly handles = ['settlement.workflow.'] as const;

  private readonly actors = new Map<string, SettlementActor>();
  private lastPosition = -1;
  private eventsAppliedCount = 0;

  async apply(events: StoredEvent[]): Promise<void> {
    for (const ev of events) {
      this.applyOne(ev);
      this.eventsAppliedCount++;
    }
    if (events.length > 0) this.lastPosition = events[events.length - 1].globalPosition;
  }

  async rebuild(allEvents: StoredEvent[]): Promise<void> {
    this.actors.clear();
    this.lastPosition = -1;
    this.eventsAppliedCount = 0;
    for (const ev of allEvents) { this.applyOne(ev); this.eventsAppliedCount++; }
    if (allEvents.length > 0) this.lastPosition = allEvents[allEvents.length - 1].globalPosition;
  }

  checkpoint(): number { return this.lastPosition; }

  /** Get a settlement actor by ID. */
  get(settlementId: string): SettlementActor | null {
    return this.actors.get(settlementId) ?? null;
  }

  /** List all actors. */
  list(): SettlementActor[] {
    return [...this.actors.values()];
  }

  /** List active actors (not completed/cancelled/failed). */
  listActive(): SettlementActor[] {
    return this.list().filter((a) =>
      !['completed', 'cancelled', 'failed'].includes(a.workflowState),
    );
  }

  /** Count actors. */
  count(): number { return this.actors.size; }

  /** Count active actors. */
  countActive(): number { return this.listActive().length; }

  /** Events applied. */
  eventsApplied(): number { return this.eventsAppliedCount; }

  // ── Apply events ────────────────────────────────────────────────────────

  private applyOne(event: StoredEvent): void {
    const ts = event.metadata.timestamp;
    const p = event.payload as Record<string, unknown>;

    switch (event.type) {
      case 'settlement.workflow.created': {
        const settlementId = p.settlementId as string;
        if (this.actors.has(settlementId)) return;
        this.actors.set(settlementId, {
          settlementId,
          workflowState: 'pending',
          currentStep: 'created',
          retryCount: 0,
          maxRetries: p.maxRetries as number ?? 3,
          timers: [],
          compensationPlan: (p.compensationPlan as CompensationStep[]) ?? [],
          history: [{
            step: 0, fromState: 'pending' as WorkflowState, toState: 'pending' as WorkflowState,
            event: 'created', timestamp: ts, durationMs: 0, success: true,
          }],
          metrics: {
            totalDurationMs: 0, retryCount: 0, timeoutCount: 0, compensationCount: 0,
            lpId: null, amount: p.amount as number ?? 0,
            currency: p.currency as string ?? 'USD',
            strategy: p.strategy as string ?? 'UNKNOWN',
          },
          createdAt: ts, updatedAt: ts,
        });
        break;
      }

      case 'settlement.workflow.transitioned': {
        const settlementId = p.settlementId as string;
        const actor = this.actors.get(settlementId);
        if (!actor) return;
        const fromState = p.fromState as WorkflowState;
        const toState = p.toState as WorkflowState;
        const success = p.success as boolean;
        const reason = p.reason as string | undefined;

        actor.workflowState = toState;
        actor.currentStep = p.step as string ?? toState;
        actor.history.push({
          step: actor.history.length,
          fromState, toState,
          event: p.event as string ?? 'transition',
          timestamp: ts,
          durationMs: p.durationMs as number ?? 0,
          success, reason,
        });
        actor.metrics.totalDurationMs = ts - actor.createdAt;
        actor.updatedAt = ts;
        break;
      }

      case 'settlement.workflow.retried': {
        const settlementId = p.settlementId as string;
        const actor = this.actors.get(settlementId);
        if (!actor) return;
        actor.retryCount++;
        actor.metrics.retryCount++;
        actor.updatedAt = ts;
        break;
      }

      case 'settlement.workflow.timer_set': {
        const settlementId = p.settlementId as string;
        const actor = this.actors.get(settlementId);
        if (!actor) return;
        actor.timers.push({
          timerId: p.timerId as string,
          timerType: p.timerType as SettlementTimer['timerType'],
          firesAt: p.firesAt as number,
          fired: false,
          action: p.action as string,
        });
        actor.updatedAt = ts;
        break;
      }

      case 'settlement.workflow.timer_fired': {
        const settlementId = p.settlementId as string;
        const timerId = p.timerId as string;
        const actor = this.actors.get(settlementId);
        if (!actor) return;
        const timer = actor.timers.find((t) => t.timerId === timerId);
        if (timer) { timer.fired = true; actor.metrics.timeoutCount++; }
        actor.updatedAt = ts;
        break;
      }

      case 'settlement.workflow.compensated': {
        const settlementId = p.settlementId as string;
        const actor = this.actors.get(settlementId);
        if (!actor) return;
        const step = p.step as number;
        const comp = actor.compensationPlan.find((c) => c.step === step);
        if (comp) comp.executed = true;
        actor.metrics.compensationCount++;
        actor.updatedAt = ts;
        break;
      }

      case 'settlement.workflow.lp_assigned': {
        const settlementId = p.settlementId as string;
        const actor = this.actors.get(settlementId);
        if (!actor) return;
        actor.metrics.lpId = p.lpId as string;
        actor.updatedAt = ts;
        break;
      }

      default: break;
    }
  }
}

// ─── Timer Engine ──────────────────────────────────────────────────────────

/**
 * TimerEngine — durable timers that survive crashes.
 *
 * Timers are stored as events. On restart, the engine reads all pending
 * timers and fires any that have expired.
 */
export class TimerEngine {
  private readonly timers = new Map<string, { settlementId: string; firesAt: number; action: string }>();

  /** Register a timer. */
  register(timerId: string, settlementId: string, firesAt: number, action: string): void {
    this.timers.set(timerId, { settlementId, firesAt, action });
  }

  /** Check for expired timers. Returns the actions to execute. */
  checkExpired(now: number): { timerId: string; settlementId: string; action: string }[] {
    const expired: { timerId: string; settlementId: string; action: string }[] = [];
    for (const [timerId, timer] of this.timers) {
      if (timer.firesAt <= now) {
        expired.push({ timerId, settlementId: timer.settlementId, action: timer.action });
        this.timers.delete(timerId);
      }
    }
    return expired;
  }

  /** Cancel a timer. */
  cancel(timerId: string): void {
    this.timers.delete(timerId);
  }

  /** Count pending timers. */
  count(): number { return this.timers.size; }
}

// ─── Retry Engine ──────────────────────────────────────────────────────────

/**
 * RetryEngine — automatic retries with exponential backoff.
 */
export class RetryEngine {
  /**
   * Compute the next retry delay (ms) using exponential backoff.
   *
   * @param attempt Current attempt number (0-indexed).
   * @param initialDelayMs Initial delay (default 1000ms).
   * @param maxDelayMs Maximum delay (default 60000ms).
   * @param multiplier Backoff multiplier (default 2).
   */
  static computeDelay(
    attempt: number,
    initialDelayMs: number = 1000,
    maxDelayMs: number = 60_000,
    multiplier: number = 2,
  ): number {
    const delay = initialDelayMs * Math.pow(multiplier, attempt);
    return Math.min(delay, maxDelayMs);
  }

  /**
   * Determine if a retry should be attempted.
   *
   * @param retryCount Current retry count.
   * @param maxRetries Maximum retries.
   * @param error The error that caused the retry.
   */
  static shouldRetry(retryCount: number, maxRetries: number, error: string): boolean {
    if (retryCount >= maxRetries) return false;
    // Don't retry on permanent errors.
    if (error.includes('Invariant violation')) return false;
    if (error.includes('Insufficient funds')) return false;
    return true;
  }

  /**
   * Get the escalation level based on retry count.
   *
   * @returns 'normal' | 'elevated' | 'critical'
   */
  static getEscalationLevel(retryCount: number, maxRetries: number): 'normal' | 'elevated' | 'critical' {
    if (retryCount >= maxRetries - 1) return 'critical';
    if (retryCount >= maxRetries / 2) return 'elevated';
    return 'normal';
  }
}

// ─── Compensation Engine (Saga) ────────────────────────────────────────────

/**
 * CompensationEngine — executes compensation steps when a workflow fails.
 *
 * Saga pattern: each step has a compensation. If a step fails,
 * all previous steps are compensated in reverse order.
 */
export class CompensationEngine {
  /**
   * Build a compensation plan for a settlement strategy.
   *
   * Each step in the settlement has a corresponding compensation.
   */
  static buildCompensationPlan(strategy: string): CompensationStep[] {
    const commonSteps: CompensationStep[] = [
      { step: 1, action: 'unlock_bandwidth', description: 'Release any locked LP bandwidth', executed: false },
      { step: 2, action: 'unlock_stablecoins', description: 'Release locked stablecoin escrow', executed: false },
      { step: 3, action: 'burn_twin_tokens', description: 'Burn any minted twin tokens', executed: false },
      { step: 4, action: 'reverse_reserve_credit', description: 'Reverse any reserve credits', executed: false },
      { step: 5, action: 'close_contract_disputed', description: 'Close settlement contract as disputed', executed: false },
    ];

    // Simpler compensation for local rail.
    if (strategy === 'LOCAL_RAIL') {
      return [
        { step: 1, action: 'burn_twin_tokens', description: 'Burn minted twin tokens', executed: false },
        { step: 2, action: 'reverse_reserve_credit', description: 'Reverse reserve credit', executed: false },
      ];
    }

    return commonSteps;
  }

  /**
   * Get compensation steps to execute (in reverse order, only unexecuted ones).
   */
  static getPendingCompensations(actor: SettlementActor): CompensationStep[] {
    return actor.compensationPlan
      .filter((c) => !c.executed)
      .sort((a, b) => b.step - a.step); // reverse order
  }
}
