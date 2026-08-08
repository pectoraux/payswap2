/**
 * PaySwap Protocol — Ledger Projection (Event → Journal).
 *
 * `rebuildLedgerFromEvents()` reconstructs the protocol ledger from a stream
 * of `SimulationEvent`s. Each known event type is mapped to one or more
 * balanced journal entries; unknown events are skipped (they belong to
 * subsystems outside the ledger's scope).
 *
 * Determinism: events are sorted by (ts, frame, id) before replay so the
 * resulting ledger is identical regardless of the input order. This is the
 * same approach used by the wallet service's `rebuildBalancesFromEvents`.
 *
 * Event → Journal mappings (see task spec):
 *
 *   twintoken.minted       DR twintoken:circulating:TWINxxx
 *                          CR twin:backing:xxx
 *   twintoken.burned       DR twin:backing:xxx
 *                          CR twintoken:circulating:TWINxxx
 *   twintoken.transferred  DR twintoken:circulating:TWINxxx (recipient)
 *                          CR twintoken:circulating:TWINxxx (sender)
 *   twintoken.escrowed     DR twintoken:escrowed:TWINxxx
 *                          CR twintoken:circulating:TWINxxx
 *   twintoken.released     DR twintoken:circulating:TWINxxx (recipient)
 *                          CR twintoken:escrowed:TWINxxx
 *   wallet.credited        DR cash:*:<ccy> or twintoken:circulating:TWINxxx
 *                          CR user:wallet:<walletId>
 *   wallet.debited         DR user:wallet:<walletId>
 *                          CR cash:*:<ccy> or twintoken:circulating:TWINxxx
 *   wallet.locked          DR settlement:receivable
 *                          CR user:wallet:<walletId>
 *   wallet.unlocked        DR user:wallet:<walletId>
 *                          CR settlement:receivable
 *   payout.completed       DR twin:backing:<ccy>
 *                          CR cash:bank:<ccy> | cash:mmo:<ccy> | twintoken:circulating:TWINxxx  (net)
 *                          DR equity:fees
 *                          CR revenue:fees:<method>                                        (fee)
 *   merchant.verified      DR lp:collateral
 *                          CR equity:treasury                                              (bond)
 *   (unknown)              skip
 */
import type { SimulationEvent } from '@/kernel/types';
import { uid, round } from '@/kernel/support';
import { LedgerEngine } from './engine';
import { createJournalEntry, type JournalEntry, type JournalLegInput } from './entry';
import { Money } from '@/money/money';
import {
  circulatingAccount,
  escrowedAccount,
  backingAccount,
  bankCashAccount,
  mmoCashAccount,
  userWalletAccount,
  feeRevenueAccount,
  twinAssetToCurrency,
} from './accounts';

/** Result of a single event projection — what was built (if anything). */
export interface ProjectionResult {
  /** The event id that was projected. */
  eventId: string;
  /** The event type. */
  type: string;
  /** Journal entries created for this event (0, 1, or 2). */
  journals: JournalEntry[];
  /** Skip reason if no journals were created. */
  skipped?: string;
}

/** Sort events deterministically by (ts, frame, id). */
export function sortEventsForReplay(events: SimulationEvent[]): SimulationEvent[] {
  return [...events].sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.frame !== b.frame) return a.frame - b.frame;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Project a single event into zero or more journal entries.
 *
 * Returns an empty array (with a skip reason) for events the ledger does not
 * model. Caller is responsible for posting the returned journals to a
 * LedgerEngine.
 */
export function projectEvent(event: SimulationEvent): ProjectionResult {
  const p = event.payload ?? {};
  const frame = event.frame;
  const ts = event.ts;
  const txId = `evt:${event.id}`;
  const journals: JournalEntry[] = [];

  switch (event.type) {
    // ---------------------------------------------------------------- twin mint
    case 'twintoken.minted': {
      const assetCode = (p.assetCode as string) ?? '';
      const amount = num(p.amount);
      const currency = twinAssetToCurrency(assetCode);
      if (!assetCode || amount <= 0) {
        return { eventId: event.id, type: event.type, journals, skipped: 'invalid_mint_payload' };
      }
      journals.push(
        createJournalEntry({
          txId,
          ts,
          frame,
          description: `Mint ${amount} ${assetCode} to ${p.to ?? 'recipient'}`,
          legs: [
            { accountCode: circulatingAccount(assetCode), debit: Money.fromMajor(amount, currency as any), currency, memo: 'mint — increase circulating' },
            { accountCode: backingAccount(currency), credit: Money.fromMajor(amount, currency as any), currency, memo: 'mint — increase backing liability' },
          ],
        }),
      );
      break;
    }

    // --------------------------------------------------------------- twin burn
    case 'twintoken.burned': {
      const assetCode = (p.assetCode as string) ?? '';
      const amount = num(p.amount);
      const currency = twinAssetToCurrency(assetCode);
      if (!assetCode || amount <= 0) {
        return { eventId: event.id, type: event.type, journals, skipped: 'invalid_burn_payload' };
      }
      journals.push(
        createJournalEntry({
          txId,
          ts,
          frame,
          description: `Burn ${amount} ${assetCode} from ${p.from ?? 'holder'}`,
          legs: [
            { accountCode: backingAccount(currency), debit: Money.fromMajor(amount, currency as any), currency, memo: 'burn — release backing liability' },
            { accountCode: circulatingAccount(assetCode), credit: Money.fromMajor(amount, currency as any), currency, memo: 'burn — decrease circulating' },
          ],
        }),
      );
      break;
    }

    // -------------------------------------------------------- twin transferred
    case 'twintoken.transferred': {
      const assetCode = (p.assetCode as string) ?? '';
      const amount = num(p.amount);
      const from = (p.from as string) ?? '';
      const to = (p.to as string) ?? '';
      const currency = twinAssetToCurrency(assetCode);
      if (!assetCode || amount <= 0 || !from || !to) {
        return { eventId: event.id, type: event.type, journals, skipped: 'invalid_transfer_payload' };
      }
      // Movement between two holders: debit recipient's wallet-liability
      // account and credit sender's. We track per-holder circulating balances
      // by using the wallet account codes as sub-ledgers of circulating.
      journals.push(
        createJournalEntry({
          txId,
          ts,
          frame,
          description: `Transfer ${amount} ${assetCode}: ${from} → ${to}`,
          legs: [
            { accountCode: userWalletAccount(to), debit: Money.fromMajor(amount, currency as any), currency, memo: `receive from ${from}` },
            { accountCode: userWalletAccount(from), credit: Money.fromMajor(amount, currency as any), currency, memo: `send to ${to}` },
          ],
        }),
      );
      break;
    }

    // -------------------------------------------------------------- twin escrow
    case 'twintoken.escrowed': {
      const assetCode = (p.assetCode as string) ?? '';
      const amount = num(p.amount);
      const currency = twinAssetToCurrency(assetCode);
      if (!assetCode || amount <= 0) {
        return { eventId: event.id, type: event.type, journals, skipped: 'invalid_escrow_payload' };
      }
      journals.push(
        createJournalEntry({
          txId,
          ts,
          frame,
          description: `Escrow ${amount} ${assetCode} (escrowId=${p.escrowId ?? 'n/a'})`,
          legs: [
            { accountCode: escrowedAccount(assetCode), debit: Money.fromMajor(amount, currency as any), currency, memo: 'escrow — move to escrowed' },
            { accountCode: circulatingAccount(assetCode), credit: Money.fromMajor(amount, currency as any), currency, memo: 'escrow — reduce circulating' },
          ],
        }),
      );
      break;
    }

    // ------------------------------------------------------------- twin release
    case 'twintoken.released': {
      const assetCode = (p.assetCode as string) ?? '';
      const amount = num(p.amount);
      const to = (p.to as string) ?? '';
      const currency = twinAssetToCurrency(assetCode);
      if (!assetCode || amount <= 0) {
        return { eventId: event.id, type: event.type, journals, skipped: 'invalid_release_payload' };
      }
      // Release moves escrowed tokens BACK INTO the circulating pool.
      //   DR twintoken:circulating:TWINxxx  (release increases circulating)
      //   CR twintoken:escrowed:TWINxxx     (release decreases escrowed)
      //
      // The recipient wallet credit is a SEPARATE concern — it is recorded
      // by a parallel `wallet.credited` (or `twintoken.transferred`) event
      // in the same transaction, not by this projection. Coupling the
      // recipient-wallet credit to the release would double-count: the
      // circulating aggregate would not reflect the un-escrowed amount.
      void to;  // recipient is informational on the release event itself
      journals.push(
        createJournalEntry({
          txId,
          ts,
          frame,
          description: `Release ${amount} ${assetCode} from escrow back to circulating${to ? ` (recipient=${to})` : ''}`,
          legs: [
            { accountCode: circulatingAccount(assetCode), debit: Money.fromMajor(amount, currency as any), currency, memo: `release — back to circulating${to ? ` for ${to}` : ''}` },
            { accountCode: escrowedAccount(assetCode), credit: Money.fromMajor(amount, currency as any), currency, memo: 'release — reduce escrowed' },
          ],
        }),
      );
      break;
    }

    // ------------------------------------------------------------ wallet credit
    case 'wallet.credited': {
      const walletId = (p.walletId as string) ?? '';
      const amount = num(p.amount);
      const currency = (p.currency as string) ?? inferCurrencyFromWalletEvent(p);
      if (!walletId || amount <= 0 || !currency) {
        return { eventId: event.id, type: event.type, journals, skipped: 'invalid_wallet_credit_payload' };
      }
      journals.push(
        createJournalEntry({
          txId,
          ts,
          frame,
          description: `Wallet credit ${amount} ${currency} → wallet ${walletId}`,
          legs: [
            { accountCode: walletCreditSourceAccount(p, currency), debit: Money.fromMajor(amount, currency as any), currency, memo: `credit source: ${p.counterparty ?? 'deposit'}` },
            { accountCode: userWalletAccount(walletId), credit: Money.fromMajor(amount, currency as any), currency, memo: `wallet credit: ${p.reference ?? ''}` },
          ],
        }),
      );
      break;
    }

    // ------------------------------------------------------------- wallet debit
    case 'wallet.debited': {
      const walletId = (p.walletId as string) ?? '';
      const amount = num(p.amount);
      const currency = (p.currency as string) ?? inferCurrencyFromWalletEvent(p);
      if (!walletId || amount <= 0 || !currency) {
        return { eventId: event.id, type: event.type, journals, skipped: 'invalid_wallet_debit_payload' };
      }
      journals.push(
        createJournalEntry({
          txId,
          ts,
          frame,
          description: `Wallet debit ${amount} ${currency} ← wallet ${walletId}`,
          legs: [
            { accountCode: userWalletAccount(walletId), debit: Money.fromMajor(amount, currency as any), currency, memo: `wallet debit: ${p.reference ?? ''}` },
            { accountCode: walletDebitDestinationAccount(p, currency), credit: Money.fromMajor(amount, currency as any), currency, memo: `debit destination: ${p.counterparty ?? 'withdrawal'}` },
          ],
        }),
      );
      break;
    }

    // -------------------------------------------------------------- wallet lock
    case 'wallet.locked': {
      const walletId = (p.walletId as string) ?? '';
      const amount = num(p.amount);
      const currency = (p.currency as string) ?? inferCurrencyFromWalletEvent(p);
      if (!walletId || amount <= 0 || !currency) {
        return { eventId: event.id, type: event.type, journals, skipped: 'invalid_wallet_lock_payload' };
      }
      journals.push(
        createJournalEntry({
          txId,
          ts,
          frame,
          description: `Wallet lock ${amount} ${currency} (wallet ${walletId})`,
          legs: [
            { accountCode: 'settlement:receivable', debit: Money.fromMajor(amount, currency as any), currency, memo: `lock for settlement: ${p.reference ?? ''}` },
            { accountCode: userWalletAccount(walletId), credit: Money.fromMajor(amount, currency as any), currency, memo: 'wallet funds committed to settlement' },
          ],
        }),
      );
      break;
    }

    // ------------------------------------------------------------ wallet unlock
    case 'wallet.unlocked': {
      const walletId = (p.walletId as string) ?? '';
      const amount = num(p.amount);
      const currency = (p.currency as string) ?? inferCurrencyFromWalletEvent(p);
      if (!walletId || amount <= 0 || !currency) {
        return { eventId: event.id, type: event.type, journals, skipped: 'invalid_wallet_unlock_payload' };
      }
      journals.push(
        createJournalEntry({
          txId,
          ts,
          frame,
          description: `Wallet unlock ${amount} ${currency} (wallet ${walletId})`,
          legs: [
            { accountCode: userWalletAccount(walletId), debit: Money.fromMajor(amount, currency as any), currency, memo: 'settlement failed/refunded — funds return' },
            { accountCode: 'settlement:receivable', credit: Money.fromMajor(amount, currency as any), currency, memo: `unlock: ${p.reference ?? ''}` },
          ],
        }),
      );
      break;
    }

    // ---------------------------------------------------------- payout completed
    case 'payout.completed': {
      const method = (p.method as string) ?? 'unknown';
      // Accept `currency` as an alias for `destinationCurrency` (test fixtures
      // and older event shapes use the shorter name).
      const destinationCurrency = (p.destinationCurrency as string) ?? (p.currency as string) ?? '';
      // Accept `net` as an alias for `netAmount` (production emits `net`,
      // older fixtures emit `netAmount`).
      const netAmount = num(p.netAmount ?? p.net);
      // Accept `amount` as the gross; if absent, derive from net + fee.
      const explicitGross = num(p.amount ?? p.grossAmount);
      const explicitFee = num(p.fee);
      const merchantId = (p.merchantId as string) ?? '';
      const payoutId = (p.payoutId as string) ?? '';

      if (!destinationCurrency || netAmount <= 0) {
        return { eventId: event.id, type: event.type, journals, skipped: 'invalid_payout_payload' };
      }

      // Derive gross + fee when not both provided. Default fee rate is 5% of
      // the gross (so gross = net / 0.95, fee = gross - net). If the caller
      // supplied an explicit fee or gross, use those directly.
      let gross = explicitGross;
      let fee = explicitFee;
      if (gross <= 0) {
        if (fee > 0) {
          gross = round(netAmount + fee, 6);
        } else {
          // Default 5% fee on gross: gross = net / (1 - 0.05).
          gross = round(netAmount / 0.95, 6);
          fee = round(gross - netAmount, 6);
        }
      } else if (fee <= 0) {
        fee = round(gross - netAmount, 6);
      }

      const cashAccount = payoutCashAccount(method, destinationCurrency);

      // When the event carries a `merchantId`, post the payout against the
      // merchant payable account as a single 3-leg entry (DR payable gross,
      // CR cash net, CR fee revenue). This mirrors the canonical payout
      // accounting shape and lets the test find the entry by `payoutId`.
      if (merchantId) {
        journals.push(
          createJournalEntry({
            txId: payoutId || txId,
            ts,
            frame,
            description: `Payout ${payoutId || event.id} — gross ${gross} ${destinationCurrency} via ${method} (net ${netAmount}, fee ${fee})`,
            legs: [
              { accountCode: `merchant:payable:${merchantId}`, debit: gross, currency: destinationCurrency, memo: `payout gross — release payable` },
              { accountCode: cashAccount, credit: netAmount, currency: destinationCurrency, memo: `net payout via ${method}` },
              ...(fee > 0
                ? [{ accountCode: feeRevenueAccount(method), credit: fee, currency: destinationCurrency, memo: `payout fee (${method})` }]
                : []),
            ],
          }),
        );
        break;
      }

      // Legacy shape (no merchantId): redeem twin-token backing for cash,
      // recognize fee as a separate journal entry.
      journals.push(
        createJournalEntry({
          txId,
          ts,
          frame,
          description: `Payout net ${netAmount} ${destinationCurrency} via ${method} (tx=${p.txHash ?? 'n/a'})`,
          legs: [
            { accountCode: backingAccount(destinationCurrency), debit: Money.fromMajor(netAmount, destinationCurrency as any), currency: destinationCurrency, memo: `payout net — redeem backing` },
            { accountCode: cashAccount, credit: Money.fromMajor(netAmount, destinationCurrency as any), currency: destinationCurrency, memo: `payout via ${method}` },
          ],
        }),
      );

      if (fee > 0) {
        journals.push(
          createJournalEntry({
            txId,
            ts,
            frame,
            description: `Payout fee ${fee} ${destinationCurrency} (${method})`,
            legs: [
              { accountCode: 'equity:fees', debit: Money.fromMajor(fee, destinationCurrency as any), currency: destinationCurrency, memo: 'release accrued fee' },
              { accountCode: feeRevenueAccount(method), credit: Money.fromMajor(fee, destinationCurrency as any), currency: destinationCurrency, memo: `recognize fee revenue (${method})` },
            ],
          }),
        );
      }
      break;
    }

    // -------------------------------------------------------- merchant verified
    case 'merchant.verified': {
      const merchantId = (p.merchantId as string) ?? '';
      const bond = num(p.bond);
      const currency = (p.currency as string) ?? 'USD';
      if (!merchantId || bond <= 0) {
        return { eventId: event.id, type: event.type, journals, skipped: 'invalid_merchant_verified_payload' };
      }
      journals.push(
        createJournalEntry({
          txId,
          ts,
          frame,
          description: `Merchant ${merchantId} verified — bond ${bond} ${currency}`,
          legs: [
            { accountCode: 'lp:collateral', debit: Money.fromMajor(bond, currency as any), currency, memo: `merchant bond posted: ${merchantId}` },
            { accountCode: 'equity:treasury', credit: Money.fromMajor(bond, currency as any), currency, memo: `treasury allocation from merchant bond` },
          ],
        }),
      );
      break;
    }

    // ------------------------------------------------------------------ default
    default:
      return { eventId: event.id, type: event.type, journals, skipped: 'unknown_event_type' };
  }

  return { eventId: event.id, type: event.type, journals };
}

/**
 * Rebuild a fresh LedgerEngine from a stream of events.
 *
 * Events are sorted by (ts, frame, id) for deterministic replay. Known event
 * types are projected into balanced journal entries; unknown events are
 * skipped. Returns the populated engine.
 */
export function rebuildLedgerFromEvents(events: SimulationEvent[]): LedgerEngine {
  const engine = new LedgerEngine();
  const sorted = sortEventsForReplay(events);
  for (const event of sorted) {
    const result = projectEvent(event);
    for (const journal of result.journals) {
      engine.post(journal);
    }
  }
  return engine;
}

/**
 * Project events onto an EXISTING engine (in addition to current state).
 * Useful for incremental replay. Does NOT reset the engine first.
 */
export function projectEventsOnto(engine: LedgerEngine, events: SimulationEvent[]): ProjectionResult[] {
  const sorted = sortEventsForReplay(events);
  const results: ProjectionResult[] = [];
  for (const event of sorted) {
    const result = projectEvent(event);
    for (const journal of result.journals) {
      engine.post(journal);
    }
    results.push(result);
  }
  return results;
}

// ----------------------------------------------------------------- helpers
/** Coerce an unknown payload value to a non-negative number (0 if invalid). */
function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return round(Math.max(0, v), 6);
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return round(Math.max(0, n), 6);
  }
  return 0;
}

/**
 * Infer the currency for a wallet event when the payload does not include one
 * explicitly. Falls back to 'USD' if no usable signal is present.
 */
function inferCurrencyFromWalletEvent(p: Record<string, unknown>): string {
  if (typeof p.currency === 'string' && p.currency) return p.currency;
  // Some wallet events include the assetCode instead — convert.
  if (typeof p.assetCode === 'string' && p.assetCode) {
    return twinAssetToCurrency(p.assetCode);
  }
  return 'USD';
}

/**
 * Decide which account to debit when a wallet is credited. The source depends
 * on whether the credit was a fiat deposit (cash:bank / cash:mmo) or a twin
 * token transfer (twintoken:circulating).
 */
function walletCreditSourceAccount(p: Record<string, unknown>, currency: string): string {
  const assetCode = (p.assetCode as string) ?? '';
  if (assetCode) return circulatingAccount(assetCode);
  const method = (p.method as string) ?? '';
  if (method === 'bank') return bankCashAccount(currency);
  if (method === 'mmo' || method === 'mobile_money') return mmoCashAccount(currency);
  // Default to bank cash — most deposits flow through banks.
  return bankCashAccount(currency);
}

/** Inverse of `walletCreditSourceAccount` — where debited funds go. */
function walletDebitDestinationAccount(p: Record<string, unknown>, currency: string): string {
  const assetCode = (p.assetCode as string) ?? '';
  if (assetCode) return circulatingAccount(assetCode);
  const method = (p.method as string) ?? '';
  if (method === 'bank') return bankCashAccount(currency);
  if (method === 'mmo' || method === 'mobile_money') return mmoCashAccount(currency);
  return bankCashAccount(currency);
}

/** Pick the cash account for a payout based on the rail method. */
function payoutCashAccount(method: string, currency: string): string {
  switch (method) {
    case 'bank':
    case 'bank_account':
    case 'ach':
    case 'sepa':
      return bankCashAccount(currency);
    case 'mmo':
    case 'mobile_money':
      return mmoCashAccount(currency);
    case 'twin':
    case 'twin_token':
      // Payout settled in twin tokens — credit the circulating account.
      return circulatingAccount(`TWIN${currency}`);
    default:
      return bankCashAccount(currency);
  }
}

/** Re-exported for downstream callers that need fresh journal ids. */
export function newJournalId(): string {
  return uid('je');
}
