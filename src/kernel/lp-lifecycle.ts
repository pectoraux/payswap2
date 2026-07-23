/**
 * LP Lifecycle Engine — Liquidity Providers as dynamic infrastructure actors.
 *
 * LPs are not static payment processors. They have a lifecycle: they join by
 * staking twin tokens, declare fees/capacity/corridors, can trade, withdraw,
 * restake, become inactive, become manual, or be suspended. Every lifecycle
 * transition is an auditable event that reconciles with the ledger.
 *
 * Smart Contract Interfaces (off-chain abstractions that mirror what would be
 * on-chain in production):
 *   - TwinToken contract: mint/burn/transfer/lock/unlock
 *   - LiquidityPool contract: stake/withdraw/claim
 *   - LPStake contract: stake position per LP
 *   - Treasury contract: deposit/withdraw/rebalance
 *   - Insurance contract: file/adjudicate/payout
 *   - Governance contract: propose/vote/execute
 *
 * Routing stays OFF-chain. Settlement proofs go ON-chain. This file models
 * the off-chain interfaces the kernel uses.
 */
import type { LiquidityProvider, CurrencyCode, TwinTokenRecord } from './types';
import { uid, round } from './support';
import { eventEngine } from './event';
import { EventCatalog } from './events';

export type LPLifecycleState =
  | 'active'
  | 'manual'
  | 'inactive'
  | 'suspended';

export interface LPStake {
  lpId: string;
  twinTokenAmount: number;
  stakedAt: number;
  slashingHistory: { amount: number; reason: string; ts: number }[];
}

export interface LPLifecycleEvent {
  id: string;
  lpId: string;
  action: 'mint' | 'stake' | 'trade' | 'withdraw' | 'restake' | 'suspend' | 'reactivate' | 'slash';
  amount?: number;
  ts: number;
  detail: string;
}

export class LPLifecycleEngine {
  private stakes: Map<string, LPStake> = new Map();
  private events: LPLifecycleEvent[] = [];
  private states: Map<string, LPLifecycleState> = new Map();

  /** LP joins by staking twin tokens (backing its liquidity provision). */
  stake(lp: LiquidityProvider, twinTokenAmount: number, frame: number): LPStake {
    const stake: LPStake = {
      lpId: lp.id,
      twinTokenAmount,
      stakedAt: Date.now(),
      slashingHistory: [],
    };
    this.stakes.set(lp.id, stake);
    this.states.set(lp.id, 'active');
    lp.twinTokenPosition = round(lp.twinTokenPosition + twinTokenAmount, 6);
    this.record(lp.id, 'stake', twinTokenAmount, frame, `Staked ${round(twinTokenAmount, 2)} twin tokens`);
    eventEngine.emit(EventCatalog.LPStaked, { lpId: lp.id, amount: twinTokenAmount, frame }, frame);
    return stake;
  }

  /** LP withdraws some of its stake (reducing capacity). */
  withdraw(lp: LiquidityProvider, amount: number, frame: number): void {
    const stake = this.stakes.get(lp.id);
    if (!stake || stake.twinTokenAmount < amount) return;
    stake.twinTokenAmount = round(stake.twinTokenAmount - amount, 6);
    lp.twinTokenPosition = round(lp.twinTokenPosition - amount, 6);
    lp.tradingCapacity = round(Math.max(0, lp.tradingCapacity - amount), 6);
    this.record(lp.id, 'withdraw', amount, frame, `Withdrew ${round(amount, 2)} twin tokens`);
    eventEngine.emit(EventCatalog.LPWithdrawn, { lpId: lp.id, amount, frame }, frame);
  }

  /** LP restakes (increasing capacity). */
  restake(lp: LiquidityProvider, amount: number, frame: number): void {
    const stake = this.stakes.get(lp.id);
    if (stake) stake.twinTokenAmount = round(stake.twinTokenAmount + amount, 6);
    lp.twinTokenPosition = round(lp.twinTokenPosition + amount, 6);
    lp.tradingCapacity = round(lp.tradingCapacity + amount, 6);
    this.record(lp.id, 'restake', amount, frame, `Restaked ${round(amount, 2)} twin tokens`);
    eventEngine.emit(EventCatalog.LPRestaked, { lpId: lp.id, amount, frame }, frame);
  }

  /** LP is suspended (e.g. after a failed insurance claim or compliance issue). */
  suspend(lp: LiquidityProvider, reason: string, frame: number): void {
    this.states.set(lp.id, 'suspended');
    lp.online = false;
    this.record(lp.id, 'suspend', undefined, frame, `Suspended: ${reason}`);
    eventEngine.emit(EventCatalog.LPSuspended, { lpId: lp.id, reason, frame }, frame);
  }

  /** LP is reactivated. */
  reactivate(lp: LiquidityProvider, frame: number): void {
    this.states.set(lp.id, 'active');
    lp.online = true;
    this.record(lp.id, 'reactivate', undefined, frame, 'Reactivated');
    eventEngine.emit(EventCatalog.LPReactivated, { lpId: lp.id, frame }, frame);
  }

  /** LP is set to manual-only mode. */
  setManual(lp: LiquidityProvider, frame: number): void {
    this.states.set(lp.id, 'manual');
    lp.manualOnly = true;
    this.record(lp.id, 'trade', undefined, frame, 'Switched to manual settlement mode');
  }

  /** Slash an LP's stake (e.g. after insurance claim denial). */
  slash(lp: LiquidityProvider, amount: number, reason: string, frame: number): void {
    const stake = this.stakes.get(lp.id);
    if (stake) {
      stake.twinTokenAmount = round(Math.max(0, stake.twinTokenAmount - amount), 6);
      stake.slashingHistory.push({ amount, reason, ts: Date.now() });
    }
    lp.twinTokenPosition = round(Math.max(0, lp.twinTokenPosition - amount), 6);
    this.record(lp.id, 'slash', amount, frame, `Slashed ${round(amount, 2)}: ${reason}`);
  }

  getState(lpId: string): LPLifecycleState {
    return this.states.get(lpId) ?? 'inactive';
  }

  getStake(lpId: string): LPStake | undefined {
    return this.stakes.get(lpId);
  }

  allEvents(): LPLifecycleEvent[] {
    return [...this.events];
  }

  reset(): void {
    this.stakes.clear();
    this.events = [];
    this.states.clear();
  }

  private record(lpId: string, action: LPLifecycleEvent['action'], amount: number | undefined, frame: number, detail: string): void {
    this.events.push({ id: uid('lpl'), lpId, action, amount, ts: Date.now(), detail });
  }
}

export const lpLifecycle = new LPLifecycleEngine();

/* -------------------------------------------------------------------------- */
/* Smart Contract Interfaces (off-chain abstractions)                         */
/* -------------------------------------------------------------------------- */

/**
 * Twin Token Contract — mint/burn/transfer/lock/unlock.
 * Every operation must reconcile with the ledger. Never allow unbacked supply.
 */
export interface TwinTokenContract {
  mint(amount: number, currency: CurrencyCode, fromCountry: string, toCountry: string, frame: number): TwinTokenRecord;
  burn(token: TwinTokenRecord, frame: number): TwinTokenRecord;
  transfer(token: TwinTokenRecord, frame: number): TwinTokenRecord;
  lock(token: TwinTokenRecord, amount: number, frame: number): TwinTokenRecord;
  unlock(token: TwinTokenRecord, amount: number, frame: number): TwinTokenRecord;
}

/**
 * Liquidity Pool Contract — stake/withdraw/claim.
 * LPs stake twin tokens to back their liquidity provision.
 */
export interface LiquidityPoolContract {
  stake(lp: LiquidityProvider, amount: number, frame: number): LPStake;
  withdraw(lp: LiquidityProvider, amount: number, frame: number): void;
  claim(lpId: string, amount: number, frame: number): boolean;
}

/**
 * Treasury Contract — deposit/withdraw/rebalance.
 * Autonomous treasury optimization within policy constraints.
 */
export interface TreasuryContract {
  deposit(currency: CurrencyCode, amount: number, frame: number): void;
  withdraw(currency: CurrencyCode, amount: number, frame: number): boolean;
  rebalance(from: CurrencyCode, to: CurrencyCode, amount: number, frame: number): void;
}

/**
 * Insurance Contract — file/adjudicate/payout.
 * Claims produce immutable decisions with evidence + governance.
 */
export interface InsuranceContract {
  file(amount: number, currency: CurrencyCode, reason: string, frame: number): import('./types').InsuranceClaim;
  adjudicate(claim: import('./types').InsuranceClaim, frame: number, approves: boolean): import('./types').InsuranceClaim;
  payout(claim: import('./types').InsuranceClaim, frame: number): boolean;
}

/**
 * Governance Contract — propose/vote/execute.
 * Community + PaySwap weighted voting on insurance claims and policy changes.
 */
export interface GovernanceContract {
  propose(type: string, payload: Record<string, unknown>, frame: number): string;
  vote(proposalId: string, voter: string, weight: number, approves: boolean, frame: number): void;
  execute(proposalId: string, frame: number): boolean;
}
