/**
 * Refunds Runtime Engine — barrel. (M-RT-19, Capability Migration: Refunds.)
 *
 * Public surface:
 *   - RefundView — the frozen view shape (façade contract)
 *   - RefundsService — the read model + writer
 *   - RefundProjection — the projection (event → view)
 *   - RefundBackfillService — the Prisma → events bridge (uses BackfillEngine<T>)
 *   - type guards + stream helpers
 */

export * from './types';
export { RefundProjection } from './projection';
export { RefundsService } from './service';
export type { RefundsServiceInputs, RecordRefundInput } from './service';
export { RefundBackfillService } from './backfill';
export type { RefundBackfillInputs } from './backfill';
