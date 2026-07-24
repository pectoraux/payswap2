/**
 * PaySwap Protocol — Settlement Capacity Vault (formerly Liquidity Pool).
 *
 * LPs don't lend money to the protocol. They stake Twin Tokens to collateralize
 * settlement capacity. The protocol purchases settlement bandwidth, not liquidity.
 *
 * LPs are not providing cash — they're providing settlement capacity.
 * Twin Tokens lock economic security.
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';

export interface StakePosition {
  id: string;
  lpId: string;
  amount: number;
  currency: string;
  stakedAt: number;
  unstakedAt: number | null;
  yieldAccrued: number;
  feeDistribution: number;
  governanceWeight: number;
}

export class SettlementCapacityVault {
  private stakes: Map<string, StakePosition> = new Map();

  /** LP stakes Twin Tokens to provide settlement capacity. */
  stake(lpId: string, amount: number, currency: string): StakePosition {
    const position: StakePosition = {
      id: uid('stake'),
      lpId, amount, currency,
      stakedAt: Date.now(),
      unstakedAt: null,
      yieldAccrued: 0,
      feeDistribution: 0,
      governanceWeight: amount, // 1 token = 1 governance vote
    };
    this.stakes.set(position.id, position);
    eventEngine.emit('capacity.staked', { stakeId: position.id, lpId, amount, currency }, 0);
    return position;
  }

  /** LP withdraws stake (unstakes). */
  unstake(stakeId: string): StakePosition | null {
    const position = this.stakes.get(stakeId);
    if (!position || position.unstakedAt !== null) return null;
    position.unstakedAt = Date.now();
    eventEngine.emit('capacity.unstaked', { stakeId, lpId: position.lpId, amount: position.amount }, 0);
    return position;
  }

  /** Rebalance — redistribute stake across corridors. */
  rebalance(stakeId: string, newAmount: number): StakePosition | null {
    const position = this.stakes.get(stakeId);
    if (!position || position.unstakedAt !== null) return null;
    const oldAmount = position.amount;
    position.amount = round(newAmount, 6);
    position.governanceWeight = newAmount;
    eventEngine.emit('capacity.rebalanced', { stakeId, lpId: position.lpId, oldAmount, newAmount }, 0);
    return position;
  }

  /** Distribute fees to stakers (pro-rata). */
  distributeFees(currency: string, totalFees: number): { stakeId: string; lpId: string; amount: number }[] {
    const activeStakes = [...this.stakes.values()].filter((s) => s.unstakedAt === null && s.currency === currency);
    const totalStaked = activeStakes.reduce((sum, s) => sum + s.amount, 0);
    if (totalStaked === 0) return [];

    const distributions: { stakeId: string; lpId: string; amount: number }[] = [];
    for (const stake of activeStakes) {
      const share = round((stake.amount / totalStaked) * totalFees, 6);
      stake.feeDistribution = round(stake.feeDistribution + share, 6);
      stake.yieldAccrued = round(stake.yieldAccrued + share, 6);
      distributions.push({ stakeId: stake.id, lpId: stake.lpId, amount: share });
    }
    eventEngine.emit('capacity.fees_distributed', { currency, totalFees, recipientCount: distributions.length }, 0);
    return distributions;
  }

  /** Total staked capacity for a currency. */
  totalCapacity(currency: string): number {
    return [...this.stakes.values()]
      .filter((s) => s.unstakedAt === null && s.currency === currency)
      .reduce((sum, s) => sum + s.amount, 0);
  }

  /** Total staked capacity for an LP. */
  capacityByLp(lpId: string, currency?: string): number {
    return [...this.stakes.values()]
      .filter((s) => s.unstakedAt === null && s.lpId === lpId && (!currency || s.currency === currency))
      .reduce((sum, s) => sum + s.amount, 0);
  }

  /** Active stakes by LP. */
  stakesByLp(lpId: string): StakePosition[] {
    return [...this.stakes.values()].filter((s) => s.lpId === lpId && s.unstakedAt === null);
  }

  /** All active stakes. */
  activeStakes(): StakePosition[] {
    return [...this.stakes.values()].filter((s) => s.unstakedAt === null);
  }

  all(): StakePosition[] { return [...this.stakes.values()]; }

  reset(): void { this.stakes.clear(); }
}

export const settlementCapacityVault = new SettlementCapacityVault();
