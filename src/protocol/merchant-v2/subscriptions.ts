/**
 * PaySwap Protocol — Merchant Platform (v2) — Subscriptions.
 *
 * Recurring billing service. A merchant creates a `SubscriptionPlan`
 * (amount, currency, interval, optional trial). A customer is then
 * `subscribe`d to a plan, creating a `Subscription` record.
 *
 * Lifecycle:
 *   trialing  → active     (trial ends, first successful charge)
 *   active    → past_due   (a periodic charge fails)
 *   past_due  → active     (a retry charge succeeds)
 *   past_due  → canceled   (3 consecutive failed retries)
 *   active    → paused     (merchant suspends billing)
 *   paused    → active     (merchant resumes billing)
 *   active    → canceled   (immediate cancel, or period-end cancel on next bill)
 *
 * Past-due retry schedule: 3 retries, with 1 / 3 / 7 day delays between
 * attempts. After the 3rd failure the subscription is automatically
 * canceled.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `merchant.subscription_created`   — on `subscribe`.
 *  - `merchant.subscription_canceled`  — on `cancel` (immediate or period-end).
 *  - `merchant.subscription_charged`   — on successful `processBilling`.
 *  - `merchant.subscription_past_due`  — on the first failed charge attempt.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs`, `round`
 * from `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { uid, nowTs, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type {
  Subscription,
  SubscriptionInterval,
  SubscriptionPlan,
  SubscriptionStatus,
} from './types';

/** Interval duration in milliseconds. */
const INTERVAL_MS: Record<SubscriptionInterval, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  yearly: 365 * 24 * 60 * 60 * 1000,
};

/** Past-due retry delays (1, 3, 7 days). */
const RETRY_DELAYS_MS: number[] = [
  1 * 24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
];

/** Maximum number of failed billing attempts before cancellation. */
const MAX_FAILED_ATTEMPTS = 3;

/** Parameters for `createPlan`. */
export interface CreatePlanParams {
  name: string;
  amount: number;
  currency: string;
  interval: SubscriptionInterval;
  trialDays?: number;
  metadata?: Record<string, unknown>;
}

/**
 * SubscriptionService owns subscription plans + active subscriptions and
 * the periodic billing engine.
 */
export class SubscriptionService {
  private plans = new Map<string, SubscriptionPlan>();
  private subscriptions = new Map<string, Subscription>();
  /** Per-subscription last billing-attempt timestamp (for retry scheduling). */
  private lastAttemptAt = new Map<string, number>();
  /** Per-subscription next-allowed-retry timestamp (computed from delays). */
  private nextRetryAt = new Map<string, number>();
  /**
   * Optional charge executor. Returns `true` on success, `false` on failure.
   * Defaults to always-succeed (so the service is usable out-of-the-box in
   * tests / simulation; production wires this to the payment engine).
   */
  private chargeFn: (sub: Subscription, amount: number) => boolean = () => true;

  /** Inject the charge executor (production wires this to the payment engine). */
  setChargeExecutor(fn: (sub: Subscription, amount: number) => boolean): void {
    this.chargeFn = fn;
  }

  // --------------------------------------------------------------- createPlan
  createPlan(merchantId: string, params: CreatePlanParams): SubscriptionPlan {
    const plan: SubscriptionPlan = {
      id: uid('plan'),
      merchantId,
      name: params.name,
      amount: round(params.amount, 6),
      currency: params.currency,
      interval: params.interval,
      trialDays: params.trialDays && params.trialDays > 0 ? params.trialDays : undefined,
      metadata: params.metadata ?? {},
      createdAt: nowTs(),
    };
    this.plans.set(plan.id, plan);
    eventEngine.emit('merchant.subscription_plan_created', {
      merchantId,
      planId: plan.id,
      name: plan.name,
      amount: plan.amount,
      currency: plan.currency,
      interval: plan.interval,
      trialDays: plan.trialDays ?? 0,
    });
    return plan;
  }

  getPlan(planId: string): SubscriptionPlan | undefined {
    return this.plans.get(planId);
  }

  getPlans(merchantId: string): SubscriptionPlan[] {
    return [...this.plans.values()].filter((p) => p.merchantId === merchantId);
  }

  // ------------------------------------------------------------------ subscribe
  subscribe(planId: string, customerId: string): Subscription | null {
    const plan = this.plans.get(planId);
    if (!plan) return null;
    const now = nowTs();
    const hasTrial = typeof plan.trialDays === 'number' && plan.trialDays > 0;
    const intervalMs = INTERVAL_MS[plan.interval];
    const sub: Subscription = {
      id: uid('sub'),
      planId: plan.id,
      merchantId: plan.merchantId,
      customerId,
      status: hasTrial ? 'trialing' : 'active',
      currentPeriodStart: now,
      currentPeriodEnd: hasTrial
        ? now + (plan.trialDays as number) * 24 * 60 * 60 * 1000
        : now + intervalMs,
      failedAttempts: 0,
      createdAt: now,
    };
    if (hasTrial) sub.trialEnd = sub.currentPeriodEnd;
    this.subscriptions.set(sub.id, sub);

    // For non-trial subscriptions, the first charge happens immediately so
    // the customer is paid-up for the first interval.
    if (!hasTrial) {
      const ok = this.chargeFn(sub, plan.amount);
      if (ok) {
        sub.lastPaymentAt = now;
      } else {
        // First charge failed — go straight to past_due.
        sub.status = 'past_due';
        sub.failedAttempts = 1;
        this.recordFailedAttempt(sub.id, now);
        eventEngine.emit('merchant.subscription_past_due', {
          merchantId: sub.merchantId,
          subscriptionId: sub.id,
          customerId: sub.customerId,
          attempt: sub.failedAttempts,
          reason: 'initial_charge_failed',
        });
      }
    }

    eventEngine.emit('merchant.subscription_created', {
      merchantId: sub.merchantId,
      subscriptionId: sub.id,
      planId: plan.id,
      customerId,
      status: sub.status,
      amount: plan.amount,
      currency: plan.currency,
      interval: plan.interval,
      trialEnd: sub.trialEnd,
      currentPeriodEnd: sub.currentPeriodEnd,
    });
    return sub;
  }

  // --------------------------------------------------------------------- cancel
  cancel(subscriptionId: string, immediately: boolean = false): Subscription | null {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return null;
    if (sub.status === 'canceled') return sub;
    const now = nowTs();
    if (immediately) {
      sub.status = 'canceled';
      sub.canceledAt = now;
    } else {
      // Cancel at period end. The actual cancel happens on the next
      // `processBilling` cycle when the period expires.
      sub.cancelAt = true;
    }
    eventEngine.emit('merchant.subscription_canceled', {
      merchantId: sub.merchantId,
      subscriptionId: sub.id,
      customerId: sub.customerId,
      immediately,
      cancelAt: sub.cancelAt,
      canceledAt: sub.canceledAt,
      currentPeriodEnd: sub.currentPeriodEnd,
    });
    return sub;
  }

  // --------------------------------------------------------------------- pause
  pause(subscriptionId: string): Subscription | null {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return null;
    if (sub.status !== 'active' && sub.status !== 'trialing' && sub.status !== 'past_due') {
      return null;
    }
    sub.status = 'paused';
    eventEngine.emit('merchant.subscription_paused', {
      merchantId: sub.merchantId,
      subscriptionId: sub.id,
    });
    return sub;
  }

  // -------------------------------------------------------------------- resume
  resume(subscriptionId: string): Subscription | null {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub || sub.status !== 'paused') return null;
    sub.status = 'active';
    eventEngine.emit('merchant.subscription_resumed', {
      merchantId: sub.merchantId,
      subscriptionId: sub.id,
    });
    return sub;
  }

  // ----------------------------------------------------------- processBilling
  /**
   * Attempt to bill the subscription for the current period. Returns the
   * subscription (mutated) so the caller can inspect the new state.
   *
   * Behaviour by status:
   *  - `trialing`: if `trialEnd` has passed → charge + advance period +
   *    transition to `active`. Otherwise no-op.
   *  - `active`: if `currentPeriodEnd` has passed → if `cancelAt` is set,
   *    transition to `canceled`; otherwise charge + advance period.
   *  - `past_due`: if the retry delay has elapsed → retry the charge. On
   *    success → `active`. On failure → increment `failedAttempts`; after
   *    3 failures → `canceled`.
   *  - `paused` / `canceled`: no-op.
   */
  processBilling(subscriptionId: string): Subscription | null {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return null;
    const plan = this.plans.get(sub.planId);
    if (!plan) return null;
    const now = nowTs();

    if (sub.status === 'paused' || sub.status === 'canceled') {
      return sub;
    }

    // --- trialing → active (trial ended) ---
    if (sub.status === 'trialing') {
      if (typeof sub.trialEnd !== 'undefined' && now < sub.trialEnd) {
        return sub; // still on trial
      }
      const ok = this.chargeFn(sub, plan.amount);
      if (ok) {
        sub.status = 'active';
        sub.lastPaymentAt = now;
        sub.failedAttempts = 0;
        sub.currentPeriodStart = sub.currentPeriodEnd;
        sub.currentPeriodEnd = sub.currentPeriodStart + INTERVAL_MS[plan.interval];
        this.clearRetry(sub.id);
        eventEngine.emit('merchant.subscription_charged', {
          merchantId: sub.merchantId,
          subscriptionId: sub.id,
          customerId: sub.customerId,
          amount: plan.amount,
          currency: plan.currency,
          reason: 'trial_converted',
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
        });
      } else {
        this.handleFailedCharge(sub, plan.amount, now);
      }
      return sub;
    }

    // --- active → next period (or cancel at period end) ---
    if (sub.status === 'active') {
      if (now < sub.currentPeriodEnd) return sub; // period not over yet
      if (sub.cancelAt) {
        sub.status = 'canceled';
        sub.canceledAt = now;
        eventEngine.emit('merchant.subscription_canceled', {
          merchantId: sub.merchantId,
          subscriptionId: sub.id,
          customerId: sub.customerId,
          immediately: false,
          cancelAt: false,
          canceledAt: now,
          currentPeriodEnd: sub.currentPeriodEnd,
        });
        return sub;
      }
      const ok = this.chargeFn(sub, plan.amount);
      if (ok) {
        sub.lastPaymentAt = now;
        sub.failedAttempts = 0;
        sub.currentPeriodStart = sub.currentPeriodEnd;
        sub.currentPeriodEnd = sub.currentPeriodStart + INTERVAL_MS[plan.interval];
        this.clearRetry(sub.id);
        eventEngine.emit('merchant.subscription_charged', {
          merchantId: sub.merchantId,
          subscriptionId: sub.id,
          customerId: sub.customerId,
          amount: plan.amount,
          currency: plan.currency,
          reason: 'period_renewal',
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
        });
      } else {
        this.handleFailedCharge(sub, plan.amount, now);
      }
      return sub;
    }

    // --- past_due → retry (or cancel after MAX_FAILED_ATTEMPTS) ---
    if (sub.status === 'past_due') {
      const nextRetry = this.nextRetryAt.get(sub.id);
      if (typeof nextRetry === 'number' && now < nextRetry) {
        return sub; // too soon to retry
      }
      const ok = this.chargeFn(sub, plan.amount);
      if (ok) {
        sub.status = 'active';
        sub.lastPaymentAt = now;
        sub.failedAttempts = 0;
        sub.currentPeriodStart = sub.currentPeriodEnd;
        sub.currentPeriodEnd = sub.currentPeriodStart + INTERVAL_MS[plan.interval];
        this.clearRetry(sub.id);
        eventEngine.emit('merchant.subscription_charged', {
          merchantId: sub.merchantId,
          subscriptionId: sub.id,
          customerId: sub.customerId,
          amount: plan.amount,
          currency: plan.currency,
          reason: 'past_due_recovered',
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
        });
      } else {
        sub.failedAttempts += 1;
        this.recordFailedAttempt(sub.id, now);
        if (sub.failedAttempts >= MAX_FAILED_ATTEMPTS) {
          sub.status = 'canceled';
          sub.canceledAt = now;
          this.clearRetry(sub.id);
          eventEngine.emit('merchant.subscription_canceled', {
            merchantId: sub.merchantId,
            subscriptionId: sub.id,
            customerId: sub.customerId,
            immediately: false,
            cancelAt: false,
            canceledAt: now,
            reason: 'max_failed_attempts',
            failedAttempts: sub.failedAttempts,
          });
        } else {
          eventEngine.emit('merchant.subscription_past_due', {
            merchantId: sub.merchantId,
            subscriptionId: sub.id,
            customerId: sub.customerId,
            attempt: sub.failedAttempts,
            nextRetryAt: this.nextRetryAt.get(sub.id),
            reason: 'retry_failed',
          });
        }
      }
      return sub;
    }

    return sub;
  }

  // ------------------------------------------------------------------- getters
  getSubscription(id: string): Subscription | undefined {
    return this.subscriptions.get(id);
  }

  getByCustomer(customerId: string): Subscription[] {
    return [...this.subscriptions.values()].filter((s) => s.customerId === customerId);
  }

  getByMerchant(merchantId: string): Subscription[] {
    return [...this.subscriptions.values()].filter((s) => s.merchantId === merchantId);
  }

  getPastDue(merchantId: string): Subscription[] {
    return this.getByMerchant(merchantId).filter((s) => s.status === 'past_due');
  }

  all(): Subscription[] {
    return [...this.subscriptions.values()];
  }

  // --------------------------------------------------------------------- reset
  reset(): void {
    this.plans.clear();
    this.subscriptions.clear();
    this.lastAttemptAt.clear();
    this.nextRetryAt.clear();
  }

  // -------------------------------------------------------------- helpers
  private handleFailedCharge(sub: Subscription, amount: number, now: number): void {
    const wasActive = sub.status === 'active';
    sub.status = 'past_due';
    sub.failedAttempts += 1;
    this.recordFailedAttempt(sub.id, now);
    eventEngine.emit('merchant.subscription_past_due', {
      merchantId: sub.merchantId,
      subscriptionId: sub.id,
      customerId: sub.customerId,
      attempt: sub.failedAttempts,
      nextRetryAt: this.nextRetryAt.get(sub.id),
      reason: wasActive ? 'charge_failed' : 'retry_failed',
      amount,
    });
    if (sub.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      sub.status = 'canceled';
      sub.canceledAt = now;
      this.clearRetry(sub.id);
      eventEngine.emit('merchant.subscription_canceled', {
        merchantId: sub.merchantId,
        subscriptionId: sub.id,
        customerId: sub.customerId,
        immediately: false,
        cancelAt: false,
        canceledAt: now,
        reason: 'max_failed_attempts',
        failedAttempts: sub.failedAttempts,
      });
    }
  }

  private recordFailedAttempt(subId: string, now: number): void {
    this.lastAttemptAt.set(subId, now);
    const sub = this.subscriptions.get(subId);
    const attempt = sub ? sub.failedAttempts : 1;
    // Use the (attempt-1)-th delay (0-indexed) — capped at the last delay.
    const idx = Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1);
    this.nextRetryAt.set(subId, now + RETRY_DELAYS_MS[idx]);
  }

  private clearRetry(subId: string): void {
    this.lastAttemptAt.delete(subId);
    this.nextRetryAt.delete(subId);
  }
}

// Singleton (globalThis pattern — survives Next.js dev module re-instantiation).
const _g = globalThis as unknown as { __PAYSWAP_SUBSCRIPTION_SERVICE?: SubscriptionService };
export const subscriptionService: SubscriptionService =
  _g.__PAYSWAP_SUBSCRIPTION_SERVICE ?? new SubscriptionService();
if (!_g.__PAYSWAP_SUBSCRIPTION_SERVICE) _g.__PAYSWAP_SUBSCRIPTION_SERVICE = subscriptionService;

// Re-export status type for convenience.
export type { SubscriptionStatus } from './types';
