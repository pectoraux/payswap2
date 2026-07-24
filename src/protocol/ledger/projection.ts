/**
 * PaySwap Protocol — Double-Entry Ledger / Event → Journal Projection.
 * -----------------------------------------------------------------------------
 * THE CRITICAL FILE.
 *
 * `rebuildLedgerFromEvents(events)` rebuilds the entire ledger by replaying
 * the event stream. Every journal entry is derived purely from events —
 * nothing is read from UI state. The projection is deterministic: replaying
 * the same events always produces the same ledger.
 *
 * Event → Journal mapping:
 *
 *   twintoken.minted       → DR twintoken:circulating:TWINxxx   CR twin:backing:xxx
 *   twintoken.burned       → DR twin:backing:xxx                CR twintoken:circulating:TWINxxx
 *   twintoken.transferred  → DR twintoken:circulating:TWINxxx   CR twintoken:circulating:TWINxxx  (wash — no net change)
 *   twintoken.escrowed     → DR twintoken:escrowed:TWINxxx      CR twintoken:circulating:TWINxxx
 *   twintoken.released     → DR twintoken:circulating:TWINxxx   CR twintoken:escrowed:TWINxxx
 *   wallet.credited        → DR cash:bank:CUR                   CR user:wallet:walletId
 *   wallet.debited         → DR user:wallet:walletId            CR cash:bank:CUR
 *   wallet.locked          → DR settlement:receivable           CR user:wallet:walletId
 *   wallet.unlocked        → DR user:wallet:walletId            CR settlement:receivable
 *   payout.completed       → DR merchant:payable:mid  CR cash:mmo|bank:CUR  CR revenue:fees:method (for fee)
 *   payout.failed          → no entry
 *   merchant.onboarded     → no entry (registration only)
 *   merchant.verified      → DR lp:collateral:mid               CR equity:treasury
 *   (any unknown event)    → skipped
 *
 * Multi-currency handling: every journal entry balances per currency. Twin
 * Token movements use the underlying fiat currency (1 TWINxxx = 1 xxx), so
 * the circulating line and the backing line share the same currency.
 *
 * Currency inference: the projection builds a small in-memory index of
 * wallet currencies (from wallet.created events) so it can fill in the
 * currency for wallet.locked/unlocked events (whose payload lacks it).
 * Merchant bond currencies default to 'USD' (the merchant.verified event
 * doesn't carry currency — the bond is implicitly in the merchant's
 * settlement currency, which isn't on the event stream).
 *
 * For payout.completed, the event payload includes `netAmount` and `method`
 * but not the gross amount or fee. The projection looks back at the most
 * recent twintoken.burned event for the same merchant to derive the gross;
 * the fee is gross − netAmount. If no burn is found (e.g. on-chain payouts
 * which transfer rather than burn), the gross defaults to the netAmount
 * and no fee line is posted (the reconciliation engine flags this).
 */
import type { SimulationEvent } from '@/kernel/types';
import { round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { LedgerEngine } from './engine';
import { twinAssetToCurrency } from './accounts';
import type { JournalLineInput } from './entry';

interface ProjectionContext {
  /** walletId → currency, populated from wallet.created events. */
  walletCurrencies: Map<string, string>;
  /** merchantId → currency, populated from merchant.onboarded events when available. */
  merchantCurrencies: Map<string, string>;
  /** Recent twintoken.burned events indexed by `from` (merchant holder) for payout gross lookup. */
  recentBurns: Array<{ from: string; amount: number; assetCode: string; ts: number }>;
  /** Recent twintoken.transferred events indexed by `from` for onchain payout gross lookup. */
  recentTransfers: Array<{ from: string; to: string; amount: number; assetCode: string; ts: number }>;
}

function newContext(): ProjectionContext {
  return {
    walletCurrencies: new Map(),
    merchantCurrencies: new Map(),
    recentBurns: [],
    recentTransfers: [],
  };
}

/** Stable sort: by ts asc, then frame asc, then id asc — for deterministic replay. */
function sortEvents(events: SimulationEvent[]): SimulationEvent[] {
  return [...events].sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if ((a.frame ?? 0) !== (b.frame ?? 0)) return (a.frame ?? 0) - (b.frame ?? 0);
    return a.id.localeCompare(b.id);
  });
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (isFinite(n)) return n;
  }
  return fallback;
}

function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return fallback;
}

/** Merchant holder key used by payoutService — `merchant:${merchantId}`. */
function merchantHolder(merchantId: string): string {
  return `merchant:${merchantId}`;
}

/**
 * Rebuild a fresh LedgerEngine by replaying `events` in deterministic order.
 * Returns the populated ledger. The caller owns the instance.
 */
export function rebuildLedgerFromEvents(events: SimulationEvent[]): LedgerEngine {
  return rebuildLedgerFromEventsInto(events, new LedgerEngine());
}

/**
 * Rebuild into a caller-supplied ledger (useful for snapshot fast-forward:
 * the caller may have already posted an "opening balance" entry from a
 * snapshot before invoking this with the post-snapshot event slice).
 */
export function rebuildLedgerFromEventsInto(events: SimulationEvent[], ledger: LedgerEngine): LedgerEngine {
  const ctx = newContext();
  const sorted = sortEvents(events);

  for (const event of sorted) {
    projectEvent(event, ledger, ctx);
  }
  return ledger;
}

function projectEvent(event: SimulationEvent, ledger: LedgerEngine, ctx: ProjectionContext): void {
  const p = event.payload ?? {};
  switch (event.type) {
    case 'wallet.created': {
      const walletId = str(p.walletId);
      const currency = str(p.currency, 'USD');
      if (walletId) ctx.walletCurrencies.set(walletId, currency);
      return;
    }

    case 'merchant.onboarded': {
      // merchant.onboarded payload: { merchantId, name } — no currency.
      // We can't populate merchantCurrencies from this; default later.
      return;
    }

    case 'twintoken.minted': {
      // { opId, assetCode, amount, to, txHash }
      const assetCode = str(p.assetCode);
      const amount = num(p.amount);
      const to = str(p.to);
      const currency = twinAssetToCurrency(assetCode);
      if (!assetCode || amount <= 0) return;
      const lines: JournalLineInput[] = [
        { accountCode: `twintoken:circulating:${assetCode}`, amount, currency, side: 'debit', memo: `Mint to ${to}` },
        { accountCode: `twin:backing:${currency}`, amount, currency, side: 'credit', memo: `Backing liability for ${assetCode}` },
      ];
      postLedger(ledger, {
        txId: str(p.opId) || event.id,
        description: `Mint ${amount} ${assetCode} to ${to}`,
        ts: event.ts,
        frame: event.frame,
        lines,
      });
      return;
    }

    case 'twintoken.burned': {
      // { opId, assetCode, amount, from, txHash }
      const assetCode = str(p.assetCode);
      const amount = num(p.amount);
      const from = str(p.from);
      const currency = twinAssetToCurrency(assetCode);
      if (!assetCode || amount <= 0) return;
      ctx.recentBurns.push({ from, amount, assetCode, ts: event.ts });
      // Keep the last 100 burns to bound memory.
      if (ctx.recentBurns.length > 100) ctx.recentBurns.shift();
      const lines: JournalLineInput[] = [
        { accountCode: `twin:backing:${currency}`, amount, currency, side: 'debit', memo: `Reverse backing for burn from ${from}` },
        { accountCode: `twintoken:circulating:${assetCode}`, amount, currency, side: 'credit', memo: `Burn from ${from}` },
      ];
      postLedger(ledger, {
        txId: str(p.opId) || event.id,
        description: `Burn ${amount} ${assetCode} from ${from}`,
        ts: event.ts,
        frame: event.frame,
        lines,
      });
      return;
    }

    case 'twintoken.transferred': {
      // { opId, assetCode, amount, from, to, txHash }
      const assetCode = str(p.assetCode);
      const amount = num(p.amount);
      const from = str(p.from);
      const to = str(p.to);
      const currency = twinAssetToCurrency(assetCode);
      if (!assetCode || amount <= 0) return;
      ctx.recentTransfers.push({ from, to, amount, assetCode, ts: event.ts });
      if (ctx.recentTransfers.length > 100) ctx.recentTransfers.shift();
      // Wash entry: DR and CR the same aggregate account. Net effect on the
      // aggregate circulating balance is zero (transfers don't change supply).
      const lines: JournalLineInput[] = [
        { accountCode: `twintoken:circulating:${assetCode}`, amount, currency, side: 'debit', memo: `Transfer to ${to}` },
        { accountCode: `twintoken:circulating:${assetCode}`, amount, currency, side: 'credit', memo: `Transfer from ${from}` },
      ];
      postLedger(ledger, {
        txId: str(p.opId) || event.id,
        description: `Transfer ${amount} ${assetCode} from ${from} to ${to}`,
        ts: event.ts,
        frame: event.frame,
        lines,
      });
      return;
    }

    case 'twintoken.escrowed': {
      // { opId, assetCode, amount, from, escrowId }
      const assetCode = str(p.assetCode);
      const amount = num(p.amount);
      const from = str(p.from);
      const escrowId = str(p.escrowId);
      const currency = twinAssetToCurrency(assetCode);
      if (!assetCode || amount <= 0) return;
      const lines: JournalLineInput[] = [
        { accountCode: `twintoken:escrowed:${assetCode}`, amount, currency, side: 'debit', memo: `Escrow ${escrowId} from ${from}` },
        { accountCode: `twintoken:circulating:${assetCode}`, amount, currency, side: 'credit', memo: `Escrow to ${escrowId}` },
      ];
      postLedger(ledger, {
        txId: str(p.opId) || event.id,
        description: `Escrow ${amount} ${assetCode} from ${from} (${escrowId})`,
        ts: event.ts,
        frame: event.frame,
        lines,
      });
      return;
    }

    case 'twintoken.released': {
      // { opId, assetCode, amount, escrowId, to }
      const assetCode = str(p.assetCode);
      const amount = num(p.amount);
      const escrowId = str(p.escrowId);
      const to = str(p.to);
      const currency = twinAssetToCurrency(assetCode);
      if (!assetCode || amount <= 0) return;
      const lines: JournalLineInput[] = [
        { accountCode: `twintoken:circulating:${assetCode}`, amount, currency, side: 'debit', memo: `Release from escrow ${escrowId} to ${to}` },
        { accountCode: `twintoken:escrowed:${assetCode}`, amount, currency, side: 'credit', memo: `Release escrow ${escrowId}` },
      ];
      postLedger(ledger, {
        txId: str(p.opId) || event.id,
        description: `Release ${amount} ${assetCode} from escrow ${escrowId} to ${to}`,
        ts: event.ts,
        frame: event.frame,
        lines,
      });
      return;
    }

    case 'wallet.credited': {
      // { walletId, amount, currency, counterparty, reference }
      const walletId = str(p.walletId);
      const amount = num(p.amount);
      const currency = str(p.currency, 'USD');
      if (!walletId || amount <= 0) return;
      const lines: JournalLineInput[] = [
        { accountCode: `cash:bank:${currency}`, amount, currency, side: 'debit', memo: `Credit wallet ${walletId}` },
        { accountCode: `user:wallet:${walletId}`, amount, currency, side: 'credit', memo: `Wallet credit (${str(p.reference)})` },
      ];
      postLedger(ledger, {
        txId: str(p.reference) || event.id,
        description: `Wallet credit ${amount} ${currency} to ${walletId}`,
        ts: event.ts,
        frame: event.frame,
        lines,
      });
      return;
    }

    case 'wallet.debited': {
      // { walletId, amount, currency, counterparty, reference }
      const walletId = str(p.walletId);
      const amount = num(p.amount);
      const currency = str(p.currency, 'USD');
      if (!walletId || amount <= 0) return;
      const lines: JournalLineInput[] = [
        { accountCode: `user:wallet:${walletId}`, amount, currency, side: 'debit', memo: `Wallet debit (${str(p.reference)})` },
        { accountCode: `cash:bank:${currency}`, amount, currency, side: 'credit', memo: `Debit wallet ${walletId}` },
      ];
      postLedger(ledger, {
        txId: str(p.reference) || event.id,
        description: `Wallet debit ${amount} ${currency} from ${walletId}`,
        ts: event.ts,
        frame: event.frame,
        lines,
      });
      return;
    }

    case 'wallet.locked': {
      // { walletId, amount, reference } — no currency in payload
      const walletId = str(p.walletId);
      const amount = num(p.amount);
      if (!walletId || amount <= 0) return;
      const currency = ctx.walletCurrencies.get(walletId) ?? 'USD';
      const lines: JournalLineInput[] = [
        { accountCode: 'settlement:receivable', amount, currency, side: 'debit', memo: `Lock for ${str(p.reference)}` },
        { accountCode: `user:wallet:${walletId}`, amount, currency, side: 'credit', memo: `Wallet lock (${str(p.reference)})` },
      ];
      postLedger(ledger, {
        txId: str(p.reference) || event.id,
        description: `Wallet lock ${amount} ${currency} for ${walletId}`,
        ts: event.ts,
        frame: event.frame,
        lines,
      });
      return;
    }

    case 'wallet.unlocked': {
      // { walletId, amount, reference } — no currency in payload
      const walletId = str(p.walletId);
      const amount = num(p.amount);
      if (!walletId || amount <= 0) return;
      const currency = ctx.walletCurrencies.get(walletId) ?? 'USD';
      const lines: JournalLineInput[] = [
        { accountCode: `user:wallet:${walletId}`, amount, currency, side: 'debit', memo: `Wallet unlock (${str(p.reference)})` },
        { accountCode: 'settlement:receivable', amount, currency, side: 'credit', memo: `Unlock for ${str(p.reference)}` },
      ];
      postLedger(ledger, {
        txId: str(p.reference) || event.id,
        description: `Wallet unlock ${amount} ${currency} for ${walletId}`,
        ts: event.ts,
        frame: event.frame,
        lines,
      });
      return;
    }

    case 'payout.completed': {
      // { payoutId, merchantId, method, netAmount, currency, txHash, evidenceSource }
      const merchantId = str(p.merchantId);
      const method = str(p.method) as 'bank' | 'mobile_money' | 'onchain';
      const netAmount = num(p.netAmount);
      const currency = str(p.currency, 'USD');
      if (!merchantId || netAmount <= 0) return;

      const holder = merchantHolder(merchantId);
      // Look back for the most recent burn (fiat) or transfer (onchain) for this merchant.
      let gross: number | undefined;
      if (method === 'onchain') {
        for (let i = ctx.recentTransfers.length - 1; i >= 0; i--) {
          const t = ctx.recentTransfers[i];
          if (t.from === holder && twinAssetToCurrency(t.assetCode) === currency) {
            gross = t.amount;
            break;
          }
        }
      } else {
        for (let i = ctx.recentBurns.length - 1; i >= 0; i--) {
          const b = ctx.recentBurns[i];
          if (b.from === holder && twinAssetToCurrency(b.assetCode) === currency) {
            gross = b.amount;
            break;
          }
        }
      }

      const effectiveGross = gross ?? netAmount;
      const fee = round(effectiveGross - netAmount, 6);

      const lines: JournalLineInput[] = [
        { accountCode: `merchant:payable:${merchantId}`, amount: effectiveGross, currency, side: 'debit', memo: `Payout ${str(p.payoutId)}` },
      ];

      if (method === 'bank') {
        lines.push({ accountCode: `cash:bank:${currency}`, amount: netAmount, currency, side: 'credit', memo: `Payout to bank` });
      } else if (method === 'mobile_money') {
        lines.push({ accountCode: `cash:mmo:${currency}`, amount: netAmount, currency, side: 'credit', memo: `Payout to MMO` });
      } else if (method === 'onchain') {
        // On-chain payout: tokens go to external wallet. We don't know the
        // external wallet address from the payload, so we credit the
        // aggregate circulating account (the transfer event already moved
        // them out of the merchant's holding — but since the transfer event
        // is a wash for aggregate circulating, we credit circulating here
        // to balance the merchant:payable debit). For multi-holder detail,
        // see the twin-token engine (the source of truth for per-holder
        // balances).
        const assetCode = `TWIN${currency}`;
        lines.push({ accountCode: `twintoken:circulating:${assetCode}`, amount: netAmount, currency, side: 'credit', memo: `On-chain payout` });
      }

      if (fee > 0) {
        lines.push({ accountCode: `revenue:fees:${method}`, amount: fee, currency, side: 'credit', memo: `Fee for payout ${str(p.payoutId)}` });
      }

      postLedger(ledger, {
        txId: str(p.payoutId) || str(p.txHash) || event.id,
        description: `Payout ${str(p.payoutId)} — ${method} ${netAmount} ${currency} to ${merchantId}`,
        ts: event.ts,
        frame: event.frame,
        lines,
      });
      return;
    }

    case 'payout.failed': {
      // No entry — failed payouts don't move funds (funds were not debited
      // from the merchant's Twin Token balance in the failed path).
      return;
    }

    case 'payout.requested':
    case 'payout.processing':
    case 'payout.cancelled': {
      // Lifecycle annotations — no ledger impact.
      return;
    }

    case 'merchant.verified': {
      // { merchantId, bond, tier }
      const merchantId = str(p.merchantId);
      const bond = num(p.bond);
      if (!merchantId || bond <= 0) return;
      const currency = ctx.merchantCurrencies.get(merchantId) ?? 'USD';
      const lines: JournalLineInput[] = [
        { accountCode: `lp:collateral:${merchantId}`, amount: bond, currency, side: 'debit', memo: `Merchant bond — tier ${str(p.tier)}` },
        { accountCode: 'equity:treasury', amount: bond, currency, side: 'credit', memo: `Treasury equity from merchant ${merchantId} bond` },
      ];
      postLedger(ledger, {
        txId: `merchant.verify:${merchantId}`,
        description: `Merchant ${merchantId} verified — bond ${bond} ${currency}`,
        ts: event.ts,
        frame: event.frame,
        lines,
      });
      return;
    }

    default:
      // Unknown event — skip (do NOT crash).
      return;
  }
}

function postLedger(
  ledger: LedgerEngine,
  params: {
    txId: string;
    description: string;
    ts: number;
    frame?: number;
    lines: JournalLineInput[];
  },
): void {
  try {
    ledger.postLines(params);
  } catch (err) {
    // Don't crash the projection on a single bad event — log and skip.
    // The reconciliation engine will surface discrepancies.
    console.warn(
      `[ledger/projection] failed to post journal entry for tx=${params.txId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Rebuild a snapshot of every account's balance at `asOfTs`, derived purely
 * from events up to that timestamp. The snapshot includes the trial-balance
 * check (must balance per currency).
 */
export interface LedgerSnapshotLite {
  ts: number;
  accounts: Record<string, { debit: number; credit: number; balance: number }>;
  trialBalance: { totalDebits: number; totalCredits: number; balanced: boolean };
}

export function rebuildSnapshot(events: SimulationEvent[], asOfTs: number): LedgerSnapshotLite {
  const slice = events.filter((e) => e.ts <= asOfTs);
  const ledger = rebuildLedgerFromEvents(slice);
  const codes = ledger.getAccountCodes();
  const accounts: Record<string, { debit: number; credit: number; balance: number }> = {};
  for (const code of codes) {
    const bal = ledger.getAccountBalance(code);
    if (bal.debit === 0 && bal.credit === 0) continue;
    accounts[code] = { debit: bal.debit, credit: bal.credit, balance: bal.balance };
  }
  const tb = ledger.getTrialBalance();
  return {
    ts: asOfTs,
    accounts,
    trialBalance: { totalDebits: tb.totalDebits, totalCredits: tb.totalCredits, balanced: tb.balanced },
  };
}

/**
 * Convenience: rebuild the ledger from the kernel event engine's live stream.
 * Pulls `eventEngine.read()` and replays.
 */
export function rebuildLedgerFromEventStream(): LedgerEngine {
  return rebuildLedgerFromEvents(eventEngine.read() as SimulationEvent[]);
}
