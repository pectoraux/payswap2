/**
 * RefundBackfillService — bridges legacy Prisma refunds into the runtime
 * RefundProjection. (M-RT-19, Capability Migration: Refunds.)
 *
 * CRITICAL DIFFERENCE FROM M-RT-18: this backfill is built ON TOP of the
 * generic BackfillEngine<T> from the migration framework. It does NOT
 * re-implement batching, progress tracking, or idempotence — it delegates
 * to the framework. This is the proof that the framework is reusable.
 *
 * Compare:
 *   - PaymentBackfillService (M-RT-18): bespoke batching + idempotence logic.
 *   - RefundBackfillService  (M-RT-19): BackfillEngine<PrismaRefundRow>.
 *
 * Future capabilities (payouts, invoices, wallets, etc.) will follow the
 * RefundBackfillService pattern — a thin wrapper over BackfillEngine<T>.
 */

import { db } from '@/lib/db';
import type { RefundsService } from './service';
import type { Environment } from '../../types';
import type { PrismaRefundRow } from './types';
import {
  BackfillEngine,
  type BackfillResult,
} from '../../migration';

/** Inputs to the refund backfill service. */
export interface RefundBackfillInputs {
  refundsService: RefundsService;
  environment: Environment;
  correlationPrefix: string;
}

/**
 * RefundBackfillService — thin wrapper over BackfillEngine<PrismaRefundRow>.
 *
 * The service provides:
 *   - run(): run the backfill (delegates to BackfillEngine.run())
 *   - status(): report Prisma count vs projection count
 *
 * The actual batching, idempotence, and progress tracking live in
 * BackfillEngine<T>. This wrapper only provides the capability-specific
 * recordFn/listFn/countFn.
 */
export class RefundBackfillService {
  private readonly engine: BackfillEngine<PrismaRefundRow>;

  constructor(private inputs: RefundBackfillInputs) {
    // Construct the BackfillEngine with capability-specific functions.
    // This is the ENTIRE capability-specific code — everything else is
    // handled by the framework.
    this.engine = new BackfillEngine<PrismaRefundRow>({
      name: 'refunds',
      countFn: () => db.refund.count({ where: { environment: inputs.environment } }),
      listFn: (skip, take) =>
        db.refund.findMany({
          where: { environment: inputs.environment },
          orderBy: { createdAt: 'asc' },
          skip,
          take,
        }) as Promise<PrismaRefundRow[]>,
      recordFn: (row) =>
        inputs.refundsService.recordRefund({
          refundId: row.id,
          merchantId: row.merchantId,
          paymentId: row.paymentId,
          amount: row.amount,
          type: row.type,
          reason: row.reason,
          status: row.status,
          requestedBy: row.requestedBy,
          environment: inputs.environment,
          createdAt: row.createdAt.getTime(),
          correlationId: `${inputs.correlationPrefix}_${row.id}`,
        }),
    });
  }

  /** Run the backfill (delegates to BackfillEngine.run()). */
  async run(): Promise<BackfillResult> {
    return this.engine.run();
  }

  /** Status report: how many Prisma refunds vs projection refunds. */
  async status(): Promise<{
    prismaCount: number;
    projectionCount: number;
    backfilled: boolean;
  }> {
    const [prismaCount, projectionCount] = await Promise.all([
      db.refund.count({ where: { environment: this.inputs.environment } }),
      this.inputs.refundsService.totalAll(),
    ]);
    return {
      prismaCount,
      projectionCount,
      backfilled: projectionCount >= prismaCount && prismaCount > 0,
    };
  }
}
