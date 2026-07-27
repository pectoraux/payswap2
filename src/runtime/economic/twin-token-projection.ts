/**
 * Twin Token Projection — rebuilds token positions from events.
 * (M-RT-25, Economic Kernel.)
 *
 * Maintains a map of (accountId, tokenType, currency) → TwinTokenPosition.
 * Balances are DERIVED:
 *   balance = minted - burned + transferredIn - transferredOut + convertedIn - convertedOut
 *   backedAmount = backed - unbacked
 */

import type { StoredEvent } from '../events';
import type { TwinTokenPosition, TokenType, TwinTokenQuery, TwinTokenView } from './twin-token-types';

interface PositionKey {
  accountId: string;
  tokenType: TokenType;
  currency: string;
}

function posKey(accountId: string, tokenType: TokenType, currency: string): string {
  return `${accountId}:${tokenType}:${currency}`;
}

export class TwinTokenProjection {
  private readonly positions = new Map<string, TwinTokenPosition>();
  private lastPosition = -1;
  private eventsAppliedCount = 0;
  private lastReplayMs: number | null = null;

  async apply(events: StoredEvent[]): Promise<void> {
    for (const ev of events) {
      this.applyOne(ev);
      this.eventsAppliedCount++;
    }
    if (events.length > 0) {
      this.lastPosition = events[events.length - 1].globalPosition;
    }
  }

  async rebuild(allEvents: StoredEvent[]): Promise<void> {
    const start = Date.now();
    this.positions.clear();
    this.lastPosition = -1;
    this.eventsAppliedCount = 0;
    for (const ev of allEvents) {
      this.applyOne(ev);
      this.eventsAppliedCount++;
    }
    if (allEvents.length > 0) {
      this.lastPosition = allEvents[allEvents.length - 1].globalPosition;
    }
    this.lastReplayMs = Date.now() - start;
  }

  checkpoint(): number {
    return this.lastPosition;
  }

  get(accountId: string, tokenType: TokenType, currency: string): TwinTokenPosition | null {
    return this.positions.get(posKey(accountId, tokenType, currency)) ?? null;
  }

  list(query?: TwinTokenQuery): TwinTokenPosition[] {
    let result = [...this.positions.values()];
    if (query?.accountId) result = result.filter((p) => p.accountId === query.accountId);
    if (query?.tokenType) result = result.filter((p) => p.tokenType === query.tokenType);
    if (query?.currency) result = result.filter((p) => p.currency === query.currency);
    return result.sort((a, b) => b.lastUpdated - a.lastUpdated);
  }

  view(): TwinTokenView {
    const positions = this.list();
    const totalByType: Record<string, number> = { claim: 0, settlement: 0, reserve: 0, liquidity: 0 };
    const totalByCurrency: Record<string, number> = {};
    for (const p of positions) {
      totalByType[p.tokenType] += p.balance;
      totalByCurrency[p.currency] = (totalByCurrency[p.currency] ?? 0) + p.balance;
    }
    return { positions, totalByType: totalByType as Record<TokenType, number>, totalByCurrency };
  }

  count(): number {
    return this.positions.size;
  }

  eventsApplied(): number {
    return this.eventsAppliedCount;
  }

  lastReplayDurationMs(): number | null {
    return this.lastReplayMs;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private getOrCreate(accountId: string, tokenType: TokenType, currency: string, timestamp: number): TwinTokenPosition {
    const key = posKey(accountId, tokenType, currency);
    let pos = this.positions.get(key);
    if (!pos) {
      pos = {
        accountId,
        tokenType,
        currency,
        balance: 0,
        backedAmount: 0,
        lastUpdated: timestamp,
      };
      this.positions.set(key, pos);
    }
    return pos;
  }

  private applyOne(event: StoredEvent): void {
    const ts = event.metadata.timestamp;
    switch (event.type) {
      case 'twin.minted': {
        const p = event.payload as { accountId: string; tokenType: TokenType; currency: string; amount: number; backed: boolean };
        const pos = this.getOrCreate(p.accountId, p.tokenType, p.currency, ts);
        pos.balance += p.amount;
        pos.lastUpdated = ts;
        break;
      }
      case 'twin.burned': {
        const p = event.payload as { accountId: string; tokenType: TokenType; currency: string; amount: number };
        const pos = this.getOrCreate(p.accountId, p.tokenType, p.currency, ts);
        pos.balance -= p.amount;
        pos.lastUpdated = ts;
        break;
      }
      case 'twin.transferred': {
        const p = event.payload as { fromAccountId: string; toAccountId: string; tokenType: TokenType; currency: string; amount: number };
        const from = this.getOrCreate(p.fromAccountId, p.tokenType, p.currency, ts);
        from.balance -= p.amount;
        from.lastUpdated = ts;
        const to = this.getOrCreate(p.toAccountId, p.tokenType, p.currency, ts);
        to.balance += p.amount;
        to.lastUpdated = ts;
        break;
      }
      case 'twin.converted': {
        const p = event.payload as { accountId: string; fromTokenType: TokenType; toTokenType: TokenType; currency: string; amount: number };
        const from = this.getOrCreate(p.accountId, p.fromTokenType, p.currency, ts);
        from.balance -= p.amount;
        from.lastUpdated = ts;
        const to = this.getOrCreate(p.accountId, p.toTokenType, p.currency, ts);
        to.balance += p.amount;
        to.lastUpdated = ts;
        break;
      }
      case 'twin.backed': {
        const p = event.payload as { settlementAccountId: string; currency: string; amount: number };
        const pos = this.getOrCreate(p.settlementAccountId, 'settlement', p.currency, ts);
        pos.backedAmount += p.amount;
        pos.lastUpdated = ts;
        break;
      }
      case 'twin.unbacked': {
        const p = event.payload as { settlementAccountId: string; currency: string; amount: number };
        const pos = this.getOrCreate(p.settlementAccountId, 'settlement', p.currency, ts);
        pos.backedAmount -= p.amount;
        pos.lastUpdated = ts;
        break;
      }
      default:
        break;
    }
  }
}
