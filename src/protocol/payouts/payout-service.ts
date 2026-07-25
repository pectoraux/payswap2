/**
 * PaySwap Protocol — Payout / Withdrawal Service.
 *
 * Closes the merchant money loop. After a payment settles, the merchant's
 * Twin Token balance grows. This service lets them withdraw that balance to:
 *
 *   1. Fiat (bank account via Open Banking, or mobile money via M-Pesa)
 *      → Twin Tokens are burned (redeemed) and the connector initiates the
 *        external fiat transfer, producing cryptographic Evidence.
 *
 *   2. On-chain wallet (external Stellar address)
 *      → Twin Tokens are transferred to the external wallet via the
 *        blockchain adapter, producing on-chain Evidence.
 *
 * Lifecycle:
 *   requested → reviewing → processing → completed
 *                         ↘ failed
 *   requested → cancelled
 *
 * All state changes go through the event bus. All external truth comes from
 * connectors (Evidence). The kernel is untouched — this is pure protocol
 * built on top of the frozen 7 primitives.
 *
 * Webhooks fired:
 *   payout.requested, payout.processing, payout.completed, payout.failed
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { createEvidence, type Evidence } from '@/kernel/evidence';
import { twinTokenEngine } from '../twin-token/engine';
import { webhookEngine } from '../webhooks/engine';
import {
  OpenBankingConnector,
  MpesaConnector,
  ExchangeRateConnector,
  connectorRegistry,
} from '../connectors/adapters';

export type PayoutMethod = 'bank' | 'mobile_money' | 'onchain';
export type PayoutState = 'requested' | 'reviewing' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface PayoutQuote {
  payoutId: string;
  method: PayoutMethod;
  sourceAsset: string;          // e.g. TWINGHS
  sourceAmount: number;         // amount of Twin Tokens to redeem
  sourceCurrency: string;       // e.g. GHS
  destinationCurrency: string;  // e.g. GHS (bank), KES (mobile), or source (onchain)
  fxRate: number;               // 1 source = fxRate destination
  feeBps: number;               // protocol fee in basis points
  fee: number;                  // computed fee (in destination currency)
  netAmount: number;            // what the merchant receives (destination currency)
  estimatedSettlementMs: number;
  availableBalance: number;     // merchant's available Twin Token balance
  fxEvidence?: Evidence;
}

export interface Payout {
  id: string;
  merchantId: string;
  method: PayoutMethod;
  state: PayoutState;
  sourceAsset: string;
  sourceAmount: number;
  sourceCurrency: string;
  destinationCurrency: string;
  destination: {
    bankAccount?: string;       // for 'bank'
    phoneNumber?: string;       // for 'mobile_money'
    walletAddress?: string;     // for 'onchain'
    accountName?: string;
  };
  fxRate: number;
  feeBps: number;
  fee: number;
  netAmount: number;
  txHash?: string;              // on-chain tx (onchain) or external reference (fiat)
  evidence?: Evidence;          // cryptographic evidence from connector / adapter
  reason?: string;              // failure reason
  createdAt: number;
  processedAt: number | null;
  completedAt: number | null;
  history: { from: PayoutState; to: PayoutState; ts: number; note: string }[];
}

export interface PayoutStats {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  totalVolume: number;          // sum of sourceAmount for completed payouts
  totalFees: number;            // sum of fees collected
  byMethod: Record<PayoutMethod, number>;
}

class PayoutService {
  private payouts: Map<string, Payout> = new Map();
  private openBanking: OpenBankingConnector | null = null;
  private mpesa: MpesaConnector | null = null;
  private fx: ExchangeRateConnector | null = null;
  private initialized = false;

  /** Lazily register connectors (idempotent across requests). */
  private init(): void {
    if (this.initialized) return;
    this.openBanking = new OpenBankingConnector();
    this.mpesa = new MpesaConnector();
    this.fx = new ExchangeRateConnector();
    connectorRegistry.register(this.openBanking);
    connectorRegistry.register(this.mpesa);
    connectorRegistry.register(this.fx);
    this.initialized = true;
  }

  /** Merchant holder key on the Twin Token engine (1:1 with merchant ID). */
  private holderFor(merchantId: string): string { return `merchant:${merchantId}`; }

  /** Fee schedule (basis points). Protocol data — adjustable without kernel change. */
  private feeBpsFor(method: PayoutMethod): number {
    switch (method) {
      case 'bank': return 50;          // 0.50%
      case 'mobile_money': return 75;  // 0.75%
      case 'onchain': return 10;       // 0.10%
    }
  }

  /** ETA in ms by method. Protocol data. */
  private etaFor(method: PayoutMethod): number {
    switch (method) {
      case 'bank': return 86_400_000;   // T+1
      case 'mobile_money': return 60_000; // 1 minute
      case 'onchain': return 5_000;     // ~5s on Stellar
    }
  }

  /**
   * Quote a payout — preview FX rate, fee, and net amount without executing.
   * Pulls the FX rate from the ExchangeRateConnector (Evidence-backed).
   */
  async quote(params: {
    merchantId: string;
    method: PayoutMethod;
    sourceAsset: string;
    sourceAmount: number;
    sourceCurrency: string;
    destinationCurrency: string;
  }): Promise<PayoutQuote> {
    this.init();
    const available = twinTokenEngine.getAvailableBalance(this.holderFor(params.merchantId), params.sourceAsset);

    // Fetch FX rate (only matters when currencies differ; on-chain is 1:1)
    let fxRate = 1;
    let fxEvidence: Evidence | undefined;
    if (params.sourceCurrency !== params.destinationCurrency) {
      const r = await this.fx!.query({
        fromCurrency: params.sourceCurrency,
        toCurrency: params.destinationCurrency,
      });
      if (r.success && r.evidence) {
        fxRate = (r.evidence.payload.rate as number) ?? 1;
        fxEvidence = r.evidence;
      }
    }

    const feeBps = this.feeBpsFor(params.method);
    const gross = round(params.sourceAmount * fxRate, 6);
    const fee = round(gross * (feeBps / 10000), 6);
    const netAmount = round(gross - fee, 6);

    return {
      payoutId: uid('payout_quote'),
      method: params.method,
      sourceAsset: params.sourceAsset,
      sourceAmount: params.sourceAmount,
      sourceCurrency: params.sourceCurrency,
      destinationCurrency: params.destinationCurrency,
      fxRate,
      feeBps,
      fee,
      netAmount,
      estimatedSettlementMs: this.etaFor(params.method),
      availableBalance: available,
      fxEvidence,
    };
  }

  /**
   * Create a payout request. State: requested → reviewing.
   * Funds are NOT yet debited; the merchant can still cancel.
   */
  async request(params: {
    merchantId: string;
    method: PayoutMethod;
    sourceAsset: string;
    sourceAmount: number;
    sourceCurrency: string;
    destinationCurrency: string;
    destination: Payout['destination'];
    note?: string;
  }): Promise<Payout> {
    this.init();
    const holder = this.holderFor(params.merchantId);
    const available = twinTokenEngine.getAvailableBalance(holder, params.sourceAsset);
    if (available < params.sourceAmount) {
      throw new Error(`Insufficient Twin Token balance: have ${available} ${params.sourceAsset}`);
    }

    const q = await this.quote(params);

    const payout: Payout = {
      id: uid('payout'),
      merchantId: params.merchantId,
      method: params.method,
      state: 'reviewing',
      sourceAsset: params.sourceAsset,
      sourceAmount: params.sourceAmount,
      sourceCurrency: params.sourceCurrency,
      destinationCurrency: params.destinationCurrency,
      destination: params.destination,
      fxRate: q.fxRate,
      feeBps: q.feeBps,
      fee: q.fee,
      netAmount: q.netAmount,
      createdAt: Date.now(),
      processedAt: null,
      completedAt: null,
      history: [
        { from: 'requested', to: 'requested', ts: Date.now(), note: params.note ?? 'Payout requested' },
        { from: 'requested', to: 'reviewing', ts: Date.now(), note: 'Auto-promoted to review' },
      ],
    };
    this.payouts.set(payout.id, payout);

    eventEngine.emit('payout.requested', {
      payoutId: payout.id, merchantId: payout.merchantId, method: payout.method,
      sourceAmount: payout.sourceAmount, sourceAsset: payout.sourceAsset,
      netAmount: payout.netAmount, destinationCurrency: payout.destinationCurrency,
    }, 0);
    await webhookEngine.emit({
      merchantId: payout.merchantId,
      eventType: 'payout.requested',
      payload: {
        payoutId: payout.id, method: payout.method, amount: payout.sourceAmount,
        asset: payout.sourceAsset, net: payout.netAmount, currency: payout.destinationCurrency,
      },
    });

    return payout;
  }

  /**
   * Process the payout. This is the irreversible step:
   *   - burn Twin Tokens (fiat) OR transfer Twin Tokens (onchain)
   *   - call connector / adapter to perform external leg
   *   - record Evidence + txHash
   *   - fire webhooks
   */
  async process(payoutId: string): Promise<Payout> {
    this.init();
    const payout = this.payouts.get(payoutId);
    if (!payout) throw new Error('Payout not found');
    if (payout.state !== 'reviewing' && payout.state !== 'requested') {
      throw new Error(`Cannot process payout in state ${payout.state}`);
    }

    const holder = this.holderFor(payout.merchantId);

    payout.state = 'processing';
    payout.processedAt = Date.now();
    payout.history.push({ from: 'reviewing', to: 'processing', ts: Date.now(), note: 'Processing started' });
    eventEngine.emit('payout.processing', { payoutId: payout.id, merchantId: payout.merchantId }, 0);
    await webhookEngine.emit({
      merchantId: payout.merchantId,
      eventType: 'payout.processing',
      payload: { payoutId: payout.id },
    });

    try {
      if (payout.method === 'onchain') {
        // On-chain: transfer Twin Tokens to external wallet
        const op = await twinTokenEngine.transfer(
          payout.sourceAsset,
          payout.sourceAmount,
          holder,
          payout.destination.walletAddress!,
          `Payout ${payout.id}`,
        );
        if (op.status !== 'confirmed' || !op.txHash) {
          throw new Error('On-chain transfer failed');
        }
        payout.txHash = op.txHash;
        payout.evidence = createEvidence({
          type: 'attestation',
          source: 'on_chain_state',
          verificationLevel: 'cryptographic',
          entityId: `stellar:${op.txHash}`,
          attestedAmount: payout.sourceAmount,
          currency: payout.sourceAsset,
          reputation: op.evidence?.confidence ?? 1.0,
          attester: 'stellar_adapter',
          ttlMs: 999_999_999,
          payload: { chain: 'stellar', txHash: op.txHash, operation: 'payout_transfer', to: payout.destination.walletAddress },
        });
      } else {
        // Fiat: burn Twin Tokens (redeem), then connector initiates external transfer
        const burn = await twinTokenEngine.burn(payout.sourceAsset, payout.sourceAmount, holder);
        if (burn.status !== 'confirmed' || !burn.txHash) {
          throw new Error('Twin Token burn failed');
        }

        const connector = payout.method === 'bank' ? this.openBanking! : this.mpesa!;
        const externalRef = uid(payout.method === 'bank' ? 'bank_tx' : 'mpesa_tx');
        const r = await connector.query(
          payout.method === 'bank'
            ? { accountId: payout.destination.bankAccount, currency: payout.destinationCurrency, expectedBalance: payout.netAmount }
            : { phoneNumber: payout.destination.phoneNumber, currency: payout.destinationCurrency, balance: payout.netAmount },
        );
        if (!r.success || !r.evidence) {
          throw new Error('External transfer failed');
        }
        payout.txHash = externalRef;
        payout.evidence = r.evidence;
      }

      payout.state = 'completed';
      payout.completedAt = Date.now();
      payout.history.push({ from: 'processing', to: 'completed', ts: Date.now(), note: `Settled ${payout.netAmount} ${payout.destinationCurrency}` });

      eventEngine.emit('payout.completed', {
        payoutId: payout.id, merchantId: payout.merchantId, method: payout.method,
        netAmount: payout.netAmount, currency: payout.destinationCurrency,
        txHash: payout.txHash, evidenceSource: payout.evidence?.source,
      }, 0);
      await webhookEngine.emit({
        merchantId: payout.merchantId,
        eventType: 'payout.completed',
        payload: {
          payoutId: payout.id, method: payout.method, net: payout.netAmount,
          currency: payout.destinationCurrency, txHash: payout.txHash,
        },
      });

      return payout;
    } catch (e) {
      payout.state = 'failed';
      payout.reason = e instanceof Error ? e.message : 'Payout failed';
      payout.history.push({ from: 'processing', to: 'failed', ts: Date.now(), note: payout.reason });

      eventEngine.emit('payout.failed', {
        payoutId: payout.id, merchantId: payout.merchantId, reason: payout.reason,
      }, 0);
      await webhookEngine.emit({
        merchantId: payout.merchantId,
        eventType: 'payout.failed',
        payload: { payoutId: payout.id, reason: payout.reason },
      });

      return payout;
    }
  }

  /** Cancel a payout (only allowed before processing). */
  cancel(payoutId: string, reason: string): Payout {
    const payout = this.payouts.get(payoutId);
    if (!payout) throw new Error('Payout not found');
    if (payout.state === 'processing' || payout.state === 'completed') {
      throw new Error(`Cannot cancel payout in state ${payout.state}`);
    }
    const prev = payout.state;
    payout.state = 'cancelled';
    payout.history.push({ from: prev, to: 'cancelled', ts: Date.now(), note: reason });
    eventEngine.emit('payout.cancelled', { payoutId: payout.id, reason }, 0);
    return payout;
  }

  /** Get a single payout. */
  get(payoutId: string): Payout | undefined { return this.payouts.get(payoutId); }

  /** List payouts, optionally filtered by merchant and/or state. */
  list(filter?: { merchantId?: string; state?: PayoutState }): Payout[] {
    let list = [...this.payouts.values()];
    if (filter?.merchantId) list = list.filter((p) => p.merchantId === filter.merchantId);
    if (filter?.state) list = list.filter((p) => p.state === filter.state);
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Aggregate stats for a merchant. */
  stats(merchantId: string): PayoutStats {
    const list = this.list({ merchantId });
    const completed = list.filter((p) => p.state === 'completed');
    const failed = list.filter((p) => p.state === 'failed');
    const pending = list.filter((p) => p.state === 'requested' || p.state === 'reviewing' || p.state === 'processing');
    const byMethod: Record<PayoutMethod, number> = { bank: 0, mobile_money: 0, onchain: 0 };
    for (const p of completed) byMethod[p.method]++;
    return {
      total: list.length,
      completed: completed.length,
      failed: failed.length,
      pending: pending.length,
      totalVolume: round(completed.reduce((s, p) => s + p.sourceAmount, 0), 6),
      totalFees: round(completed.reduce((s, p) => s + p.fee, 0), 6),
      byMethod,
    };
  }

  /** Get a merchant's available Twin Token balance for an asset. */
  availableBalance(merchantId: string, assetCode: string): number {
    return twinTokenEngine.getAvailableBalance(this.holderFor(merchantId), assetCode);
  }

  /**
   * Credit a merchant's Twin Token balance (e.g. when a payment settles to them).
   * Used by the seed/demo flow to give merchants a balance to withdraw.
   */
  async creditMerchant(merchantId: string, assetCode: string, amount: number, memo: string): Promise<void> {
    const holder = this.holderFor(merchantId);
    // Mint to the issuer then transfer to the merchant holder
    const asset = twinTokenEngine.getAsset(assetCode);
    if (!asset) throw new Error(`Unknown asset: ${assetCode}`);
    await twinTokenEngine.mint(assetCode, amount, holder);
  }

  reset(): void { this.payouts.clear(); }
}

export const payoutService = new PayoutService();
