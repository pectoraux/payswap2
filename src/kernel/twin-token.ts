/**
 * Twin Token Engine — mints, transfers and burns pegged obligation tokens.
 *
 * When value enters a PaySwap reserve on one side of a cross-border payment,
 * the kernel mints a "twin token" representing the unsettled claim. The twin
 * token travels with the transaction across the routing path and is burned
 * when the counterpart reserve credits the destination. This makes the
 * cross-border obligation atomic, auditable and inspectable at every hop —
 * the reserve can never silently hold an unbalanced claim.
 */
import type { TwinTokenRecord, CurrencyCode } from './types';
import { uid } from './support';
import { eventEngine } from './event';

export class TwinTokenEngine {
  private tokens: TwinTokenRecord[] = [];
  private counter = 0;

  mint(
    amount: number,
    currency: CurrencyCode,
    fromCountry: string,
    toCountry: string,
    frame: number,
  ): TwinTokenRecord {
    this.counter += 1;
    const symbol = `TWIN-${fromCountry.slice(0, 3).toUpperCase()}-${toCountry
      .slice(0, 3)
      .toUpperCase()}-${this.counter.toString().padStart(4, '0')}`;
    const token: TwinTokenRecord = {
      id: uid('twin'),
      symbol,
      amount,
      currency,
      fromCountry,
      toCountry,
      status: 'minted',
      mintedAtFrame: frame,
      burnedAtFrame: null,
      memo: `Cross-border claim ${fromCountry} -> ${toCountry}`,
    };
    this.tokens.push(token);
    eventEngine.emit(
      'twin.minted',
      { symbol, amount, currency, fromCountry, toCountry, frame },
      frame,
    );
    return token;
  }

  transfer(token: TwinTokenRecord, frame: number): TwinTokenRecord {
    token.status = 'transferred';
    eventEngine.emit('twin.transferred', { symbol: token.symbol, frame }, frame);
    return token;
  }

  burn(token: TwinTokenRecord, frame: number): TwinTokenRecord {
    token.status = 'burned';
    token.burnedAtFrame = frame;
    eventEngine.emit(
      'twin.burned',
      { symbol: token.symbol, amount: token.amount, frame },
      frame,
    );
    return token;
  }

  all(): TwinTokenRecord[] {
    return [...this.tokens];
  }

  reset(): void {
    this.tokens = [];
    this.counter = 0;
  }
}
