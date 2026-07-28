/**
 * Treasury Emergency Freeze Store — in-memory store for emergency freezes
 * covering the four new target types: country, corridor, reserve, wallet.
 *
 * (Task FEATURES-1.)
 *
 * This complements (does NOT replace) the existing EmergencyFreezeEngine in
 * `src/protocol/treasury-v2/freezes.ts`, which already handles the original
 * three scopes (account, asset, corridor). The Treasury Console needed a
 * richer set of target types — specifically country, reserve, wallet, and
 * corridor (the corridor handling is duplicated so the freeze UI can use a
 * single backend endpoint). We keep them in a separate store to avoid
 * touching the frozen `src/runtime/` and the existing protocol freeze engine.
 *
 * Records live on `globalThis.__PAYSWAP_TREASURY_EMERGENCY_STORE__` so dev-mode
 * module re-instantiation does not lose data.
 */

import { uid } from '@/runtime/types';

// ─── Types ─────────────────────────────────────────────────────────────────

export type EmergencyTarget =
  | 'country'
  | 'corridor'
  | 'reserve'
  | 'wallet';

export type FreezeStatus = 'active' | 'lifted' | 'expired';

export interface EmergencyFreezeRecord {
  id: string;
  /** What kind of target is frozen. */
  target: EmergencyTarget;
  /** Identifier of the frozen target (e.g. "NG" for country, "GHS→KES" for corridor). */
  targetId: string;
  /** Human-readable reason for the freeze (audited). */
  reason: string;
  /** ISO timestamp (ms) when the freeze was created. */
  frozenAt: number;
  /** ISO timestamp (ms) when the freeze will auto-lift (optional). */
  expiresAt?: number;
  /** Duration in ms the freeze was created with (for display). */
  durationMs?: number;
  /** Current status. */
  status: FreezeStatus;
  /** ISO timestamp (ms) when the freeze was lifted (if lifted). */
  liftedAt?: number;
  /** Who lifted the freeze. */
  liftedBy?: string;
  /** User ID of the actor who issued the freeze. */
  initiatedByUserId?: string;
  /** Email of the actor who issued the freeze. */
  initiatedByEmail?: string;
}

// ─── Store shape ─────────────────────────────────────────────────────────────

export interface TreasuryEmergencyStore {
  freezes: Map<string, EmergencyFreezeRecord>;
}

function createStore(): TreasuryEmergencyStore {
  return { freezes: new Map() };
}

const globalForTreasuryEmergency = globalThis as unknown as {
  __PAYSWAP_TREASURY_EMERGENCY_STORE__?: TreasuryEmergencyStore;
  __PAYSWAP_TREASURY_EMERGENCY_SEEDED__?: boolean;
};

export const store: TreasuryEmergencyStore =
  globalForTreasuryEmergency.__PAYSWAP_TREASURY_EMERGENCY_STORE__ ?? createStore();

if (!globalForTreasuryEmergency.__PAYSWAP_TREASURY_EMERGENCY_STORE__) {
  globalForTreasuryEmergency.__PAYSWAP_TREASURY_EMERGENCY_STORE__ = store;
}

// ─── Seed ─────────────────────────────────────────────────────────────────
//
// Seed a couple of pre-existing freezes so the Treasury Emergency page has
// visible content on first load.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function isoIn(msFromNow: number): number {
  return Date.now() + msFromNow;
}
function isoAgo(msAgo: number): number {
  return Date.now() - msAgo;
}

export function seedTreasuryEmergencyStore(): void {
  if (globalForTreasuryEmergency.__PAYSWAP_TREASURY_EMERGENCY_SEEDED__) return;
  globalForTreasuryEmergency.__PAYSWAP_TREASURY_EMERGENCY_SEEDED__ = true;

  const seeds: EmergencyFreezeRecord[] = [
    {
      id: uid('efz'),
      target: 'country',
      targetId: 'NG',
      reason:
        'Regulatory hold — pending CBAN sanctions review on Nigerian Naira flows',
      frozenAt: isoAgo(2 * HOUR),
      expiresAt: isoIn(46 * HOUR),
      durationMs: 2 * DAY,
      status: 'active',
      initiatedByEmail: 'treasury@payswap.io',
    },
    {
      id: uid('efz'),
      target: 'corridor',
      targetId: 'GHS→NGN',
      reason:
        'Excessive settlement failures on GHS→NGN corridor over last 24h — paused pending root-cause analysis',
      frozenAt: isoAgo(5 * HOUR),
      status: 'active',
      initiatedByEmail: 'treasury@payswap.io',
    },
    {
      id: uid('efz'),
      target: 'reserve',
      targetId: 'reserve-kes-1',
      reason:
        'KES reserve threshold breached — frozen until treasury rebalancing completes',
      frozenAt: isoAgo(30 * 60 * 1000),
      expiresAt: isoIn(90 * 60 * 1000),
      durationMs: 2 * HOUR,
      status: 'active',
      initiatedByEmail: 'admin@payswap.io',
    },
  ];
  for (const s of seeds) store.freezes.set(s.id, s);
}

// Auto-seed on first import.
seedTreasuryEmergencyStore();

// ─── Service ─────────────────────────────────────────────────────────────────

export interface CreateFreezeInput {
  target: EmergencyTarget;
  targetId: string;
  reason: string;
  duration?: number; // ms
  initiatedByUserId?: string;
  initiatedByEmail?: string;
}

export interface TreasuryEmergencyService {
  list(filter?: { status?: FreezeStatus; target?: EmergencyTarget }): EmergencyFreezeRecord[];
  listActive(): EmergencyFreezeRecord[];
  get(id: string): EmergencyFreezeRecord | null;
  freeze(input: CreateFreezeInput): EmergencyFreezeRecord;
  unfreeze(
    id: string,
    liftedBy?: string,
  ): EmergencyFreezeRecord | null;
  isFrozen(target: EmergencyTarget, targetId: string): boolean;
}

export const treasuryEmergencyService: TreasuryEmergencyService = {
  list(filter) {
    let rows = Array.from(store.freezes.values());
    if (filter?.status) rows = rows.filter((f) => f.status === filter.status);
    if (filter?.target) rows = rows.filter((f) => f.target === filter.target);
    return rows.sort((a, b) => b.frozenAt - a.frozenAt);
  },

  listActive() {
    const now = Date.now();
    return Array.from(store.freezes.values())
      .filter(
        (f) =>
          f.status === 'active' &&
          (f.expiresAt === undefined || f.expiresAt > now),
      )
      .sort((a, b) => b.frozenAt - a.frozenAt);
  },

  get(id) {
    return store.freezes.get(id) ?? null;
  },

  freeze(input) {
    const now = Date.now();
    const record: EmergencyFreezeRecord = {
      id: uid('efz'),
      target: input.target,
      targetId: input.targetId,
      reason: input.reason,
      frozenAt: now,
      expiresAt: input.duration ? now + input.duration : undefined,
      durationMs: input.duration,
      status: 'active',
      initiatedByUserId: input.initiatedByUserId,
      initiatedByEmail: input.initiatedByEmail,
    };
    store.freezes.set(record.id, record);
    return record;
  },

  unfreeze(id, liftedBy) {
    const f = store.freezes.get(id);
    if (!f) return null;
    if (f.status === 'lifted') return f;
    const updated: EmergencyFreezeRecord = {
      ...f,
      status: 'lifted',
      liftedAt: Date.now(),
      liftedBy,
    };
    store.freezes.set(id, updated);
    return updated;
  },

  isFrozen(target, targetId) {
    const now = Date.now();
    return Array.from(store.freezes.values()).some(
      (f) =>
        f.target === target &&
        f.targetId === targetId &&
        f.status === 'active' &&
        (f.expiresAt === undefined || f.expiresAt > now),
    );
  },
};

// ─── Country / reserve / wallet target suggestions ──────────────────────────
//
// Pre-baked suggestion lists for the freeze-form dropdowns so the treasury
// operator doesn't have to memorize country codes or reserve IDs.

export const COUNTRY_OPTIONS: Array<{ code: string; name: string }> = [
  { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'UG', name: 'Uganda' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'EG', name: 'Egypt' },
];

export const CORRIDOR_OPTIONS: string[] = [
  'GHS→KES',
  'KES→GHS',
  'GHS→NGN',
  'NGN→KES',
  'KES→UGX',
  'UGX→KES',
  'NGN→GHS',
  'GHS→USD',
  'KES→USD',
  'NGN→USD',
];

export const RESERVE_OPTIONS: string[] = [
  'reserve-usd-1',
  'reserve-ghs-1',
  'reserve-kes-1',
  'reserve-ngn-1',
  'reserve-ugx-1',
];

export const WALLET_OPTIONS: string[] = [
  'wallet-treasury-hot-1',
  'wallet-treasury-cold-1',
  'wallet-settlement-1',
  'wallet-lp-collateral-1',
  'wallet-refund-escrow-1',
];
