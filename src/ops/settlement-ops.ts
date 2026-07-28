/**
 * SettlementOps — manual settlement operations (manual settlement, retry
 * failed, force complete, reverse, reconcile).
 *
 * Like treasury ops, each operation has a 3-stage lifecycle:
 * pending → approved → executed (or failed). Backed by an in-memory store.
 */

import type { SettlementOperation } from './types';

function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const settlementOpsStore = new Map<string, SettlementOperation>();

function seedSettlementOps() {
  if (settlementOpsStore.size > 0) return;
  const now = Date.now();
  const seed: SettlementOperation[] = [
    {
      id: rid('sop'),
      type: 'retry_failed',
      transactionId: 'tx-9f3a1c',
      status: 'pending',
      requestedBy: 'u-ops-amara',
      rationale: 'Retry settlement that failed due to connector timeout.',
      createdAt: now - 15 * 60 * 1000,
    },
    {
      id: rid('sop'),
      type: 'force_complete',
      transactionId: 'tx-7d2e5b',
      status: 'approved',
      requestedBy: 'u-ops-amara',
      approvedBy: 'u-ops-kwame',
      rationale: 'Settlement stuck in PENDING for > 45 minutes. Manual review confirms funds debited.',
      createdAt: now - 90 * 60 * 1000,
    },
    {
      id: rid('sop'),
      type: 'reverse',
      transactionId: 'tx-4a8f2d',
      status: 'executed',
      requestedBy: 'u-ops-amara',
      approvedBy: 'u-ops-kwame',
      executedAt: now - 3 * 60 * 60 * 1000,
      rationale: 'Customer dispute upheld. Reverse settlement.',
      createdAt: now - 4 * 60 * 60 * 1000,
    },
    {
      id: rid('sop'),
      type: 'manual_settlement',
      transactionId: 'tx-1c9b7e',
      status: 'failed',
      requestedBy: 'u-ops-amara',
      approvedBy: 'u-ops-kwame',
      rationale: 'Manual settlement for high-value payout.',
      createdAt: now - 24 * 60 * 60 * 1000,
    },
  ];
  for (const s of seed) settlementOpsStore.set(s.id, s);
}

export type NewSettlementOpInput = Omit<
  SettlementOperation,
  'id' | 'status' | 'createdAt'
>;

export interface SettlementOpListFilter {
  status?: string;
  type?: string;
}

class SettlementOps {
  private ensureSeeded() {
    seedSettlementOps();
  }

  async request(data: NewSettlementOpInput): Promise<SettlementOperation> {
    this.ensureSeeded();
    const id = rid('sop');
    const now = Date.now();
    const op: SettlementOperation = {
      ...data,
      id,
      status: 'pending',
      createdAt: now,
    };
    settlementOpsStore.set(id, op);
    return op;
  }

  async approve(id: string, approvedBy: string): Promise<void> {
    this.ensureSeeded();
    const op = settlementOpsStore.get(id);
    if (!op) return;
    if (op.requestedBy === approvedBy) {
      throw new Error(
        'Approver must be different from requester (4-eyes principle)',
      );
    }
    if (op.status !== 'pending') return;
    op.status = 'approved';
    op.approvedBy = approvedBy;
  }

  async execute(id: string): Promise<void> {
    this.ensureSeeded();
    const op = settlementOpsStore.get(id);
    if (!op) return;
    if (op.status !== 'approved') return;
    op.status = 'executed';
    op.executedAt = Date.now();
  }

  async list(filter?: SettlementOpListFilter): Promise<SettlementOperation[]> {
    this.ensureSeeded();
    const all = Array.from(settlementOpsStore.values()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    if (!filter?.status && !filter?.type) return all;
    return all.filter(
      (op) =>
        (!filter.status || op.status === filter.status) &&
        (!filter.type || op.type === filter.type),
    );
  }

  /** All failed settlements (for the retry queue). */
  async getFailedSettlements(): Promise<SettlementOperation[]> {
    this.ensureSeeded();
    return Array.from(settlementOpsStore.values())
      .filter((op) => op.status === 'failed')
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Convenience: request a `retry_failed` settlement operation for a single
   * transaction. Returns the new pending operation.
   */
  async retryFailed(
    transactionId: string,
    requestedBy: string,
  ): Promise<SettlementOperation> {
    this.ensureSeeded();
    return this.request({
      type: 'retry_failed',
      transactionId,
      requestedBy,
      rationale: `Retry failed settlement for transaction ${transactionId}.`,
    });
  }
}

export const settlementOps = new SettlementOps();
