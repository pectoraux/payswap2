/**
 * Payments Runtime Engine — Types. (M-RT-18, recreated for M-RT-19.)
 *
 * The Payments capability was the first migrated end-to-end from direct
 * Prisma reads to runtime projections. The View shape (PaymentView) is the
 * frozen contract — pages consume this exact type.
 */

import type { Environment } from '../../types';

export interface PaymentView {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  corridor: string;
  fee: number;
  netAmount: number;
  createdAt: Date;
  settledAt: Date | null;
  customerName: string | null;
  customerEmail: string | null;
  description: string | null;
}

export interface PaymentRecordedPayload {
  paymentId: string;
  merchantId: string;
  customerId: string | null;
  reference: string | null;
  amount: number;
  currency: string;
  sourceCurrency: string | null;
  destinationCurrency: string | null;
  status: string;
  method: string | null;
  corridor: string | null;
  lpId: string | null;
  fee: number;
  netAmount: number;
  fxRate: number;
  description: string | null;
  createdAt: number;
  settledAt: number | null;
}

export interface PaymentCompletedPayload {
  paymentId: string;
  intentId: string;
  planId: string;
  amount: number;
  from: string;
  to: string;
  lpId: string | null;
  feeBps: number;
}

export interface PaymentFailedPayload {
  paymentId: string;
  intentId: string;
  reason: string;
  failedAt: number;
}

export interface PaymentRefundedPayload {
  paymentId: string;
  refundId: string;
  amount: number;
  refundedAt: number;
}

export type PaymentEventPayload =
  | PaymentRecordedPayload
  | PaymentCompletedPayload
  | PaymentFailedPayload
  | PaymentRefundedPayload;

export function paymentStreamId(env: Environment, paymentId: string): string {
  return `${env}:payment:${paymentId}`;
}

export const PAYMENT_EVENT_PREFIXES = ['payment.'] as const;

export const PAYMENT_EVENT_TYPES = [
  'payment.recorded',
  'payment.completed',
  'payment.failed',
  'payment.refunded',
] as const;

export interface PaymentListOptions {
  take?: number;
  skip?: number;
  status?: string;
}

export interface PrismaPaymentRow {
  id: string;
  merchantId: string;
  customerId: string | null;
  amount: number;
  currency: string;
  sourceCurrency: string | null;
  destinationCurrency: string | null;
  status: string;
  method: string | null;
  corridor: string | null;
  lpId: string | null;
  fee: number;
  netAmount: number;
  fxRate: number;
  reference: string | null;
  description: string | null;
  createdAt: Date;
  settledAt: Date | null;
}
