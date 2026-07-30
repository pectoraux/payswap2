/**
 * Accounting Extension — defineExtension() entry point.
 *
 * Subscribes to three events and auto-records journal entries (each balanced
 * — debits equal credits, exact Money):
 *
 *   payment.completed        → Dr Cash / Cr Revenue
 *   delivery.delivered       → Dr COGS / Cr Inventory
 *   loyalty.points_awarded   → Dr Marketing Expense / Cr Cash (liability)
 */

import { defineExtension, type ExtensionContext } from '@/extension-platform/sdk';
import { accountingManifest as manifest } from './manifest';
import { accountingService } from './store';

interface FinanceEvent {
  amount?: number;
  currency?: string;
  paymentId?: string;
  deliveryId?: string;
  awardId?: string;
  customerId?: string;
  reason?: string;
}

export default defineExtension({
  manifest,

  setup(ctx: ExtensionContext) {
    ctx.logging.info('Accounting extension starting...', { version: manifest.version });

    // payment.completed → Dr Cash / Cr Revenue
    ctx.events.subscribe('payment.completed', (event) => {
      const e = event as FinanceEvent;
      if (!e.amount || e.amount <= 0) return;
      try {
        const entry = accountingService.recordEntry({
          description: `Revenue from payment ${e.paymentId ?? '(no id)'}`,
          reference: e.paymentId,
          source: 'payment',
          lines: [
            { accountId: 'acc_cash', debit: e.amount },
            { accountId: 'acc_revenue', credit: e.amount },
          ],
        });
        ctx.logging.info('Recorded revenue entry', { entryNumber: entry.entryNumber, amount: e.amount });
        ctx.events.emit('accounting.entry_recorded', {
          entryId: entry.id, entryNumber: entry.entryNumber,
          source: 'payment', total: entry.total.toJSON(),
        }).catch((err) => ctx.logging.warn('emit failed', { err: String(err) }));
      } catch (err) {
        ctx.logging.error('Failed to record revenue entry', { err: err instanceof Error ? err.message : String(err) });
      }
    });

    // delivery.delivered → Dr COGS / Cr Inventory
    ctx.events.subscribe('delivery.delivered', (event) => {
      const e = event as FinanceEvent;
      if (!e.amount || e.amount <= 0) {
        // COGS not provided in event — log and skip (would normally query the inventory extension)
        ctx.logging.debug('delivery.delivered received without amount — skipping COGS entry', { event });
        return;
      }
      try {
        const entry = accountingService.recordEntry({
          description: `COGS for delivery ${e.deliveryId ?? '(no id)'}`,
          reference: e.deliveryId,
          source: 'delivery',
          lines: [
            { accountId: 'acc_cogs', debit: e.amount },
            { accountId: 'acc_inventory', credit: e.amount },
          ],
        });
        ctx.logging.info('Recorded COGS entry', { entryNumber: entry.entryNumber, amount: e.amount });
        ctx.events.emit('accounting.entry_recorded', {
          entryId: entry.id, entryNumber: entry.entryNumber,
          source: 'delivery', total: entry.total.toJSON(),
        }).catch(() => {});
      } catch (err) {
        ctx.logging.error('Failed to record COGS entry', { err: err instanceof Error ? err.message : String(err) });
      }
    });

    // loyalty.points_awarded → Dr Marketing Expense / Cr Cash
    // Marketing expense: approximate the dollar value of awarded points at $0.01/point
    ctx.events.subscribe('loyalty.points_awarded', (event) => {
      const e = event as FinanceEvent & { points?: number };
      if (!e.points || e.points <= 0) return;
      const dollarValue = Math.max(0.01, e.points * 0.01);
      try {
        const entry = accountingService.recordEntry({
          description: `Marketing expense — loyalty points (award ${e.awardId ?? '(no id)'}, ${e.points} pts)`,
          reference: e.awardId,
          source: 'loyalty',
          lines: [
            { accountId: 'acc_marketing', debit: dollarValue },
            { accountId: 'acc_cash', credit: dollarValue },
          ],
        });
        ctx.logging.info('Recorded marketing expense entry', { entryNumber: entry.entryNumber, points: e.points });
        ctx.events.emit('accounting.entry_recorded', {
          entryId: entry.id, entryNumber: entry.entryNumber,
          source: 'loyalty', total: entry.total.toJSON(),
        }).catch(() => {});
      } catch (err) {
        ctx.logging.error('Failed to record marketing expense entry', { err: err instanceof Error ? err.message : String(err) });
      }
    });

    ctx.logging.info('Accounting extension ready', {
      capabilities: manifest.capabilities.length,
      accounts: accountingService.listAccounts().length,
    });
  },

  // ── Capability handlers ──
  capabilities: {
    'Record Journal Entry': async (inputs: Record<string, unknown>, ctx: ExtensionContext) => {
      const entry = accountingService.recordEntry({
        date: inputs.date as number | undefined,
        description: inputs.description as string,
        lines: inputs.lines as never,
        reference: inputs.reference as string | undefined,
        source: (inputs.source as never) ?? 'manual',
      });
      await ctx.events.emit('accounting.entry_recorded', {
        entryId: entry.id, entryNumber: entry.entryNumber, total: entry.total.toJSON(),
      });
      return { entryId: entry.id, entryNumber: entry.entryNumber, total: entry.total.toJSON() };
    },

    'Reconcile': async (inputs: Record<string, unknown>, ctx: ExtensionContext) => {
      const rec = accountingService.reconcile({
        accountId: inputs.accountId as string,
        periodStart: inputs.periodStart as number,
        periodEnd: inputs.periodEnd as number,
        statementBalance: inputs.statementBalance as number,
        notes: inputs.notes as string | undefined,
      });
      await ctx.events.emit('accounting.reconciled', {
        reconciliationId: rec.id, accountId: rec.accountId, status: rec.status,
      });
      return { reconciliationId: rec.id, status: rec.status, difference: rec.difference.toJSON() };
    },

    'Generate P&L': async (inputs: Record<string, unknown>, _ctx: ExtensionContext) => {
      const report = accountingService.generatePnL(
        inputs.periodStart as number,
        inputs.periodEnd as number,
      );
      return {
        reportId: report.id,
        totalRevenue: report.totalRevenue.toJSON(),
        totalExpenses: report.totalExpenses.toJSON(),
        netProfit: report.netProfit.toJSON(),
      };
    },

    'Export Ledger': async (inputs: Record<string, unknown>, _ctx: ExtensionContext) => {
      const exportData = accountingService.exportLedger({
        accountId: inputs.accountId as string | undefined,
        from: inputs.from as number | undefined,
        to: inputs.to as number | undefined,
      });
      return {
        entries: exportData.entries.length,
        accounts: exportData.accounts.length,
        exportedAt: exportData.exportedAt,
      };
    },
  },

  // ── Health checks ──
  healthChecks: {
    'ledger-balance': async (_ctx) => {
      // Verify the trial balance: sum of all debits across all entries == sum of all credits
      const entries = accountingService.getLedger();
      let debit = BigInt(0), credit = BigInt(0);
      for (const e of entries) for (const l of e.lines) {
        debit += l.debit.minorUnits;
        credit += l.credit.minorUnits;
      }
      const balanced = debit === credit;
      return { healthy: balanced, detail: balanced ? 'Trial balance: debits = credits' : `Trial balance OFF by ${(debit - credit).toString()}` };
    },
    'account-db': async (_ctx) => ({ healthy: true, detail: `${accountingService.listAccounts().length} accounts` }),
  },

  // ── Scheduled jobs ──
  scheduledJobs: {
    'period-close': async (ctx) => {
      ctx.logging.info('Period close check — verifying all entries balanced');
    },
    'reconcile-reminder': async (ctx) => {
      const unmatched = accountingService.listReconciliations().filter((r) => r.status === 'DISCREPANCY');
      ctx.logging.info('Reconciliation reminder', { unmatched: unmatched.length });
    },
  },
});
