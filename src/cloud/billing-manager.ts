/**
 * PaySwap Cloud — Billing Manager. (M-CLOUD-44.)
 *
 * The BillingManager owns each tenant's subscription, plan upgrades /
 * downgrades, cancellation, usage recording, and invoice generation.
 *
 * Pricing model:
 *   - Base monthly fee per plan (Free $0, Starter $99, Growth $499,
 *     Scale $1,999, Enterprise — contact sales).
 *   - Usage-based charges on top: transactions ($0.01 each), API calls
 *     ($0.0001 each), storage ($0.10/GB-month), extensions ($5 each over
 *     the plan's included allowance).
 */

import type {
  CloudSubscription,
  CloudPlan,
  CloudInvoice,
  CloudUsage,
  UsageBasedCharge,
  UsageBasedChargeType,
} from './types';
import { getPlanDefinition, USAGE_RATE_CARD } from './types';
import { store, ids } from './store';
import { cloudAudit } from './audit';

class BillingManager {
  /** Create a subscription for a tenant (called on tenant creation). */
  async createSubscription(
    tenantId: string,
    plan: CloudPlan,
  ): Promise<CloudSubscription> {
    const existing = store.subscriptions.get(tenantId);
    if (existing) return existing;

    const planDef = getPlanDefinition(plan);
    const now = Date.now();
    const month = 30 * 24 * 60 * 60 * 1000;

    const subscription: CloudSubscription = {
      id: ids.subscription(),
      tenantId,
      plan,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: now + month,
      amount: planDef.priceMonthly,
      currency: planDef.currency,
      usageBasedCharges: [],
      createdAt: now,
    };
    store.subscriptions.set(tenantId, subscription);

    await cloudAudit.record({
      tenantId,
      actorId: 'system',
      action: 'subscription.created',
      resourceId: subscription.id,
      resourceType: 'subscription',
      details: { plan, amount: subscription.amount, currency: subscription.currency },
    });

    return subscription;
  }

  /** Get the active subscription for a tenant. */
  async getSubscription(tenantId: string): Promise<CloudSubscription | null> {
    return store.subscriptions.get(tenantId) ?? null;
  }

  /** Upgrade (or downgrade) a tenant's plan. */
  async upgrade(
    tenantId: string,
    newPlan: CloudPlan,
    actorId?: string,
  ): Promise<void> {
    const sub = store.subscriptions.get(tenantId);
    if (!sub) return;
    const previous = sub.plan;
    const planDef = getPlanDefinition(newPlan);
    sub.plan = newPlan;
    sub.amount = planDef.priceMonthly;
    sub.currentPeriodStart = Date.now();
    sub.currentPeriodEnd = Date.now() + 30 * 24 * 60 * 60 * 1000;

    await cloudAudit.record({
      tenantId,
      actorId: actorId ?? 'system',
      action: 'subscription.upgraded',
      resourceId: sub.id,
      resourceType: 'subscription',
      details: { previous, plan: newPlan, amount: sub.amount },
    });
  }

  /** Cancel a subscription. */
  async cancel(tenantId: string, reason: string, actorId?: string): Promise<void> {
    const sub = store.subscriptions.get(tenantId);
    if (!sub) return;
    sub.status = 'canceled';
    sub.canceledAt = Date.now();
    sub.cancelReason = reason;

    await cloudAudit.record({
      tenantId,
      actorId: actorId ?? 'system',
      action: 'subscription.canceled',
      resourceId: sub.id,
      resourceType: 'subscription',
      details: { reason },
    });
  }

  /**
   * Record usage against the tenant's current billing period. This adds (or
   * increments) a UsageBasedCharge row on the subscription.
   */
  async recordUsage(
    tenantId: string,
    type: UsageBasedChargeType,
    quantity: number,
  ): Promise<void> {
    const sub = store.subscriptions.get(tenantId);
    if (!sub) return;
    const rate = USAGE_RATE_CARD[type].rate;
    const existing = sub.usageBasedCharges.find((c) => c.type === type);
    if (existing) {
      existing.quantity += quantity;
      existing.amount = existing.quantity * existing.rate;
    } else {
      const charge: UsageBasedCharge = {
        type,
        quantity,
        rate,
        amount: quantity * rate,
      };
      sub.usageBasedCharges.push(charge);
    }
  }

  /**
   * Generate an invoice for the current billing period. The invoice total is
   * the plan's base amount plus the sum of usage-based charges.
   */
  async generateInvoice(
    tenantId: string,
  ): Promise<{ amount: number; currency: string; lineItems: UsageBasedCharge[] }> {
    const sub = store.subscriptions.get(tenantId);
    if (!sub) {
      return { amount: 0, currency: 'USD', lineItems: [] };
    }
    const usageTotal = sub.usageBasedCharges.reduce((sum, c) => sum + c.amount, 0);
    const total = sub.amount + usageTotal;
    return {
      amount: total,
      currency: sub.currency,
      lineItems: sub.usageBasedCharges.map((c) => ({ ...c })),
    };
  }

  /**
   * Persist an invoice for the current period and reset usage-based charges.
   * Returns the created invoice.
   */
  async finalizeInvoice(tenantId: string): Promise<CloudInvoice | null> {
    const sub = store.subscriptions.get(tenantId);
    if (!sub) return null;
    const { amount, currency, lineItems } = await this.generateInvoice(tenantId);
    const invoice: CloudInvoice = {
      id: ids.invoice(),
      tenantId,
      subscriptionId: sub.id,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      amount,
      currency,
      lineItems,
      status: 'paid',
      createdAt: Date.now(),
    };
    store.invoices.set(invoice.id, invoice);

    // Reset usage-based charges for the next period.
    sub.usageBasedCharges = [];
    sub.currentPeriodStart = Date.now();
    sub.currentPeriodEnd = Date.now() + 30 * 24 * 60 * 60 * 1000;

    await cloudAudit.record({
      tenantId,
      actorId: 'system',
      action: 'invoice.finalized',
      resourceId: invoice.id,
      resourceType: 'invoice',
      details: { amount, currency, lineItems: lineItems.length },
    });

    return invoice;
  }

  /** Get usage history for the past N months (synthesised from current usage). */
  async getUsageHistory(tenantId: string, months: number): Promise<CloudUsage[]> {
    const tenant = store.tenants.get(tenantId);
    if (!tenant) return [];
    const base = tenant.usage;
    const now = Date.now();
    const month = 30 * 24 * 60 * 60 * 1000;
    const history: CloudUsage[] = [];
    for (let i = months - 1; i >= 0; i--) {
      // Synthesize a slight upward ramp toward the current month.
      const factor = 1 - i * 0.12;
      history.push({
        merchants: Math.max(0, Math.round(base.merchants * factor)),
        lps: Math.max(0, Math.round(base.lps * factor)),
        transactionsThisMonth: Math.max(0, Math.round(base.transactionsThisMonth * factor)),
        apiRequestsThisMinute: Math.max(0, Math.round(base.apiRequestsThisMinute * factor)),
        storageUsedGB: Math.max(0, Math.round(base.storageUsedGB * factor * 10) / 10),
        extensionsInstalled: Math.max(0, Math.round(base.extensionsInstalled * factor)),
        lastResetAt: now - i * month,
      });
    }
    return history;
  }

  /** List invoices for a tenant (newest first). */
  async listInvoices(tenantId: string): Promise<CloudInvoice[]> {
    return Array.from(store.invoices.values())
      .filter((i) => i.tenantId === tenantId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}

export const billingManager = new BillingManager();
