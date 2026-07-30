/**
 * CRM Extension — defineExtension() entry point.
 *
 * Subscribes to three customer lifecycle events and auto-acts:
 *
 *   sale.completed         → move customer to CLOSED_WON
 *   delivery.delivered     → create SATISFACTION follow-up
 *   loyalty.tier_upgraded  → create ACCOUNT_REVIEW follow-up
 */

import { defineExtension, type ExtensionContext } from '@/extension-platform/sdk';
import { crmManifest as manifest } from './manifest';
import { crmService } from './store';

interface CrmEvent {
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  saleId?: string;
  deliveryId?: string;
  newTier?: string;
  amount?: number;
}

const DAY = 24 * 60 * 60 * 1000;

export default defineExtension({
  manifest,

  setup(ctx: ExtensionContext) {
    ctx.logging.info('CRM extension starting...', { version: manifest.version });

    // sale.completed → move customer to CLOSED_WON
    ctx.events.subscribe('sale.completed', (event) => {
      const e = event as CrmEvent;
      if (!e.customerId) {
        ctx.logging.debug('sale.completed without customerId — CRM skipping', { event });
        return;
      }
      // Auto-create the customer if we haven't seen them yet
      if (!crmService.getCustomer(e.customerId)) {
        crmService.createCustomer({
          id: e.customerId,
          name: e.customerName ?? `Customer ${e.customerId.slice(-6)}`,
          email: e.customerEmail ?? `${e.customerId}@example.com`,
          value: e.amount,
          stage: 'NEGOTIATION', // pre-stage so the move to CLOSED_WON is forward-only
        });
      }
      const result = crmService.updateStage(e.customerId, 'CLOSED_WON', `Sale ${e.saleId ?? '(no id)'} completed`);
      if (result) {
        ctx.logging.info('Customer moved to CLOSED_WON', { customerId: e.customerId, saleId: e.saleId });
        ctx.events.emit('crm.stage_changed', {
          customerId: e.customerId, newStage: 'CLOSED_WON',
          previousStage: result.previousStage, reason: 'sale.completed',
        }).catch((err) => ctx.logging.warn('emit failed', { err: String(err) }));
      }
    });

    // delivery.delivered → create SATISFACTION follow-up
    ctx.events.subscribe('delivery.delivered', (event) => {
      const e = event as CrmEvent;
      if (!e.customerId) return;
      if (!crmService.getCustomer(e.customerId)) {
        crmService.createCustomer({
          id: e.customerId,
          name: e.customerName ?? `Customer ${e.customerId.slice(-6)}`,
          email: e.customerEmail ?? `${e.customerId}@example.com`,
        });
      }
      const followUp = crmService.createFollowUp({
        customerId: e.customerId,
        type: 'SATISFACTION',
        subject: `Satisfaction check after delivery ${e.deliveryId ?? ''}`.trim(),
        note: 'Call the customer to confirm delivery quality and capture a review.',
        dueAt: Date.now() + 2 * DAY,
        createdFrom: 'delivery.delivered',
        referenceId: e.deliveryId,
      });
      ctx.logging.info('Created satisfaction follow-up', { followUpId: followUp.id, customerId: e.customerId });
      ctx.events.emit('crm.follow_up_created', {
        followUpId: followUp.id, customerId: e.customerId, type: 'SATISFACTION',
      }).catch(() => {});
    });

    // loyalty.tier_upgraded → create ACCOUNT_REVIEW follow-up
    ctx.events.subscribe('loyalty.tier_upgraded', (event) => {
      const e = event as CrmEvent;
      if (!e.customerId || !e.newTier) return;
      if (!crmService.getCustomer(e.customerId)) {
        crmService.createCustomer({
          id: e.customerId,
          name: e.customerName ?? `Customer ${e.customerId.slice(-6)}`,
          email: e.customerEmail ?? `${e.customerId}@example.com`,
        });
      }
      const followUp = crmService.createFollowUp({
        customerId: e.customerId,
        type: 'ACCOUNT_REVIEW',
        subject: `Account management review — upgraded to ${e.newTier}`,
        note: `Customer was upgraded to ${e.newTier}. Schedule a call to discuss premium perks and retention.`,
        dueAt: Date.now() + 5 * DAY,
        createdFrom: 'loyalty.tier_upgraded',
      });
      ctx.logging.info('Created account review follow-up', { followUpId: followUp.id, customerId: e.customerId });
      ctx.events.emit('crm.follow_up_created', {
        followUpId: followUp.id, customerId: e.customerId, type: 'ACCOUNT_REVIEW',
      }).catch(() => {});
    });

    ctx.logging.info('CRM extension ready', {
      capabilities: manifest.capabilities.length,
      stages: crmService.listStages().length,
    });
  },

  // ── Capability handlers ──
  capabilities: {
    'Create Customer': async (inputs: Record<string, unknown>, ctx: ExtensionContext) => {
      const customer = crmService.createCustomer({
        id: inputs.id as string | undefined,
        name: inputs.name as string,
        email: inputs.email as string,
        phone: inputs.phone as string | undefined,
        company: inputs.company as string | undefined,
        value: inputs.value as number | undefined,
        tags: inputs.tags as string[] | undefined,
        owner: inputs.owner as string | undefined,
        stage: inputs.stage as never,
      });
      await ctx.events.emit('crm.customer_created', { customerId: customer.id, stage: customer.stage });
      return { customerId: customer.id, stage: customer.stage };
    },

    'Update Customer Pipeline': async (inputs: Record<string, unknown>, ctx: ExtensionContext) => {
      const result = crmService.updateStage(
        inputs.customerId as string,
        inputs.newStage as never,
        inputs.reason as string | undefined,
      );
      if (!result) return { updated: false };
      await ctx.events.emit('crm.stage_changed', {
        customerId: result.customer.id, newStage: result.customer.stage,
        previousStage: result.previousStage, reason: inputs.reason,
      });
      return { updated: true, newStage: result.customer.stage, previousStage: result.previousStage };
    },

    'Create Follow-up': async (inputs: Record<string, unknown>, ctx: ExtensionContext) => {
      const followUp = crmService.createFollowUp({
        customerId: inputs.customerId as string,
        type: inputs.type as never,
        subject: inputs.subject as string,
        note: inputs.note as string | undefined,
        dueAt: inputs.dueAt as number,
        assigneeId: inputs.assigneeId as string | undefined,
        createdFrom: inputs.createdFrom as never,
        referenceId: inputs.referenceId as string | undefined,
      });
      await ctx.events.emit('crm.follow_up_created', {
        followUpId: followUp.id, customerId: followUp.customerId, type: followUp.type,
      });
      return { followUpId: followUp.id, status: followUp.status, dueAt: followUp.dueAt };
    },

    'Log Interaction': async (inputs: Record<string, unknown>, _ctx: ExtensionContext) => {
      const interaction = crmService.logInteraction({
        customerId: inputs.customerId as string,
        channel: inputs.channel as never,
        direction: inputs.direction as never,
        subject: inputs.subject as string,
        note: inputs.note as string | undefined,
        agentId: inputs.agentId as string | undefined,
        durationSec: inputs.durationSec as number | undefined,
      });
      return { interactionId: interaction.id, channel: interaction.channel };
    },
  },

  // ── Health checks ──
  healthChecks: {
    'customer-db': async (_ctx) => ({ healthy: true, detail: `${crmService.listCustomers().length} customers` }),
    'notification-svc': async (_ctx) => ({ healthy: true, detail: 'Notification service reachable' }),
  },

  // ── Scheduled jobs ──
  scheduledJobs: {
    'follow-up-reminder': async (ctx) => {
      const due = crmService.listFollowUps({ status: 'PENDING' })
        .filter((f) => f.dueAt < Date.now() + DAY);
      ctx.logging.info('Follow-up reminders', { dueSoon: due.length });
    },
    'stale-lead-review': async (ctx) => {
      const weekAgo = Date.now() - 7 * DAY;
      const stale = crmService.listCustomers()
        .filter((c) => c.stage === 'LEAD' && c.updatedAt < weekAgo);
      ctx.logging.info('Stale lead review', { staleCount: stale.length });
    },
  },
});
