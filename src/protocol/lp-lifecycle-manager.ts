/**
 * PaySwap Protocol — LP Lifecycle Module.
 *
 * LP lifecycle: invited → pending → active → (paused | draining → withdraw_requested → exited | suspended → slashed)
 *
 * LPs register, stake Twin Tokens, provide settlement capacity, and can
 * withdraw. Their authorized exposure is dynamic — computed from collateral,
 * capacity, evidence, reputation, and protocol state.
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { settlementCapacityVault } from './settlement/capacity-vault';
import { collateralVault } from './settlement/collateral-vault';
import { computeAuthorizedExposure, defaultExposureFactors, type ExposureFactors } from './economics/authorized-exposure';

export type LPLifecycleState =
  | 'invited'
  | 'pending'
  | 'active'
  | 'paused'
  | 'draining'
  | 'withdraw_requested'
  | 'exited'
  | 'suspended'
  | 'slashed';

export interface LPRecord {
  id: string;
  name: string;
  country: string;
  currency: string;
  state: LPLifecycleState;
  stakeIds: string[];
  collateralIds: string[];
  authorizedExposure: number;
  currentExposure: number;
  reputation: number;
  tier: string;
  manualOnly: boolean;
  registeredAt: number;
  history: { from: LPLifecycleState; to: LPLifecycleState; action: string; ts: number; reason: string }[];
}

const ALLOWED: Record<LPLifecycleState, string[]> = {
  invited: ['apply'],
  pending: ['activate', 'reject'],
  active: ['pause', 'drain', 'suspend', 'set_manual', 'set_auto'],
  paused: ['resume', 'drain', 'suspend'],
  draining: ['request_withdraw', 'suspend'],
  withdraw_requested: ['exit', 'suspend'],
  exited: [],
  suspended: ['reactivate', 'slash'],
  slashed: [],
};

export class LPLifecycle {
  private lps: Map<string, LPRecord> = new Map();

  /** Invite an LP. */
  invite(id: string, name: string, country: string, currency: string): LPRecord {
    const lp: LPRecord = {
      id, name, country, currency,
      state: 'invited',
      stakeIds: [], collateralIds: [],
      authorizedExposure: 0, currentExposure: 0,
      reputation: 0.5, tier: 'probationary',
      manualOnly: false,
      registeredAt: Date.now(),
      history: [],
    };
    this.lps.set(id, lp);
    eventEngine.emit('lp.invited', { lpId: id, name, country }, 0);
    return lp;
  }

  /** LP applies (moves from invited to pending). */
  apply(lpId: string): LPRecord | null {
    return this.transition(lpId, 'pending', 'apply', 'LP submitted application');
  }

  /** Activate LP (from pending). Requires stake + collateral. */
  activate(lpId: string, stakeAmount: number, collateralAmount: number): LPRecord | null {
    const lp = this.lps.get(lpId);
    if (!lp || !ALLOWED[lp.state]?.includes('activate')) return null;

    // Stake Twin Tokens
    const stake = settlementCapacityVault.stake(lpId, stakeAmount, lp.currency);
    lp.stakeIds.push(stake.id);

    // Lock collateral
    const collateral = collateralVault.lock(lpId, collateralAmount, lp.currency);
    lp.collateralIds.push(collateral.id);

    // Compute initial exposure
    lp.authorizedExposure = this.computeExposure(lpId);

    return this.transition(lpId, 'active', 'activate', `Activated with stake ${stakeAmount} + collateral ${collateralAmount}`);
  }

  /** Pause LP (temporarily stop serving). */
  pause(lpId: string): LPRecord | null {
    return this.transition(lpId, 'paused', 'pause', 'LP paused');
  }

  /** Resume LP. */
  resume(lpId: string): LPRecord | null {
    return this.transition(lpId, 'active', 'resume', 'LP resumed');
  }

  /** Start draining (LP wants to exit). */
  drain(lpId: string): LPRecord | null {
    return this.transition(lpId, 'draining', 'drain', 'LP started draining');
  }

  /** Request withdrawal (from draining). */
  requestWithdraw(lpId: string): LPRecord | null {
    return this.transition(lpId, 'withdraw_requested', 'request_withdraw', 'LP requested withdrawal');
  }

  /** Complete exit. */
  exit(lpId: string): LPRecord | null {
    const lp = this.lps.get(lpId);
    if (!lp || !ALLOWED[lp.state]?.includes('exit')) return null;
    // Unstake all positions
    for (const stakeId of lp.stakeIds) {
      settlementCapacityVault.unstake(stakeId);
    }
    // Release collateral
    for (const collateralId of lp.collateralIds) {
      collateralVault.release(collateralId);
    }
    lp.authorizedExposure = 0;
    return this.transition(lpId, 'exited', 'exit', 'LP exited');
  }

  /** Suspend LP (protocol action — fraud, compliance, etc.). */
  suspend(lpId: string, reason: string): LPRecord | null {
    return this.transition(lpId, 'suspended', 'suspend', `Suspended: ${reason}`);
  }

  /** Reactivate LP. */
  reactivate(lpId: string): LPRecord | null {
    return this.transition(lpId, 'active', 'reactivate', 'LP reactivated');
  }

  /** Slash LP (after adjudication). */
  slash(lpId: string, reason: string): LPRecord | null {
    const lp = this.lps.get(lpId);
    if (!lp || !ALLOWED[lp.state]?.includes('slash')) return null;
    // Slash all collateral
    for (const collateralId of lp.collateralIds) {
      const collateral = collateralVault.get(collateralId);
      if (collateral) collateralVault.slash(collateralId, collateral.remainingAmount, reason);
    }
    lp.authorizedExposure = 0;
    lp.reputation = 0;
    lp.tier = 'slashed';
    return this.transition(lpId, 'slashed', 'slash', `Slashed: ${reason}`);
  }

  /** Set LP to manual-only mode. */
  setManual(lpId: string): LPRecord | null {
    const lp = this.lps.get(lpId);
    if (!lp) return null;
    lp.manualOnly = true;
    return this.transition(lpId, lp.state, 'set_manual', 'Switched to manual settlement', lp.state);
  }

  /** Set LP to automatic mode. */
  setAuto(lpId: string): LPRecord | null {
    const lp = this.lps.get(lpId);
    if (!lp) return null;
    lp.manualOnly = false;
    return this.transition(lpId, lp.state, 'set_auto', 'Switched to automatic settlement', lp.state);
  }

  /** Update exposure (called after events change). */
  updateExposure(lpId: string, factors: Partial<ExposureFactors>): LPRecord | null {
    const lp = this.lps.get(lpId);
    if (!lp) return null;
    const stakeCapacity = settlementCapacityVault.capacityByLp(lpId, lp.currency);
    const collateralAmount = collateralVault.totalLockedByLp(lpId);
    const baseFactors = defaultExposureFactors(collateralAmount, stakeCapacity);
    const merged = { ...baseFactors, ...factors };
    lp.authorizedExposure = computeAuthorizedExposure(merged);
    lp.tier = lp.reputation > 0.8 ? 'premium' : lp.reputation > 0.6 ? 'trusted' : lp.reputation > 0.3 ? 'standard' : 'probationary';
    return lp;
  }

  /** Update reputation (from event projection). */
  updateReputation(lpId: string, reputation: number): LPRecord | null {
    const lp = this.lps.get(lpId);
    if (!lp) return null;
    lp.reputation = Math.max(0, Math.min(1, reputation));
    lp.tier = lp.reputation > 0.8 ? 'premium' : lp.reputation > 0.6 ? 'trusted' : lp.reputation > 0.3 ? 'standard' : 'probationary';
    // Recompute exposure with new reputation
    this.updateExposure(lpId, { protocolReputation: lp.reputation });
    return lp;
  }

  /** Reserve exposure for a transaction. */
  reserveExposure(lpId: string, amount: number): boolean {
    const lp = this.lps.get(lpId);
    if (!lp || lp.state !== 'active') return false;
    if (lp.currentExposure + amount > lp.authorizedExposure) return false;
    lp.currentExposure = round(lp.currentExposure + amount, 6);
    return true;
  }

  /** Release exposure (after settlement or cancellation). */
  releaseExposure(lpId: string, amount: number): void {
    const lp = this.lps.get(lpId);
    if (!lp) return;
    lp.currentExposure = round(Math.max(0, lp.currentExposure - amount), 6);
  }

  get(lpId: string): LPRecord | undefined { return this.lps.get(lpId); }
  all(): LPRecord[] { return [...this.lps.values()]; }
  active(): LPRecord[] { return this.all().filter((lp) => lp.state === 'active'); }

  private computeExposure(lpId: string): number {
    const lp = this.lps.get(lpId);
    if (!lp) return 0;
    const stakeCapacity = settlementCapacityVault.capacityByLp(lpId, lp.currency);
    const collateralAmount = collateralVault.totalLockedByLp(lpId);
    return computeAuthorizedExposure(defaultExposureFactors(collateralAmount, stakeCapacity));
  }

  private transition(lpId: string, toState: LPLifecycleState, action: string, reason: string, fromStateOverride?: LPLifecycleState): LPRecord | null {
    const lp = this.lps.get(lpId);
    if (!lp) return null;
    const fromState = fromStateOverride ?? lp.state;
    if (!ALLOWED[fromState]?.includes(action)) return null;
    lp.state = toState;
    lp.history.push({ from: fromState, to: toState, action, ts: Date.now(), reason });
    eventEngine.emit(`lp.${action}`, { lpId, from: fromState, to: toState, reason }, 0);
    return lp;
  }

  reset(): void { this.lps.clear(); }
}

export const lpLifecycle = new LPLifecycle();
