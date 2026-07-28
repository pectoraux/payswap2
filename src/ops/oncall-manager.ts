/**
 * OnCallManager — current on-call roster + schedule.
 *
 * Backed by an in-memory store. Seeded with a default rotation so the
 * dashboard always shows someone on-call. Real implementations would
 * sync this with PagerDuty / OpsGenie.
 */

import type { OnCallSchedule } from './types';

function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Seed ──────────────────────────────────────────────────────────────────

const SEED_USERS = [
  { userId: 'u-ops-amara', userName: 'Amara Okafor', role: 'primary' as const },
  { userId: 'u-ops-kwame', userName: 'Kwame Mensah', role: 'secondary' as const },
  { userId: 'u-ops-zara', userName: 'Zara Bello', role: 'manager' as const },
];

const scheduleStore = new Map<string, OnCallSchedule>();

function seedSchedule() {
  if (scheduleStore.size > 0) return;
  const now = Date.now();
  // Current week (7-day rotation starting today).
  for (const u of SEED_USERS) {
    const id = rid('oncall');
    scheduleStore.set(id, {
      id,
      userId: u.userId,
      userName: u.userName,
      role: u.role,
      startAt: now,
      endAt: now + 7 * DAY_MS,
      isActive: true,
    });
  }
  // Next week (rotation: primary → secondary, etc.).
  const nextWeek = now + 7 * DAY_MS;
  const rotated = [SEED_USERS[1], SEED_USERS[0], SEED_USERS[2]];
  for (const u of rotated) {
    const id = rid('oncall');
    scheduleStore.set(id, {
      id,
      userId: u.userId,
      userName: u.userName,
      role: u.role,
      startAt: nextWeek,
      endAt: nextWeek + 7 * DAY_MS,
      isActive: false,
    });
  }
}

export type OnCallRole = 'primary' | 'secondary' | 'manager';

export interface AssignOnCallInput {
  userId: string;
  userName?: string;
  role: string;
  startAt: number;
  endAt: number;
}

class OnCallManager {
  private ensureSeeded() {
    seedSchedule();
  }

  /** Get the current on-call schedule for a specific role. */
  async getCurrent(role: OnCallRole): Promise<OnCallSchedule | null> {
    this.ensureSeeded();
    const now = Date.now();
    for (const s of scheduleStore.values()) {
      if (s.role === role && s.startAt <= now && now < s.endAt) {
        return s;
      }
    }
    return null;
  }

  /** Get the schedule entries that overlap the [from, to] range. */
  async getSchedule(from: number, to: number): Promise<OnCallSchedule[]> {
    this.ensureSeeded();
    return Array.from(scheduleStore.values())
      .filter((s) => s.startAt < to && s.endAt > from)
      .sort((a, b) => a.startAt - b.startAt);
  }

  /** Assign a user to an on-call shift. Deactivates any conflicting shift. */
  async assign(
    userId: string,
    role: string,
    startAt: number,
    endAt: number,
    userName?: string,
  ): Promise<OnCallSchedule> {
    this.ensureSeeded();
    // Deactivate any overlapping shift for the same role.
    for (const s of scheduleStore.values()) {
      if (
        s.role === role &&
        s.startAt < endAt &&
        s.endAt > startAt
      ) {
        s.isActive = false;
      }
    }
    const id = rid('oncall');
    const now = Date.now();
    const schedule: OnCallSchedule = {
      id,
      userId,
      userName: userName ?? userId,
      role: role as OnCallRole,
      startAt,
      endAt,
      isActive: now >= startAt && now < endAt,
    };
    scheduleStore.set(id, schedule);
    return schedule;
  }

  /**
   * Swap two shifts. The two operators exchange start/end times but keep
   * their respective roles.
   */
  async swap(scheduleId1: string, scheduleId2: string): Promise<void> {
    this.ensureSeeded();
    const a = scheduleStore.get(scheduleId1);
    const b = scheduleStore.get(scheduleId2);
    if (!a || !b) return;
    const aStart = a.startAt;
    const aEnd = a.endAt;
    a.startAt = b.startAt;
    a.endAt = b.endAt;
    b.startAt = aStart;
    b.endAt = aEnd;
    const now = Date.now();
    a.isActive = now >= a.startAt && now < a.endAt;
    b.isActive = now >= b.startAt && now < b.endAt;
  }

  /** Get the full active roster (primary + secondary + manager). */
  async getActiveRoster(): Promise<{
    primary?: OnCallSchedule;
    secondary?: OnCallSchedule;
    manager?: OnCallSchedule;
  }> {
    this.ensureSeeded();
    const [primary, secondary, manager] = await Promise.all([
      this.getCurrent('primary'),
      this.getCurrent('secondary'),
      this.getCurrent('manager'),
    ]);
    return { primary: primary ?? undefined, secondary: secondary ?? undefined, manager: manager ?? undefined };
  }
}

export const onCallManager = new OnCallManager();
