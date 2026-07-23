/**
 * Liquidity Engine — manages Liquidity Providers (LPs) that bridge reserves.
 *
 * When a reserve cannot self-fund a payment (e.g. the destination needs
 * outbound value the local reserve lacks), the kernel draws liquidity from
 * registered LPs. Each LP advertises a capacity, a fee rate and a settlement
 * speed. The Routing Engine selects LPs according to the merchant's
 * preference; this engine executes the draw and tracks remaining capacity.
 */
import type { LiquidityProviderConfig, CurrencyCode, WorldState } from './types';
import { eventEngine } from './event';

export interface LiquidityDraw {
  lpId: string;
  amount: number;
  frame: number;
}

export interface LiquidityDrawResult {
  lpId: string;
  drawn: number;
  fee: number;
  rate: number;
  exhausted: boolean;
  remaining: number;
}

export class LiquidityEngine {
  constructor(private world: WorldState) {}

  providers(country?: string): LiquidityProviderConfig[] {
    return this.world.liquidityProviders.filter((lp) => !country || lp.country === country);
  }

  find(lpId: string): LiquidityProviderConfig | undefined {
    return this.world.liquidityProviders.find((lp) => lp.id === lpId);
  }

  /** Draw `amount` from a single LP, clamped to remaining capacity. Returns actual drawn + fee. */
  draw(draw: LiquidityDraw): LiquidityDrawResult {
    const lp = this.find(draw.lpId);
    if (!lp) throw new Error(`Unknown LP: ${draw.lpId}`);
    const drawn = Math.min(draw.amount, lp.capacity);
    const fee = Math.round(drawn * lp.rate * 100) / 1e4; // rate is percent
    lp.capacity = Math.round((lp.capacity - drawn) * 1e6) / 1e6;
    const exhausted = lp.capacity <= 0;
    eventEngine.emit(
      'lp.consumed',
      { lpId: lp.id, drawn, fee, remaining: lp.capacity, exhausted, frame: draw.frame },
      draw.frame,
    );
    return { lpId: lp.id, drawn, fee, rate: lp.rate, exhausted, remaining: lp.capacity };
  }
}
