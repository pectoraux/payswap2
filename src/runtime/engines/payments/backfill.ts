/**
 * PaymentBackfillService — bridges legacy Prisma payments into the runtime
 * PaymentProjection. (M-RT-18, recreated for M-RT-19.)
 *
 * NOTE: This is the M-RT-18 bespoke implementation (kept for backward
 * compatibility). The M-RT-19 RefundBackfillService uses the generic
 * BackfillEngine<T> instead. Future capabilities should follow the M-RT-19
 * pattern (use BackfillEngine<T> directly).
 */

import { db } from '@/lib/db';
import type { PaymentsService } from './service';
import type { Environment } from '../../types';
import type { PrismaPaymentRow } from './types';
import type { BackfillResult } from '../../migration';

const BATCH_SIZE = 100;

export interface PaymentBackfillInputs {
  paymentsService: PaymentsService;
  environment: Environment;
  actorId: string;
  correlationPrefix: string;
}

export class PaymentBackfillService {
  constructor(private inputs: PaymentBackfillInputs) {}

  async run(): Promise<BackfillResult> {
    const start = Date.now();
    const errors: string[] = [];
    let newlyImported = 0;
    let alreadyImported = 0;
    let failed = 0;

    const totalInPrisma = await db.payment.count();
    let skip = 0;
    while (skip < totalInPrisma) {
      const batch = await db.payment.findMany({
        orderBy: { createdAt: 'asc' },
        skip,
        take: BATCH_SIZE,
      }) as PrismaPaymentRow[];

      for (const p of batch) {
        try {
          const wasNew = await this.inputs.paymentsService.recordPayment({
            paymentId: p.id,
            merchantId: p.merchantId,
            customerId: p.customerId,
            reference: p.reference,
            amount: p.amount,
            currency: p.currency,
            sourceCurrency: p.sourceCurrency,
            destinationCurrency: p.destinationCurrency,
            status: p.status,
            method: p.method,
            corridor: p.corridor,
            lpId: p.lpId,
            fee: p.fee,
            netAmount: p.netAmount,
            fxRate: p.fxRate,
            description: p.description,
            createdAt: p.createdAt.getTime(),
            settledAt: p.settledAt ? p.settledAt.getTime() : null,
            environment: this.inputs.environment,
            actorId: this.inputs.actorId,
            correlationId: `${this.inputs.correlationPrefix}_${p.id}`,
          });
          if (wasNew) newlyImported++;
          else alreadyImported++;
        } catch (err) {
          failed++;
          if (errors.length < 20) {
            errors.push(`Payment ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      skip += BATCH_SIZE;
    }

    return { totalInPrisma, newlyImported, alreadyImported, failed, errors, durationMs: Date.now() - start };
  }

  async status(): Promise<{ prismaCount: number; projectionCount: number; backfilled: boolean }> {
    const [prismaCount, projectionCount] = await Promise.all([
      db.payment.count(),
      this.inputs.paymentsService.totalAll(),
    ]);
    return { prismaCount, projectionCount, backfilled: projectionCount >= prismaCount && prismaCount > 0 };
  }
}
