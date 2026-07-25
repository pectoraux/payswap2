/**
 * PaySwap Protocol — Payment Service.
 *
 * Manages the payment entity lifecycle. Does NOT execute — only manages state.
 * State changes are recorded as events.
 */
import { uid } from '@/kernel/support';

export type PaymentState =
  | 'intent_created'
  | 'planning'
  | 'proposal_sent'
  | 'proposal_accepted'
  | 'resources_reserved'
  | 'escrow_frozen'
  | 'settling'
  | 'merchant_confirming'
  | 'evidence_collecting'
  | 'settled'
  | 'failed'
  | 'disputed';

export type PaymentPriority = 'cheapest' | 'fastest' | 'safest' | 'balanced';

export interface PaymentRequest {
  sourceAmount: number;
  sourceCurrency: string;
  destinationCurrency: string;
  senderId: string;
  receiverId: string;
  priority: PaymentPriority;
  constraints?: {
    maxCostPercent?: number;
    maxSettlementMs?: number;
    minConfidence?: number;
  };
}

export interface PaymentIntent {
  id: string;
  sourceAmount: number;
  sourceCurrency: string;
  destinationAmount: number;
  destinationCurrency: string;
  senderId: string;
  receiverId: string;
  priority: PaymentPriority;
  constraints: { maxCostPercent: number; maxSettlementMs: number; minConfidence: number };
  createdAt: number;
  state: PaymentState;
  lpId?: string;
  escrowId?: string;
  planId?: string;
  history: { state: PaymentState; ts: number; detail: string }[];
}

export interface PaymentResult {
  paymentId: string;
  state: PaymentState;
  settled: boolean;
  settlementTimeMs: number;
  cost: number;
  lpId: string | null;
  escrowId: string | null;
  events: string[];
  error?: string;
}

export class PaymentService {
  private payments: Map<string, PaymentIntent> = new Map();

  createPayment(request: PaymentRequest): PaymentIntent {
    const payment: PaymentIntent = {
      id: uid('payment'),
      sourceAmount: request.sourceAmount,
      sourceCurrency: request.sourceCurrency,
      destinationAmount: request.sourceAmount, // simplified — in production: FX conversion
      destinationCurrency: request.destinationCurrency,
      senderId: request.senderId,
      receiverId: request.receiverId,
      priority: request.priority,
      constraints: {
        maxCostPercent: request.constraints?.maxCostPercent ?? 5,
        maxSettlementMs: request.constraints?.maxSettlementMs ?? 300000,
        minConfidence: request.constraints?.minConfidence ?? 0.3,
      },
      createdAt: Date.now(),
      state: 'intent_created',
      history: [{ state: 'intent_created', ts: Date.now(), detail: 'Payment intent created' }],
    };
    this.payments.set(payment.id, payment);
    return payment;
  }

  updateState(paymentId: string, state: PaymentState, detail: string): PaymentIntent | null {
    const payment = this.payments.get(paymentId);
    if (!payment) return null;
    payment.state = state;
    payment.history.push({ state, ts: Date.now(), detail });
    return payment;
  }

  getPayment(paymentId: string): PaymentIntent | null {
    return this.payments.get(paymentId) ?? null;
  }

  listPayments(): PaymentIntent[] {
    return [...this.payments.values()];
  }

  reset(): void {
    this.payments.clear();
  }
}
