/**
 * MaintenanceManager — schedule and track maintenance windows.
 *
 * Backed by an in-memory store. Seeded with a couple of upcoming windows so
 * the dashboard always shows what's planned.
 */

import type { MaintenanceWindow } from './types';

function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const maintenanceStore = new Map<string, MaintenanceWindow>();

function seedMaintenance() {
  if (maintenanceStore.size > 0) return;
  const now = Date.now();
  const seed: MaintenanceWindow[] = [
    {
      id: rid('mw'),
      title: 'Routine DB vacuum',
      description:
        'Postgres VACUUM ANALYZE on the events table. No customer impact expected.',
      component: 'database',
      startAt: now + 2 * DAY_MS,
      endAt: now + 2 * DAY_MS + 30 * 60 * 1000,
      status: 'scheduled',
      impact: 'none',
      createdBy: 'platform-oncall',
    },
    {
      id: rid('mw'),
      title: 'Connector upgrade — MTN Ghana',
      description:
        'Upgrade the MTN Ghana momo connector to v2.3. Brief 5-min interruption possible.',
      component: 'connectors',
      startAt: now + 5 * DAY_MS,
      endAt: now + 5 * DAY_MS + 15 * 60 * 1000,
      status: 'scheduled',
      impact: 'minor',
      createdBy: 'platform-oncall',
    },
    {
      id: rid('mw'),
      title: 'Runtime kernel upgrade',
      description:
        'Rolling restart to pick up the new runtime kernel. Settlement queue will be paused for 2 minutes.',
      component: 'runtime',
      startAt: now + 7 * DAY_MS,
      endAt: now + 7 * DAY_MS + 10 * 60 * 1000,
      status: 'scheduled',
      impact: 'major',
      createdBy: 'platform-oncall',
    },
  ];
  for (const m of seed) maintenanceStore.set(m.id, m);
}

export type NewMaintenanceInput = Omit<
  MaintenanceWindow,
  'id' | 'status' | 'createdBy'
>;

export interface MaintenanceListFilter {
  status?: string;
  component?: string;
}

class MaintenanceManager {
  private ensureSeeded() {
    seedMaintenance();
  }

  /** Schedule a new maintenance window. */
  async schedule(
    data: NewMaintenanceInput,
    createdBy = 'platform-oncall',
  ): Promise<MaintenanceWindow> {
    this.ensureSeeded();
    const id = rid('mw');
    const now = Date.now();
    const window: MaintenanceWindow = {
      ...data,
      id,
      status: 'scheduled',
      createdBy,
      // If the window is already in progress, reflect that.
      ...(now >= data.startAt && now < data.endAt
        ? { status: 'in_progress' }
        : {}),
    };
    maintenanceStore.set(id, window);
    return window;
  }

  /** Start a scheduled maintenance window early or on time. */
  async start(id: string): Promise<void> {
    this.ensureSeeded();
    const m = maintenanceStore.get(id);
    if (!m) return;
    m.status = 'in_progress';
    m.startAt = Date.now();
  }

  /** Mark a maintenance window as completed. */
  async complete(id: string): Promise<void> {
    this.ensureSeeded();
    const m = maintenanceStore.get(id);
    if (!m) return;
    m.status = 'completed';
    m.endAt = Date.now();
  }

  /** Cancel a maintenance window. */
  async cancel(id: string, reason: string): Promise<void> {
    this.ensureSeeded();
    const m = maintenanceStore.get(id);
    if (!m) return;
    m.status = 'cancelled';
    // Stash the cancellation reason in the description (no separate column).
    m.description = `${m.description}\n\n[Cancelled: ${reason}]`;
  }

  /** List maintenance windows, optionally filtered. */
  async list(filter?: MaintenanceListFilter): Promise<MaintenanceWindow[]> {
    this.ensureSeeded();
    const all = Array.from(maintenanceStore.values()).sort(
      (a, b) => a.startAt - b.startAt,
    );
    if (!filter?.status && !filter?.component) return all;
    return all.filter(
      (m) =>
        (!filter.status || m.status === filter.status) &&
        (!filter.component || m.component === filter.component),
    );
  }

  /** Upcoming windows (start in the future, not yet started). */
  async getUpcoming(): Promise<MaintenanceWindow[]> {
    this.ensureSeeded();
    const now = Date.now();
    return Array.from(maintenanceStore.values())
      .filter((m) => m.status === 'scheduled' && m.startAt > now)
      .sort((a, b) => a.startAt - b.startAt);
  }

  /** Currently-active maintenance window (if any). */
  async getActive(): Promise<MaintenanceWindow | null> {
    this.ensureSeeded();
    const now = Date.now();
    for (const m of maintenanceStore.values()) {
      if (m.status === 'in_progress' && m.startAt <= now && now < m.endAt) {
        return m;
      }
    }
    return null;
  }
}

export const maintenanceManager = new MaintenanceManager();
