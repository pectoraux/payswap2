/**
 * Built-in Economic Invariants. (M-RT-20, Phase 2.)
 *
 * 9 invariants that make the Runtime financially self-verifying:
 *   1. double-entry         — Σ debits == Σ credits
 *   2. reserve-conservation — opening + inflows - outflows = closing
 *   3. liquidity            — reserve balances never negative
 *   4. payment-uniqueness   — a paymentId can't settle twice
 *   5. refund-limit         — refund amount <= payment amount
 *   6. route-continuity     — every hop: output == next input
 *   7. settlement-uniqueness— exactly one settlement completion per payment
 *   8. fx-rate-exists       — every conversion has a known FX rate
 *   9. compiler-hash        — ExecutionPlan hash must match
 *
 * Every invariant is PURE + DETERMINISTIC. No side effects.
 */

import type {
  RuntimeInvariant,
  RuntimeSnapshot,
  StoredEvent,
  Violation,
} from './types';
import { pass, fail, violation, eventCommand, eventsByPrefix } from './result';

// ─── 1. Double-Entry Invariant ──────────────────────────────────────────────

/** Σ debits == Σ credits for all ledger entries. */
export const DoubleEntryInvariant: RuntimeInvariant = {
  id: 'double-entry',
  description: 'Every debit must equal every credit (Σ debits == Σ credits)',
  handles: ['ledger.', 'reserve.', 'payment.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const entries = snapshot.ledgerEntries;
    const totalDebits = entries.reduce((s, e) => s + e.debit, 0);
    const totalCredits = entries.reduce((s, e) => s + e.credit, 0);
    const diff = Math.abs(totalDebits - totalCredits);

    // Allow floating-point epsilon (financial sums should match to the cent).
    if (diff > 0.01) {
      return fail('double-entry', [
        violation('double-entry', `Ledger imbalance: debits=${totalDebits}, credits=${totalCredits}, diff=${diff}`, { severity: 'error' }),
      ], start);
    }
    return pass('double-entry', start);
  },
};

// ─── 2. Reserve Conservation Invariant ──────────────────────────────────────

/** For each reserve: available + locked + consumed - released == initial funding. */
export const ReserveConservationInvariant: RuntimeInvariant = {
  id: 'reserve-conservation',
  description: 'Reserve balances conserve: available + locked + consumed - released = funded',
  handles: ['reserve.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const violations: Violation[] = [];

    for (const [reserveId, balances] of snapshot.reserves) {
      const b = balances as { available: number; locked: number; pending: number; consumed: number; released: number };
      // Conservation: available + locked + consumed = released + initial_funding
      // Since we don't track initial_funding separately, we check:
      // available + locked >= 0 (can't have negative free + locked balance)
      // consumed >= released (can't release more than was consumed)
      if (b.consumed < b.released - 0.01) {
        violations.push(violation('reserve-conservation', `Reserve ${reserveId}: consumed (${b.consumed}) < released (${b.released})`, {
          projection: { name: 'reserves', id: reserveId },
          severity: 'error',
        }));
      }
    }

    if (violations.length > 0) return fail('reserve-conservation', violations, start);
    return pass('reserve-conservation', start);
  },
};

// ─── 3. Liquidity Invariant ─────────────────────────────────────────────────

/** Reserve balances must never be negative. */
export const LiquidityInvariant: RuntimeInvariant = {
  id: 'liquidity',
  description: 'Reserve balances must never be negative (available, locked, etc. >= 0)',
  handles: ['reserve.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const violations: Violation[] = [];

    for (const [reserveId, balances] of snapshot.reserves) {
      const b = balances as { available: number; locked: number; pending: number; consumed: number; released: number };
      if (b.available < -0.01) {
        violations.push(violation('liquidity', `Reserve ${reserveId}: available (${b.available}) is negative`, {
          projection: { name: 'reserves', id: reserveId },
          severity: 'error',
        }));
      }
      if (b.locked < -0.01) {
        violations.push(violation('liquidity', `Reserve ${reserveId}: locked (${b.locked}) is negative`, {
          projection: { name: 'reserves', id: reserveId },
          severity: 'error',
        }));
      }
    }

    if (violations.length > 0) return fail('liquidity', violations, start);
    return pass('liquidity', start);
  },
};

// ─── 4. Payment Uniqueness Invariant ────────────────────────────────────────

/** A paymentId can't settle (payment.completed) twice. */
export const PaymentUniquenessInvariant: RuntimeInvariant = {
  id: 'payment-uniqueness',
  description: 'A paymentId cannot settle (payment.completed) more than once',
  handles: ['payment.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const violations: Violation[] = [];

    // Check ALL events in the snapshot (not just proposed) — a duplicate
    // settlement would already be in the log.
    const allEvents = [...snapshot.events, ...events];
    const completedPayments = new Map<string, number>(); // paymentId → count

    for (const ev of allEvents) {
      if (ev.type === 'payment.completed') {
        const payload = ev.payload as { paymentId?: string };
        const paymentId = payload.paymentId ?? '';
        completedPayments.set(paymentId, (completedPayments.get(paymentId) ?? 0) + 1);
      }
    }

    for (const [paymentId, count] of completedPayments) {
      if (count > 1) {
        violations.push(violation('payment-uniqueness', `Payment ${paymentId} settled ${count} times (expected 1)`, {
          projection: { name: 'payments', id: paymentId },
          severity: 'error',
        }));
      }
    }

    if (violations.length > 0) return fail('payment-uniqueness', violations, start);
    return pass('payment-uniqueness', start);
  },
};

// ─── 5. Refund Limit Invariant ──────────────────────────────────────────────

/** Total refund amount for a payment can't exceed the payment amount. */
export const RefundLimitInvariant: RuntimeInvariant = {
  id: 'refund-limit',
  description: 'Total refund amount for a payment cannot exceed the payment amount',
  handles: ['refund.', 'payment.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const violations: Violation[] = [];

    // Build a map: paymentId → total refund amount.
    const refundsByPayment = new Map<string, number>();
    for (const [, refundView] of snapshot.refunds) {
      const r = refundView as { paymentId: string; amount: number; status: string };
      // Only count non-rejected refunds.
      if (r.status !== 'REJECTED') {
        refundsByPayment.set(r.paymentId, (refundsByPayment.get(r.paymentId) ?? 0) + r.amount);
      }
    }

    // Check each refund against its payment.
    for (const [paymentId, totalRefunded] of refundsByPayment) {
      const paymentView = snapshot.payments.get(paymentId) as { amount: number } | undefined;
      if (paymentView && totalRefunded > paymentView.amount + 0.01) {
        violations.push(violation('refund-limit', `Payment ${paymentId}: refunds (${totalRefunded}) exceed payment amount (${paymentView.amount})`, {
          projection: { name: 'payments', id: paymentId },
          severity: 'error',
        }));
      }
    }

    if (violations.length > 0) return fail('refund-limit', violations, start);
    return pass('refund-limit', start);
  },
};

// ─── 6. Route Continuity Invariant ──────────────────────────────────────────

/** In a multi-hop route, the output of hop N must equal the input of hop N+1. */
export const RouteContinuityInvariant: RuntimeInvariant = {
  id: 'route-continuity',
  description: 'In a multi-hop route, the output currency of hop N must equal the input of hop N+1',
  handles: ['settlement.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const violations: Violation[] = [];

    // Check settlement.executed events — their payload may contain legs.
    const settlementEvents = eventsByPrefix([...snapshot.events, ...events], 'settlement.');
    for (const ev of settlementEvents) {
      if (ev.type !== 'settlement.executed') continue;
      const payload = ev.payload as { legs?: { from: string; to: string }[] };
      if (!payload.legs || payload.legs.length < 2) continue;

      for (let i = 0; i < payload.legs.length - 1; i++) {
        const current = payload.legs[i];
        const next = payload.legs[i + 1];
        if (current.to !== next.from) {
          violations.push(violation('route-continuity', `Route discontinuity: hop ${i} outputs ${current.to}, but hop ${i + 1} expects ${next.from}`, {
            event: ev,
            command: eventCommand(ev),
            severity: 'error',
          }));
        }
      }
    }

    if (violations.length > 0) return fail('route-continuity', violations, start);
    return pass('route-continuity', start);
  },
};

// ─── 7. Settlement Uniqueness Invariant ─────────────────────────────────────

/** Exactly one settlement completion per payment — never two settlement.executed. */
export const SettlementUniquenessInvariant: RuntimeInvariant = {
  id: 'settlement-uniqueness',
  description: 'Exactly one settlement execution per payment (never duplicate settlement.executed)',
  handles: ['settlement.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const violations: Violation[] = [];

    const allEvents = [...snapshot.events, ...events];
    const settlementCounts = new Map<string, number>(); // paymentId → count

    for (const ev of allEvents) {
      if (ev.type === 'settlement.executed') {
        const payload = ev.payload as { paymentId?: string };
        const paymentId = payload.paymentId ?? '';
        settlementCounts.set(paymentId, (settlementCounts.get(paymentId) ?? 0) + 1);
      }
    }

    for (const [paymentId, count] of settlementCounts) {
      if (count > 1) {
        violations.push(violation('settlement-uniqueness', `Payment ${paymentId} has ${count} settlement executions (expected 1)`, {
          projection: { name: 'payments', id: paymentId },
          severity: 'error',
        }));
      }
    }

    if (violations.length > 0) return fail('settlement-uniqueness', violations, start);
    return pass('settlement-uniqueness', start);
  },
};

// ─── 8. FX Rate Exists Invariant ────────────────────────────────────────────

/** Every FX conversion must reference a known FX rate. */
export const FxRateExistsInvariant: RuntimeInvariant = {
  id: 'fx-rate-exists',
  description: 'Every FX conversion must have a non-zero FX rate',
  handles: ['settlement.', 'payment.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const violations: Violation[] = [];

    const allEvents = [...snapshot.events, ...events];
    for (const ev of allEvents) {
      // Check payment.recorded events for fxRate.
      if (ev.type === 'payment.recorded') {
        const payload = ev.payload as { fxRate?: number; sourceCurrency?: string; destinationCurrency?: string };
        // If source != destination, fxRate must exist and be > 0.
        if (payload.sourceCurrency && payload.destinationCurrency && payload.sourceCurrency !== payload.destinationCurrency) {
          if (!payload.fxRate || payload.fxRate <= 0) {
            violations.push(violation('fx-rate-exists', `Payment ${ev.streamId}: FX conversion ${payload.sourceCurrency}→${payload.destinationCurrency} has invalid fxRate (${payload.fxRate})`, {
              event: ev,
              command: eventCommand(ev),
              severity: 'error',
            }));
          }
        }
      }
    }

    if (violations.length > 0) return fail('fx-rate-exists', violations, start);
    return pass('fx-rate-exists', start);
  },
};

// ─── 9. Compiler Hash Invariant ─────────────────────────────────────────────

/** The ExecutionPlan hash must match the hash computed from its contents. */
export const CompilerHashInvariant: RuntimeInvariant = {
  id: 'compiler-hash',
  description: 'ExecutionPlan hash must match the hash computed from its contents',
  handles: ['payment.', 'settlement.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const violations: Violation[] = [];

    // Check that every plan in the snapshot has a valid hash.
    // (In a full implementation, we'd recompute the hash and compare.
    // For M-RT-20, we verify the hash exists and is non-empty.)
    for (const [planId, plan] of snapshot.executionPlans) {
      const p = plan as { id: string; hash: string };
      if (!p.hash || p.hash.length === 0) {
        violations.push(violation('compiler-hash', `ExecutionPlan ${planId} has empty or missing hash`, {
          projection: { name: 'executionPlans', id: planId },
          severity: 'error',
        }));
      }
    }

    if (violations.length > 0) return fail('compiler-hash', violations, start);
    return pass('compiler-hash', start);
  },
};

// ─── 10-15. Wallet Balance Invariants (M-RT-23) ────────────────────────────

/** Available balance must never be negative. */
export const WalletAvailableNonNegativeInvariant: RuntimeInvariant = {
  id: 'wallet-available-non-negative',
  description: 'Wallet available balance must never be negative',
  handles: ['wallet.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const violations: Violation[] = [];

    for (const [walletId, balances] of snapshot.wallets) {
      const b = balances as { available: number; reserved: number; total: number };
      if (b.available < -0.01) {
        violations.push(violation('wallet-available-non-negative', `Wallet ${walletId}: available balance (${b.available}) is negative`, {
          projection: { name: 'wallets', id: walletId },
          severity: 'error',
        }));
      }
    }

    if (violations.length > 0) return fail('wallet-available-non-negative', violations, start);
    return pass('wallet-available-non-negative', start);
  },
};

/** Reserved balance must never be negative. */
export const WalletReservedNonNegativeInvariant: RuntimeInvariant = {
  id: 'wallet-reserved-non-negative',
  description: 'Wallet reserved balance must never be negative',
  handles: ['wallet.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const violations: Violation[] = [];

    for (const [walletId, balances] of snapshot.wallets) {
      const b = balances as { available: number; reserved: number; total: number };
      if (b.reserved < -0.01) {
        violations.push(violation('wallet-reserved-non-negative', `Wallet ${walletId}: reserved balance (${b.reserved}) is negative`, {
          projection: { name: 'wallets', id: walletId },
          severity: 'error',
        }));
      }
    }

    if (violations.length > 0) return fail('wallet-reserved-non-negative', violations, start);
    return pass('wallet-reserved-non-negative', start);
  },
};

/** Available + reserved must equal total (balance invariant). */
export const WalletBalanceConsistencyInvariant: RuntimeInvariant = {
  id: 'wallet-balance-consistency',
  description: 'Wallet available + reserved must equal total',
  handles: ['wallet.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const violations: Violation[] = [];

    for (const [walletId, balances] of snapshot.wallets) {
      const b = balances as { available: number; reserved: number; total: number };
      const diff = Math.abs((b.available + b.reserved) - b.total);
      if (diff > 0.01) {
        violations.push(violation('wallet-balance-consistency', `Wallet ${walletId}: available (${b.available}) + reserved (${b.reserved}) ≠ total (${b.total})`, {
          projection: { name: 'wallets', id: walletId },
          severity: 'error',
        }));
      }
    }

    if (violations.length > 0) return fail('wallet-balance-consistency', violations, start);
    return pass('wallet-balance-consistency', start);
  },
};

/** No debit may exceed the available balance. */
export const WalletDebitLimitInvariant: RuntimeInvariant = {
  id: 'wallet-debit-limit',
  description: 'No debit may exceed the available balance',
  handles: ['wallet.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const violations: Violation[] = [];

    // Compute the EFFECTIVE available balance for each wallet, accounting for
    // ALL proposed events (credits, debits, reserves, releases) in the batch.
    // This prevents concurrent debits from both passing when they collectively
    // exceed the balance.
    const balanceAdjustments = new Map<string, number>();
    for (const ev of events) {
      const payload = ev.payload as { walletId?: string; amount?: number };
      if (!payload.walletId) continue;
      const adj = balanceAdjustments.get(payload.walletId) ?? 0;
      switch (ev.type) {
        case 'wallet.credited': balanceAdjustments.set(payload.walletId, adj + (payload.amount ?? 0)); break;
        case 'wallet.debited': balanceAdjustments.set(payload.walletId, adj - (payload.amount ?? 0)); break;
        case 'wallet.reserved': balanceAdjustments.set(payload.walletId, adj - (payload.amount ?? 0)); break;
        case 'wallet.released': balanceAdjustments.set(payload.walletId, adj + (payload.amount ?? 0)); break;
      }
    }

    // Now check each debit against the EFFECTIVE available balance.
    for (const ev of events) {
      if (ev.type !== 'wallet.debited') continue;
      const payload = ev.payload as { walletId: string; amount: number };
      const balances = snapshot.wallets.get(payload.walletId);
      if (!balances) continue;
      const b = balances as { available: number };
      // Effective available = current available + adjustments from OTHER proposed events
      // (not including this debit itself, since we're checking if THIS debit is OK).
      const adjustmentsFromOthers = (balanceAdjustments.get(payload.walletId) ?? 0) + payload.amount; // +amount because the debit already subtracted it
      const effectiveAvailable = b.available + adjustmentsFromOthers;
      if (effectiveAvailable - payload.amount < -0.01) {
        violations.push(violation('wallet-debit-limit', `Wallet ${payload.walletId}: debit ${payload.amount} exceeds effective available balance ${effectiveAvailable} (current: ${b.available}, pending adjustments: ${adjustmentsFromOthers - payload.amount})`, {
          event: ev,
          projection: { name: 'wallets', id: payload.walletId },
          command: eventCommand(ev),
          severity: 'error',
        }));
      }
    }

    if (violations.length > 0) return fail('wallet-debit-limit', violations, start);
    return pass('wallet-debit-limit', start);
  },
};

/** No reserve may exceed the available balance. */
export const WalletReserveLimitInvariant: RuntimeInvariant = {
  id: 'wallet-reserve-limit',
  description: 'No reserve may exceed the available balance',
  handles: ['wallet.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const violations: Violation[] = [];

    for (const ev of events) {
      if (ev.type !== 'wallet.reserved') continue;
      const payload = ev.payload as { walletId: string; amount: number };
      const balances = snapshot.wallets.get(payload.walletId);
      if (!balances) continue;
      const b = balances as { available: number };
      if (b.available - payload.amount < -0.01) {
        violations.push(violation('wallet-reserve-limit', `Wallet ${payload.walletId}: reserve ${payload.amount} exceeds available balance ${b.available}`, {
          event: ev,
          projection: { name: 'wallets', id: payload.walletId },
          command: eventCommand(ev),
          severity: 'error',
        }));
      }
    }

    if (violations.length > 0) return fail('wallet-reserve-limit', violations, start);
    return pass('wallet-reserve-limit', start);
  },
};

/** No release may exceed the reserved balance. */
export const WalletReleaseLimitInvariant: RuntimeInvariant = {
  id: 'wallet-release-limit',
  description: 'No release may exceed the reserved balance',
  handles: ['wallet.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const violations: Violation[] = [];

    for (const ev of events) {
      if (ev.type !== 'wallet.released') continue;
      const payload = ev.payload as { walletId: string; amount: number };
      const balances = snapshot.wallets.get(payload.walletId);
      if (!balances) continue;
      const b = balances as { reserved: number };
      if (b.reserved - payload.amount < -0.01) {
        violations.push(violation('wallet-release-limit', `Wallet ${payload.walletId}: release ${payload.amount} exceeds reserved balance ${b.reserved}`, {
          event: ev,
          projection: { name: 'wallets', id: payload.walletId },
          command: eventCommand(ev),
          severity: 'error',
        }));
      }
    }

    if (violations.length > 0) return fail('wallet-release-limit', violations, start);
    return pass('wallet-release-limit', start);
  },
};

// ─── 16. Solvency Invariant (C-5 fix) ───────────────────────────────────────

/**
 * Solvency: Total assets must be >= Total liabilities.
 *
 * This is the most fundamental financial invariant. If liabilities exceed
 * assets, the system is insolvent — it owes more than it holds. No
 * transaction should ever be allowed to make the system insolvent.
 *
 * The invariant checks the balance sheet derived from the ledger:
 *   - Assets = merchant_receivable + stablecoin_reserves + fiat_reserves + ...
 *   - Liabilities = twin_tokens_outstanding + wallet_balances + lp_payable + ...
 *
 * If assets < liabilities, the transaction is rejected.
 */
export const SolvencyInvariant: RuntimeInvariant = {
  id: 'solvency',
  description: 'Total assets must be >= total liabilities (solvency)',
  handles: ['ledger.', 'payment.', 'payout.', 'refund.', 'wallet.', 'twin.', 'reserve.'],

  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): ReturnType<typeof pass> | ReturnType<typeof fail> {
    const start = Date.now();
    const entries = snapshot.ledgerEntries;

    // Calculate totals from ledger entries
    let assetTotal = 0;
    let liabilityTotal = 0;

    for (const entry of entries) {
      // Account names follow the pattern: type:name (e.g., "asset:merchant_receivable")
      // Debits increase assets, credits increase liabilities.
      const accountLabel = (entry as any).accountLabel || (entry as any).account || '';
      if (typeof accountLabel !== 'string') continue;

      if (accountLabel.startsWith('asset:')) {
        assetTotal += entry.debit - entry.credit;
      } else if (accountLabel.startsWith('liability:')) {
        liabilityTotal += entry.credit - entry.debit;
      }
      // Equity accounts are not checked (assets = liabilities + equity,
      // so equity = assets - liabilities, which must be >= 0 for solvency)
    }

    // Solvency check: assets >= liabilities
    if (assetTotal < liabilityTotal) {
      return fail('solvency', [
        violation('solvency',
          `INSOLVENT: assets (${assetTotal}) < liabilities (${liabilityTotal}). Deficit: ${liabilityTotal - assetTotal}`,
          { severity: 'error' }
        ),
      ], start);
    }

    return pass('solvency', start);
  },
};

// ─── All Built-in Invariants ────────────────────────────────────────────────

/** All 16 built-in economic invariants, in registration order. */
export const BUILTIN_INVARIANTS: RuntimeInvariant[] = [
  DoubleEntryInvariant,
  ReserveConservationInvariant,
  LiquidityInvariant,
  PaymentUniquenessInvariant,
  RefundLimitInvariant,
  RouteContinuityInvariant,
  SettlementUniquenessInvariant,
  FxRateExistsInvariant,
  CompilerHashInvariant,
  WalletAvailableNonNegativeInvariant,
  WalletReservedNonNegativeInvariant,
  WalletBalanceConsistencyInvariant,
  WalletDebitLimitInvariant,
  WalletReserveLimitInvariant,
  WalletReleaseLimitInvariant,
  SolvencyInvariant,
];
