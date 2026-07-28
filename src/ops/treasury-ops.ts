/**
 * TreasuryOps — manual treasury operations (reserve adjustments, rebalances,
 * withdrawals, deposits, FX hedges).
 *
 * Each operation has a 3-stage lifecycle: pending → approved → executed
 * (or failed/reversed). The 4-eyes principle is enforced: the requester
 * cannot also approve. Backed by an in-memory store.
 */

import type { TreasuryOperation } from './types';

function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const treasuryOpsStore = new Map<string, TreasuryOperation>();

function seedTreasuryOps() {
  if (treasuryOpsStore.size > 0) return;
  const now = Date.now();
  const seed: TreasuryOperation[] = [
    {
      id: rid('trop'),
      type: 'reserve_adjustment',
      country: 'NG',
      currency: 'NGN',
      amount: 500_000,
      status: 'pending',
      requestedBy: 'u-treasury-amina',
      rationale:
        'NGN reserve below solvency floor (12% below). Request emergency injection.',
      createdAt: now - 30 * 60 * 1000,
    },
    {
      id: rid('trop'),
      type: 'rebalance',
      country: 'KE',
      currency: 'KES',
      amount: 250_000,
      status: 'approved',
      requestedBy: 'u-treasury-amina',
      approvedBy: 'u-treasury-bisi',
      rationale:
        'KES corridor over-reserved after weekend volume drop. Rebalance to GHS.',
      createdAt: now - 2 * 60 * 60 * 1000,
    },
    {
      id: rid('trop'),
      type: 'fx_hedge',
      country: 'GH',
      currency: 'USD',
      amount: 100_000,
      status: 'executed',
      requestedBy: 'u-treasury-amina',
      approvedBy: 'u-treasury-bisi',
      executedAt: now - 6 * 60 * 60 * 1000,
      rationale: 'Hedge USD exposure ahead of Q3 close.',
      createdAt: now - 8 * 60 * 60 * 1000,
    },
    {
      id: rid('trop'),
      type: 'withdrawal',
      country: 'NG',
      currency: 'NGN',
      amount: 75_000,
      status: 'failed',
      requestedBy: 'u-treasury-amina',
      approvedBy: 'u-treasury-bisi',
      rationale: 'Withdraw excess NGN to central pool.',
      createdAt: now - 24 * 60 * 60 * 1000,
    },
  ];
  for (const t of seed) treasuryOpsStore.set(t.id, t);
}

export type NewTreasuryOpInput = Omit<
  TreasuryOperation,
  'id' | 'status' | 'createdAt'
>;

export interface TreasuryOpListFilter {
  status?: string;
  type?: string;
}

class TreasuryOps {
  private ensureSeeded() {
    seedTreasuryOps();
  }

  /** Request a new treasury operation. Status starts as `pending`. */
  async request(data: NewTreasuryOpInput): Promise<TreasuryOperation> {
    this.ensureSeeded();
    const id = rid('trop');
    const now = Date.now();
    const op: TreasuryOperation = {
      ...data,
      id,
      status: 'pending',
      createdAt: now,
    };
    treasuryOpsStore.set(id, op);
    return op;
  }

  /**
   * Approve a pending treasury operation. The approver must be different
   * from the requester (4-eyes principle).
   */
  async approve(id: string, approvedBy: string): Promise<void> {
    this.ensureSeeded();
    const op = treasuryOpsStore.get(id);
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

  /** Execute an approved treasury operation. */
  async execute(id: string): Promise<void> {
    this.ensureSeeded();
    const op = treasuryOpsStore.get(id);
    if (!op) return;
    if (op.status !== 'approved') return;
    op.status = 'executed';
    op.executedAt = Date.now();
  }

  /** Mark an operation as failed (with a reason). */
  async fail(id: string, _reason: string): Promise<void> {
    this.ensureSeeded();
    const op = treasuryOpsStore.get(id);
    if (!op) return;
    op.status = 'failed';
  }

  /** Reverse an executed operation (with a reason). */
  async reverse(id: string, _reason: string): Promise<void> {
    this.ensureSeeded();
    const op = treasuryOpsStore.get(id);
    if (!op) return;
    if (op.status !== 'executed') return;
    op.status = 'reversed';
  }

  async list(filter?: TreasuryOpListFilter): Promise<TreasuryOperation[]> {
    this.ensureSeeded();
    const all = Array.from(treasuryOpsStore.values()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    if (!filter?.status && !filter?.type) return all;
    return all.filter(
      (op) =>
        (!filter.status || op.status === filter.status) &&
        (!filter.type || op.type === filter.type),
    );
  }

  /** All pending operations awaiting approval. */
  async getPending(): Promise<TreasuryOperation[]> {
    this.ensureSeeded();
    return Array.from(treasuryOpsStore.values())
      .filter((op) => op.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt);
  }
}

export const treasuryOps = new TreasuryOps();
