/**
 * InvestigationManager — formal investigations linked to incidents.
 *
 * Backed by an in-memory store. An investigation captures the findings of
 * a deeper dive into an incident or anomaly. Concluded investigations can
 * feed a postmortem.
 */

import type { OpsInvestigation } from './types';

function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const investigationStore = new Map<string, OpsInvestigation>();

function seedInvestigations() {
  if (investigationStore.size > 0) return;
  const now = Date.now();
  const seed: OpsInvestigation[] = [
    {
      id: rid('inv'),
      title: 'Settlement queue stall on 2024-03-12',
      description:
        'The settlement queue stalled for 18 minutes on 2024-03-12. Investigate the root cause and the recovery path.',
      status: 'concluded',
      findings:
        'A misconfigured connector retry policy caused a thundering-herd on the upstream rail. The retry storm saturated the connector pool and stalled the queue. Fix: cap concurrent retries at 10.',
      assignedTo: 'u-ops-amara',
      createdAt: now - 30 * 24 * 60 * 60 * 1000,
      concludedAt: now - 28 * 24 * 60 * 60 * 1000,
    },
    {
      id: rid('inv'),
      title: 'Treasury reserve drift in NGN corridor',
      description:
        'The NGN corridor reserve has drifted below the floor twice in the last week. Investigate whether the rebalance threshold needs adjustment.',
      status: 'in_progress',
      findings:
        'Preliminary: the rebalance threshold (10% below floor) is too tight given the corridor\'s volatility.',
      assignedTo: 'u-ops-kwame',
      createdAt: now - 3 * 24 * 60 * 60 * 1000,
    },
  ];
  for (const i of seed) investigationStore.set(i.id, i);
}

export type NewInvestigationInput = Omit<
  OpsInvestigation,
  'id' | 'createdAt' | 'status'
>;

export interface InvestigationListFilter {
  status?: string;
  assignedTo?: string;
}

class InvestigationManager {
  private ensureSeeded() {
    seedInvestigations();
  }

  async create(data: NewInvestigationInput): Promise<OpsInvestigation> {
    this.ensureSeeded();
    const id = rid('inv');
    const now = Date.now();
    const inv: OpsInvestigation = {
      ...data,
      id,
      status: 'open',
      createdAt: now,
    };
    investigationStore.set(id, inv);
    return inv;
  }

  async update(id: string, updates: Partial<OpsInvestigation>): Promise<void> {
    this.ensureSeeded();
    const existing = investigationStore.get(id);
    if (!existing) return;
    investigationStore.set(id, { ...existing, ...updates, id });
  }

  /**
   * Append a finding to the investigation. Findings are accumulated in the
   * `findings` field (newline-separated).
   */
  async addFinding(id: string, finding: string): Promise<void> {
    this.ensureSeeded();
    const existing = investigationStore.get(id);
    if (!existing) return;
    const updated: OpsInvestigation = {
      ...existing,
      findings: existing.findings
        ? `${existing.findings}\n\n---\n${finding}`
        : finding,
      status: existing.status === 'open' ? 'in_progress' : existing.status,
    };
    investigationStore.set(id, updated);
  }

  /** Conclude the investigation with final findings. */
  async conclude(id: string, findings: string): Promise<void> {
    this.ensureSeeded();
    const existing = investigationStore.get(id);
    if (!existing) return;
    investigationStore.set(id, {
      ...existing,
      status: 'concluded',
      findings,
      concludedAt: Date.now(),
    });
  }

  async list(
    filter?: InvestigationListFilter,
  ): Promise<OpsInvestigation[]> {
    this.ensureSeeded();
    const all = Array.from(investigationStore.values()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    if (!filter?.status && !filter?.assignedTo) return all;
    return all.filter(
      (i) =>
        (!filter.status || i.status === filter.status) &&
        (!filter.assignedTo || i.assignedTo === filter.assignedTo),
    );
  }
}

export const investigationManager = new InvestigationManager();
