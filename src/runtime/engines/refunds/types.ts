/**
 * Refunds Runtime Engine — Types. (M-RT-19, Capability Migration: Refunds.)
 *
 * Refunds is the SECOND capability migrated end-to-end using the generic
 * migration framework (BackfillEngine<T> + ProjectionVerifier + health).
 *
 * The pattern is identical to payments (M-RT-18):
 *   Events → Projection → Read Model → View
 *
 * Events (5 — one per lifecycle state):
 *   - refund.requested   — backfill / legacy import (creates the row)
 *   - refund.approved    — admin approves the request
 *   - refund.rejected    — admin rejects the request
 *   - refund.executed    — funds returned to customer
 *   - refund.failed      — execution failed
 *
 * The View shape (RefundView) is the frozen contract. Pages consume this
 * type. The backing store can change without touching page code.
 */

import type { Environment } from '../../types';

// ─── View (what pages receive — never Prisma types) ─────────────────────────

/**
 * The canonical RefundView. Frozen contract — pages consume this exact type.
 */
export interface RefundView {
  id: string;
  merchantId: string;
  paymentId: string;
  amount: number;
  /** FULL or PARTIAL. */
  type: string;
  reason: string | null;
  /** PENDING, APPROVED, REJECTED, PROCESSED, FAILED. */
  status: string;
  requestedBy: string;
  approvedBy: string | null;
  /** ISO date — when the refund was processed (null if not yet). */
  processedAt: Date | null;
  /** ISO date — when the refund was requested. */
  createdAt: Date;
  /** Environment (sandbox | live). */
  environment: string;
}

// ─── Event payloads (the only thing that flows through the EventStore) ──────

/** Payload for `refund.requested` — backfill / legacy import event. */
export interface RefundRequestedPayload {
  refundId: string;
  merchantId: string;
  paymentId: string;
  amount: number;
  type: string; // FULL | PARTIAL
  reason: string | null;
  status: string;
  requestedBy: string;
  environment: string;
  createdAt: number; // epoch ms
}

/** Payload for `refund.approved`. */
export interface RefundApprovedPayload {
  refundId: string;
  approvedBy: string;
  approvedAt: number;
}

/** Payload for `refund.rejected`. */
export interface RefundRejectedPayload {
  refundId: string;
  rejectedBy: string;
  reason: string;
  rejectedAt: number;
}

/** Payload for `refund.executed`. */
export interface RefundExecutedPayload {
  refundId: string;
  executedAt: number;
}

/** Payload for `refund.failed`. */
export interface RefundFailedPayload {
  refundId: string;
  reason: string;
  failedAt: number;
}

/** Union of all refund event payloads. */
export type RefundEventPayload =
  | RefundRequestedPayload
  | RefundApprovedPayload
  | RefundRejectedPayload
  | RefundExecutedPayload
  | RefundFailedPayload;

// ─── Stream naming (single source of truth) ────────────────────────────────

/** Build the stream ID for a refund in an environment. */
export function refundStreamId(env: Environment, refundId: string): string {
  return `${env}:refund:${refundId}`;
}

/** The set of event type prefixes this projection handles. */
export const REFUND_EVENT_PREFIXES = ['refund.'] as const;

/** The set of event types this projection handles (exhaustive). */
export const REFUND_EVENT_TYPES = [
  'refund.requested',
  'refund.approved',
  'refund.rejected',
  'refund.executed',
  'refund.failed',
] as const;

// ─── Query options (the façade contract) ───────────────────────────────────

export interface RefundListOptions {
  take?: number;
  skip?: number;
  status?: string;
  paymentId?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** The Prisma Refund row shape (for backfill). */
export interface PrismaRefundRow {
  id: string;
  environment: string;
  merchantId: string;
  paymentId: string;
  amount: number;
  type: string;
  reason: string | null;
  status: string;
  requestedBy: string;
  approvedBy: string | null;
  processedAt: Date | null;
  createdAt: Date;
}
