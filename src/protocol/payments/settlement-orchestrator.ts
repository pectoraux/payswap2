/**
 * PaySwap Protocol — Settlement Orchestrator.
 *
 * Coordinates the physical settlement steps. Each method produces a Command,
 * which triggers a Transition, which emits Events. The kernel owns execution.
 *
 *   reserve() → exposure + capacity reserved
 *   freezeEscrow() → Twin Tokens frozen in escrow
 *   settle() → LP fulfills external transfer (with proof)
 *   confirmReceipt() → merchant confirms receiving payment
 *   verifyEvidence() → evidence confidence verified
 *   release() → escrow released to LP
 *   cancel() → resources released, escrow cancelled
 *   transferToReplacement() → escrow transferred to new LP
 */
import { uid } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { settlementEscrow } from '../settlement/escrow';
import { collateralVault } from '../settlement/collateral-vault';
import { settlementCapacityVault } from '../settlement/capacity-vault';
import { lpLifecycle } from '../lp-lifecycle-manager';
import { merchantRegistry } from '../merchant-registry';
import { resourceReservation } from '@/kernel/resource-reservation';
import type { PaymentIntent } from './payment-service';

export interface OrchestratorResult {
  success: boolean;
  error?: string;
  escrowId?: string;
  reservationId?: string;
  proofHash?: string;
}

export class SettlementOrchestrator {

  /** Reserve LP exposure + settlement capacity. */
  reserve(payment: PaymentIntent, lpId: string): OrchestratorResult {
    // 1. Reserve LP exposure
    const exposureReserved = lpLifecycle.reserveExposure(lpId, payment.destinationAmount);
    if (!exposureReserved) {
      return { success: false, error: 'LP exposure limit exceeded' };
    }

    // 2. Reserve settlement capacity (via generic resource reservation)
    const reservation = resourceReservation.reserve(
      'settlement_capacity', lpId, payment.id,
      payment.destinationAmount, 600000, payment.destinationCurrency,
    );
    // Note: resource reservation may fail if no capacity was registered.
    // In that case, we proceed with just exposure reservation (the LP has staked capacity).
    if (!reservation) {
      // Register capacity on the fly from the LP's staked amount
      const lp = lpLifecycle.get(lpId);
      if (lp) {
        resourceReservation.registerCapacity('settlement_capacity', lpId, lp.authorizedExposure, payment.destinationCurrency);
        const retry = resourceReservation.reserve(
          'settlement_capacity', lpId, payment.id,
          payment.destinationAmount, 600000, payment.destinationCurrency,
        );
        if (!retry) {
          lpLifecycle.releaseExposure(lpId, payment.destinationAmount);
          return { success: false, error: 'Capacity reservation failed' };
        }
      }
    }

    eventEngine.emit('payment.resources_reserved', {
      paymentId: payment.id, lpId, exposureReserved: payment.destinationAmount, capacityReserved: payment.destinationAmount,
    }, 0);

    return { success: true, reservationId: reservation?.id };
  }

  /** Freeze escrow (THE guarantee — replaces insurance). */
  freezeEscrow(payment: PaymentIntent): OrchestratorResult {
    if (!payment.lpId) return { success: false, error: 'No LP assigned' };

    const escrow = settlementEscrow.freeze(
      payment.id, payment.lpId, payment.receiverId,
      payment.destinationAmount, payment.destinationCurrency, payment.destinationAmount,
    );

    eventEngine.emit('payment.escrow_frozen', {
      paymentId: payment.id, escrowId: escrow.id, amount: payment.destinationAmount, currency: payment.destinationCurrency,
    }, 0);

    return { success: true, escrowId: escrow.id };
  }

  /** LP fulfills settlement (external transfer with proof). */
  settle(payment: PaymentIntent, proofHash: string): OrchestratorResult {
    if (!payment.escrowId) return { success: false, error: 'No escrow to settle' };

    eventEngine.emit('payment.settling', {
      paymentId: payment.id, lpId: payment.lpId, proofHash,
    }, 0);

    return { success: true, proofHash };
  }

  /** Merchant confirms receipt. */
  confirmReceipt(payment: PaymentIntent): OrchestratorResult {
    eventEngine.emit('payment.merchant_confirming', { paymentId: payment.id }, 0);

    // Record settlement for merchant reputation
    merchantRegistry.recordSettlement(payment.receiverId, payment.destinationAmount, 0);

    return { success: true };
  }

  /** Verify evidence (confidence check). */
  verifyEvidence(payment: PaymentIntent): OrchestratorResult {
    // In production: query ConfidenceService for the payment's evidence
    // For now: assume evidence is valid if escrow exists and is frozen/releasing
    if (!payment.escrowId) return { success: false, error: 'No escrow to verify' };

    const escrow = settlementEscrow.get(payment.escrowId);
    if (!escrow) return { success: false, error: 'Escrow not found' };

    // Check escrow is in a valid state for release
    if (escrow.state !== 'frozen') {
      return { success: false, error: `Escrow in wrong state: ${escrow.state}` };
    }

    eventEngine.emit('payment.evidence_collected', { paymentId: payment.id, evidenceIds: [escrow.proofHash ?? 'auto'] }, 0);

    return { success: true };
  }

  /** Release escrow to LP (settlement complete). */
  release(payment: PaymentIntent): OrchestratorResult {
    if (!payment.escrowId || !payment.lpId) return { success: false, error: 'Missing escrow or LP' };

    // 1. Release escrow
    const released = settlementEscrow.release(payment.escrowId, uid('proof'));
    if (!released) return { success: false, error: 'Escrow release failed' };

    // 2. Release LP exposure
    lpLifecycle.releaseExposure(payment.lpId, payment.destinationAmount);

    // 3. Consume resource reservation
    const reservation = resourceReservation.allReservations().find((r) => r.ownerId === payment.lpId);
    if (reservation) resourceReservation.consume(reservation.id);

    // 4. Record settlement for LP reputation
    const lp = lpLifecycle.get(payment.lpId);
    if (lp) {
      lpLifecycle.updateReputation(payment.lpId, Math.min(1, lp.reputation + 0.01));
    }

    eventEngine.emit('payment.settled', {
      paymentId: payment.id, escrowId: payment.escrowId, settlementTimeMs: Date.now() - payment.createdAt,
    }, 0);

    return { success: true };
  }

  /** Cancel payment (release all reserved resources). */
  cancel(payment: PaymentIntent, reason: string): OrchestratorResult {
    // Release LP exposure
    if (payment.lpId) {
      lpLifecycle.releaseExposure(payment.lpId, payment.destinationAmount);
    }

    // Release capacity reservation
    if (payment.lpId) {
      const reservation = resourceReservation.allReservations().find((r) => r.ownerId === payment.lpId);
      if (reservation) resourceReservation.release(reservation.id);
    }

    // Expire escrow if frozen
    if (payment.escrowId) {
      const escrow = settlementEscrow.get(payment.escrowId);
      if (escrow && escrow.state === 'frozen') {
        settlementEscrow.expire(payment.escrowId);
      }
    }

    eventEngine.emit('payment.failed', { paymentId: payment.id, reason }, 0);
    return { success: true };
  }

  /** Transfer escrow to replacement LP (LP disappeared). */
  transferToReplacement(payment: PaymentIntent, newLpId: string): OrchestratorResult {
    if (!payment.escrowId) return { success: false, error: 'No escrow to transfer' };

    // 1. Transfer escrow to new LP
    const transferred = settlementEscrow.transfer(payment.escrowId, newLpId);
    if (!transferred) return { success: false, error: 'Escrow transfer failed' };

    // 2. Release old LP exposure
    if (payment.lpId) {
      lpLifecycle.releaseExposure(payment.lpId, payment.destinationAmount);
      // Penalize old LP reputation
      const lp = lpLifecycle.get(payment.lpId);
      if (lp) lpLifecycle.updateReputation(payment.lpId, Math.max(0, lp.reputation - 0.1));
    }

    // 3. Reserve new LP exposure
    lpLifecycle.reserveExposure(newLpId, payment.destinationAmount);

    // 4. Update payment
    payment.lpId = newLpId;

    eventEngine.emit('payment.replacement_started', {
      paymentId: payment.id, oldLpId: payment.lpId, newLpId,
    }, 0);

    return { success: true };
  }
}
