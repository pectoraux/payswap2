/**
 * PaySwap Protocol — Transaction Engine.
 *
 * The ONLY entry point for creating and executing payments. Orchestrates the
 * full flow end-to-end through the kernel pipeline.
 *
 *   createIntent() → Payment entity created
 *   execute() → RoutingService finds LP → LP accepts → resources reserved →
 *               escrow frozen → LP settles → merchant confirms → evidence
 *               verified → escrow released → events emitted → projections updated
 *
 * No direct state mutation. Every step produces Commands → Transitions → Events.
 * The kernel owns execution.
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { type Entity, type Evidence } from '@/kernel';
import { settlementEscrow } from '../settlement/escrow';
import { lpLifecycle } from '../lp-lifecycle-manager';
import { merchantRegistry } from '../merchant-registry';
import { resourceReservation } from '@/kernel/resource-reservation';
import { webhookEngine } from '../webhooks/engine';
import { RoutingService, type SettlementPlan } from './routing-service';
import { SettlementOrchestrator } from './settlement-orchestrator';
import { PaymentService, type PaymentIntent, type PaymentRequest, type PaymentResult, type PaymentState } from './payment-service';

export class TransactionEngine {
  private paymentService = new PaymentService();
  private routingService = new RoutingService();
  private orchestrator = new SettlementOrchestrator();

  /** Create a payment intent (user-facing). */
  createIntent(request: PaymentRequest): PaymentIntent {
    const intent = this.paymentService.createPayment(request);
    eventEngine.emit('payment.intent_created', {
      paymentId: intent.id,
      sourceAmount: request.sourceAmount,
      sourceCurrency: request.sourceCurrency,
      destinationAmount: intent.destinationAmount,
      destinationCurrency: request.destinationCurrency,
      senderId: request.senderId,
      receiverId: request.receiverId,
      priority: request.priority,
    }, 0);
    // Fire webhook
    webhookEngine.emit({
      merchantId: request.receiverId,
      eventType: 'payment.created',
      payload: { paymentId: intent.id, amount: request.sourceAmount, currency: request.sourceCurrency, senderId: request.senderId },
    }).catch(() => {});
    return intent;
  }

  /**
   * Execute the payment end-to-end. Returns when escrow is frozen.
   * Settlement confirmation is async (call confirmSettlement + confirmReceipt).
   */
  execute(paymentId: string, entities: Entity[], evidence: Evidence[]): PaymentResult {
    const payment = this.paymentService.getPayment(paymentId);
    if (!payment) return this.failResult(paymentId, 'Payment not found');
    if (payment.state !== 'intent_created') return this.failResult(paymentId, `Payment in wrong state: ${payment.state}`);

    // 1. Route — find the best LP
    this.paymentService.updateState(paymentId, 'planning', 'Routing service selecting LP');
    const plan = this.routingService.findRoute(payment, entities, evidence);
    if (!plan) {
      this.paymentService.updateState(paymentId, 'failed', 'No settlement route available');
      eventEngine.emit('payment.failed', { paymentId, reason: 'No settlement route available' }, 0);
      return this.failResult(paymentId, 'No settlement route available');
    }

    // 2. LP accepts proposal (auto-accept for now; in production: async)
    this.paymentService.updateState(paymentId, 'proposal_sent', `Proposal sent to LP ${plan.lpId}`);
    this.paymentService.updateState(paymentId, 'proposal_accepted', `LP ${plan.lpId} accepted`);
    payment.lpId = plan.lpId;
    eventEngine.emit('payment.proposal_accepted', { paymentId, lpId: plan.lpId }, 0);

    // 3. Reserve resources (exposure + capacity)
    const reservation = this.orchestrator.reserve(payment, plan.lpId);
    if (!reservation.success) {
      this.paymentService.updateState(paymentId, 'failed', `Resource reservation failed: ${reservation.error}`);
      // Try alternative LP
      const alt = this.routingService.findAlternative(paymentId, [plan.lpId], entities, evidence);
      if (alt) {
        this.paymentService.updateState(paymentId, 'planning', `Re-routing to alternative LP ${alt.lpId}`);
        payment.lpId = alt.lpId;
        const altRes = this.orchestrator.reserve(payment, alt.lpId);
        if (!altRes.success) {
          this.paymentService.updateState(paymentId, 'failed', 'All LPs failed reservation');
          return this.failResult(paymentId, 'All LPs failed reservation');
        }
      } else {
        return this.failResult(paymentId, 'No alternative LP available');
      }
    }
    this.paymentService.updateState(paymentId, 'resources_reserved', 'Exposure + capacity reserved');

    // 4. Freeze escrow
    const escrow = this.orchestrator.freezeEscrow(payment);
    if (!escrow.success) {
      this.paymentService.updateState(paymentId, 'failed', `Escrow freeze failed: ${escrow.error}`);
      return this.failResult(paymentId, escrow.error ?? 'Escrow freeze failed');
    }
    payment.escrowId = escrow.escrowId ?? undefined;
    this.paymentService.updateState(paymentId, 'escrow_frozen', `Escrow ${escrow.escrowId} frozen`);

    // Return — settlement is async from here
    return {
      paymentId,
      state: 'escrow_frozen',
      settled: false,
      settlementTimeMs: 0,
      cost: plan.cost,
      lpId: plan.lpId,
      escrowId: escrow.escrowId ?? null,
      events: [],
    };
  }

  /** LP confirms settlement (with proof of external transfer). */
  confirmSettlement(paymentId: string, proofHash: string): PaymentResult {
    const payment = this.paymentService.getPayment(paymentId);
    if (!payment || payment.state !== 'escrow_frozen') return this.failResult(paymentId, 'Payment not in escrow_frozen state');

    this.paymentService.updateState(paymentId, 'settling', `LP settling (proof: ${proofHash})`);
    this.orchestrator.settle(payment, proofHash);
    this.paymentService.updateState(paymentId, 'merchant_confirming', 'Awaiting merchant confirmation');

    return {
      paymentId,
      state: 'merchant_confirming',
      settled: false,
      settlementTimeMs: 0,
      cost: 0,
      lpId: payment.lpId ?? null,
      escrowId: payment.escrowId ?? null,
      events: [],
    };
  }

  /** Merchant confirms receipt (completes settlement). */
  confirmReceipt(paymentId: string): PaymentResult {
    const payment = this.paymentService.getPayment(paymentId);
    if (!payment || payment.state !== 'merchant_confirming') return this.failResult(paymentId, 'Payment not in merchant_confirming state');

    const startMs = payment.createdAt;

    // 1. Confirm receipt
    this.orchestrator.confirmReceipt(payment);
    this.paymentService.updateState(paymentId, 'evidence_collecting', 'Merchant confirmed, collecting evidence');

    // 2. Verify evidence
    const verification = this.orchestrator.verifyEvidence(payment);
    if (!verification.success) {
      this.paymentService.updateState(paymentId, 'disputed', `Evidence verification failed: ${verification.error}`);
      return {
        paymentId,
        state: 'disputed',
        settled: false,
        settlementTimeMs: Date.now() - startMs,
        cost: 0,
        lpId: payment.lpId ?? null,
        escrowId: payment.escrowId ?? null,
        events: [],
        error: verification.error,
      };
    }

    // 3. Release escrow
    this.orchestrator.release(payment);
    this.paymentService.updateState(paymentId, 'settled', 'Payment settled successfully');

    const settlementTimeMs = Date.now() - startMs;
    eventEngine.emit('payment.settled', { paymentId, escrowId: payment.escrowId, settlementTimeMs, cost: 0 }, 0);

    // Fire webhook: payment.completed
    webhookEngine.emit({
      merchantId: payment.receiverId,
      eventType: 'payment.completed',
      payload: { paymentId, amount: payment.destinationAmount, currency: payment.destinationCurrency, settlementTimeMs, lpId: payment.lpId, escrowId: payment.escrowId },
    }).catch(() => {});

    return {
      paymentId,
      state: 'settled',
      settled: true,
      settlementTimeMs,
      cost: 0,
      lpId: payment.lpId ?? null,
      escrowId: payment.escrowId ?? null,
      events: [],
    };
  }

  /** Cancel a pending payment. */
  cancel(paymentId: string, reason: string): PaymentResult {
    const payment = this.paymentService.getPayment(paymentId);
    if (!payment) return this.failResult(paymentId, 'Payment not found');
    if (payment.state === 'settled') return this.failResult(paymentId, 'Cannot cancel settled payment');

    this.orchestrator.cancel(payment, reason);
    this.paymentService.updateState(paymentId, 'failed', `Cancelled: ${reason}`);
    eventEngine.emit('payment.failed', { paymentId, reason }, 0);

    // Fire webhook: payment.failed
    webhookEngine.emit({
      merchantId: payment.receiverId,
      eventType: 'payment.failed',
      payload: { paymentId, reason, amount: payment.destinationAmount, currency: payment.destinationCurrency },
    }).catch(() => {});

    return {
      paymentId,
      state: 'failed',
      settled: false,
      settlementTimeMs: 0,
      cost: 0,
      lpId: payment.lpId ?? null,
      escrowId: payment.escrowId ?? null,
      events: [],
      error: reason,
    };
  }

  /** Get current payment status. */
  getStatus(paymentId: string): PaymentIntent | null {
    return this.paymentService.getPayment(paymentId);
  }

  /** List all payments. */
  listPayments(): PaymentIntent[] {
    return this.paymentService.listPayments();
  }

  private failResult(paymentId: string, error: string): PaymentResult {
    return { paymentId, state: 'failed', settled: false, settlementTimeMs: 0, cost: 0, lpId: null, escrowId: null, events: [], error };
  }
}

export const transactionEngine = new TransactionEngine();
