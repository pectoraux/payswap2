/**
 * M-RT-30: Bandwidth Engine — manages LP bandwidth positions.
 *
 * Bandwidth is a first-class runtime asset. LPs can provide:
 *   - Fiat bandwidth (via debit authorization: bank, MoMo, PSP)
 *   - Stablecoin bandwidth
 *   - Twin token bandwidth
 *
 * Bandwidth is NEVER represented as balances — it's capacity + reserved + used.
 */

import type { BandwidthPosition, BandwidthAssetType } from './policy-engine';
import { uid } from '@/runtime/types';

export class BandwidthEngine {
  private positions: Map<string, BandwidthPosition> = new Map();

  /**
   * Register a new bandwidth position for an LP.
   */
  register(
    lpId: string,
    country: string,
    assetType: BandwidthAssetType,
    currency: string,
    capacity: number,
    bond: number = 0,
    participationMode: 'automatic' | 'manual' = 'automatic',
  ): BandwidthPosition {
    const id = `${lpId}:${country}:${assetType}:${currency}`;
    const position: BandwidthPosition = {
      lpId,
      country,
      assetType,
      currency,
      capacity,
      reserved: 0,
      used: 0,
      available: capacity,
      escrow: 0,
      bond,
      status: 'active',
      participationMode,
    };
    this.positions.set(id, position);
    return position;
  }

  /**
   * Find available bandwidth matching criteria.
   */
  findAvailable(
    country: string,
    assetType: BandwidthAssetType,
    currency: string,
    minAmount: number,
  ): BandwidthPosition[] {
    return Array.from(this.positions.values()).filter(
      (p) =>
        p.country === country &&
        p.assetType === assetType &&
        p.currency === currency &&
        p.available >= minAmount &&
        p.status === 'active',
    );
  }

  /**
   * Reserve bandwidth for a settlement.
   */
  reserve(position: BandwidthPosition, amount: number): boolean {
    if (position.available < amount) return false;
    position.reserved += amount;
    position.available -= amount;
    return true;
  }

  /**
   * Release reserved bandwidth (settlement completed or cancelled).
   */
  release(position: BandwidthPosition, amount: number): void {
    position.reserved = Math.max(0, position.reserved - amount);
    position.available += amount;
  }

  /**
   * Consume reserved bandwidth (settlement executed).
   */
  consume(position: BandwidthPosition, amount: number): void {
    position.reserved = Math.max(0, position.reserved - amount);
    position.used += amount;
  }

  /**
   * Move bandwidth to escrow (automatic escrow rebalancing).
   */
  moveToEscrow(position: BandwidthPosition, amount: number): boolean {
    if (position.available < amount) return false;
    position.available -= amount;
    position.escrow += amount;
    return true;
  }

  /**
   * Slash bandwidth (escrow → bond → bandwidth order).
   * Never slash bandwidth directly unless escrow and bond are exhausted.
   */
  slash(position: BandwidthPosition, amount: number): { slashedFrom: string; amount: number }[] {
    const slashes: { slashedFrom: string; amount: number }[] = [];
    let remaining = amount;

    // 1. Slash escrow first
    if (position.escrow > 0 && remaining > 0) {
      const slashAmount = Math.min(position.escrow, remaining);
      position.escrow -= slashAmount;
      remaining -= slashAmount;
      slashes.push({ slashedFrom: 'escrow', amount: slashAmount });
    }

    // 2. Slash bond second
    if (position.bond > 0 && remaining > 0) {
      const slashAmount = Math.min(position.bond, remaining);
      position.bond -= slashAmount;
      remaining -= slashAmount;
      slashes.push({ slashedFrom: 'bond', amount: slashAmount });
    }

    // 3. Slash bandwidth last (only if escrow + bond exhausted)
    if (remaining > 0) {
      const slashAmount = Math.min(position.capacity - position.used, remaining);
      position.capacity -= slashAmount;
      remaining -= slashAmount;
      slashes.push({ slashedFrom: 'bandwidth', amount: slashAmount });
    }

    return slashes;
  }

  /**
   * Register debit authorization for fiat bandwidth.
   */
  authorizeDebit(
    position: BandwidthPosition,
    connector: 'stripe' | 'ach' | 'bank' | 'mobile_money',
    accountId: string,
  ): void {
    position.debitAuthorization = { connector, authorized: true, accountId };
  }

  /**
   * List all positions for an LP.
   */
  listForLp(lpId: string): BandwidthPosition[] {
    return Array.from(this.positions.values()).filter((p) => p.lpId === lpId);
  }

  /**
   * Get all positions (for admin/ops).
   */
  listAll(): BandwidthPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Automatic escrow rebalancing — if escrow is insufficient,
   * move part of available bandwidth into escrow.
   */
  autoRebalance(position: BandwidthPosition, requiredEscrow: number): boolean {
    if (position.escrow >= requiredEscrow) return true;
    const shortfall = requiredEscrow - position.escrow;
    if (position.available < shortfall) return false;
    return this.moveToEscrow(position, shortfall);
  }
}

export const bandwidthEngine = new BandwidthEngine();
