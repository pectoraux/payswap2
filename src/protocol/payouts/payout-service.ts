/**
 * PaySwap Protocol — Payout Service.
 *
 * Merchants withdraw funds from their TWIN token balance to an external
 * rail (bank, mobile money, or onchain wallet). The service:
 *
 *   1. Quotes a payout (fxRate, feeBps, fee, netAmount, ETA)
 *   2. Creates a payout in `reviewing` state
 *   3. Processes it irreversibly:
 *        - bank / mobile_money  → burn TWIN tokens + connector query
 *        - onchain              → transfer TWIN tokens to destination wallet
 *
 * Fees (basis points):
 *   bank 50bps, mobile_money 75bps, onchain 10bps.
 *
 * ETA (ms):
 *   bank 86_400_000 (1 day), mobile 60_000 (1 min), onchain 5_000 (5 sec).
 *
 * All value movements go through the twinTokenEngine under holder key
 * `merchant:${merchantId}`. Webhook events fire on every state transition.
 *
 * The kernel is FROZEN — this module imports only from `@/kernel/*`,
 * `@/protocol/twin-token/engine`, `@/protocol/webhooks/engine`, and
 * optionally `@/protocol/connectors/adapters` (best-effort).
 */
import { uid, round, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { createEvidence, type Evidence } from '@/kernel/evidence';
import { twinTokenEngine } from '@/protocol/twin-token/engine';
import { webhookEngine } from '@/protocol/webhooks/engine';

// Best-effort import of connectors. If the connectors module isn't present
// (it doesn't ship with this milestone), the service falls back to simulated
// evidence for the external leg. The `queryConnector` helper below consults
// any registered connector instances at runtime via the registry on the
// global object, so callers can wire real connectors in without touching
// this module. For now, simulated evidence is the default.
const CONNECTOR_REGISTRY: { openBanking?: any; mpesa?: any; exchangeRate?: any } =
  (globalThis as any).__PAYSWAP_CONNECTORS__ ?? {};

export type PayoutMethod = 'bank' | 'mobile_money' | 'onchain';

export type PayoutState =
  | 'reviewing'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface PayoutQuote {
  method: PayoutMethod;
  sourceAsset: string;
  sourceAmount: number;
  sourceCurrency: string;
  destinationCurrency: string;
  fxRate: number;
  feeBps: number;
  fee: number;
  netAmount: number;
  destinationAmount: number;
  estimatedSettlementMs: number;
  availableBalance: number;
  quotedAt: number;
}

export interface PayoutDestination {
  method: PayoutMethod;
  bankCode?: string;
  accountNumber?: string;
  accountName?: string;
  msisdn?: string;          // mobile money phone
  chain?: string;           // 'stellar'
  address?: string;         // onchain wallet address
  country?: string;
}

export interface Payout {
  id: string;
  merchantId: string;
  method: PayoutMethod;
  sourceAsset: string;
  sourceAmount: number;
  sourceCurrency: string;
  destinationCurrency: string;
  destinationAmount: number;
  fxRate: number;
  feeBps: number;
  fee: number;
  netAmount: number;
  destination: PayoutDestination;
  note?: string;
  state: PayoutState;
  evidence: Evidence[];
  txHash?: string;
  failureReason?: string;
  estimatedSettlementMs: number;
  createdAt: number;
  processingAt: number | null;
  completedAt: number | null;
}

export interface PayoutStats {
  merchantId: string;
  total: number;
  byState: Record<PayoutState, number>;
  totalVolume: number;
  totalFees: number;
  totalNet: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
}

const FEE_BPS: Record<PayoutMethod, number> = {
  bank: 50,
  mobile_money: 75,
  onchain: 10,
};

const ETA_MS: Record<PayoutMethod, number> = {
  bank: 86_400_000,
  mobile_money: 60_000,
  onchain: 5_000,
};

// Reasonable FX reference rates for the simulated runtime. Real deployments
// pull these from the ExchangeRateConnector.
const REFERENCE_FX: Record<string, number> = {
  'GHS:GHS': 1,
  'KES:KES': 1,
  'NGN:NGN': 1,
  'USD:USD': 1,
  'GHS:USD': 0.08,
  'USD:GHS': 12.5,
  'KES:USD': 0.0077,
  'USD:KES': 130,
  'GHS:KES': 12,
  'KES:GHS': 0.083,
  'NGN:USD': 0.00067,
  'USD:NGN': 1495,
};

export class PayoutService {
  private payouts = new Map<string, Payout>();

  // ----------------------------------------------------------- holder key
  holder(merchantId: string): string {
    return `merchant:${merchantId}`;
  }

  // --------------------------------------------------------------- quote
  async quote(params: {
    merchantId: string;
    method: PayoutMethod;
    sourceAsset: string;
    sourceAmount: number;
    sourceCurrency: string;
    destinationCurrency: string;
  }): Promise<PayoutQuote> {
    const { merchantId, method, sourceAsset, sourceAmount, sourceCurrency, destinationCurrency } = params;
    const feeBps = FEE_BPS[method];
    const fee = round((sourceAmount * feeBps) / 10_000, 6);
    const netAmount = round(sourceAmount - fee, 6);
    const fxRate = this.fxRate(sourceCurrency, destinationCurrency);
    const destinationAmount = round(netAmount * fxRate, 6);
    const availableBalance = twinTokenEngine.getAvailableBalance(this.holder(merchantId), sourceAsset);
    const estimatedSettlementMs = ETA_MS[method];
    return {
      method, sourceAsset, sourceAmount, sourceCurrency, destinationCurrency,
      fxRate, feeBps, fee, netAmount, destinationAmount,
      estimatedSettlementMs, availableBalance,
      quotedAt: nowTs(),
    };
  }

  // ------------------------------------------------------------- request
  async request(params: {
    merchantId: string;
    method: PayoutMethod;
    sourceAsset: string;
    sourceAmount: number;
    sourceCurrency: string;
    destinationCurrency: string;
    destination: PayoutDestination;
    note?: string;
  }): Promise<Payout> {
    const q = await this.quote({
      merchantId: params.merchantId,
      method: params.method,
      sourceAsset: params.sourceAsset,
      sourceAmount: params.sourceAmount,
      sourceCurrency: params.sourceCurrency,
      destinationCurrency: params.destinationCurrency,
    });
    const id = uid('po');
    const payout: Payout = {
      id,
      merchantId: params.merchantId,
      method: params.method,
      sourceAsset: params.sourceAsset,
      sourceAmount: params.sourceAmount,
      sourceCurrency: params.sourceCurrency,
      destinationCurrency: params.destinationCurrency,
      destinationAmount: q.destinationAmount,
      fxRate: q.fxRate,
      feeBps: q.feeBps,
      fee: q.fee,
      netAmount: q.netAmount,
      destination: params.destination,
      note: params.note,
      state: 'reviewing',
      evidence: [],
      estimatedSettlementMs: q.estimatedSettlementMs,
      createdAt: nowTs(),
      processingAt: null,
      completedAt: null,
    };
    this.payouts.set(id, payout);
    eventEngine.emit('payout.requested', {
      payoutId: id,
      merchantId: params.merchantId,
      method: params.method,
      sourceAsset: params.sourceAsset,
      sourceAmount: params.sourceAmount,
      destinationAmount: payout.destinationAmount,
      destinationCurrency: params.destinationCurrency,
      fee: payout.fee,
      netAmount: payout.netAmount,
    }, 0);
    await webhookEngine.emit({
      merchantId: params.merchantId,
      eventType: 'payout.requested',
      payload: { payoutId: id, method: params.method, sourceAmount: params.sourceAmount, destinationAmount: payout.destinationAmount, state: payout.state },
    });
    return payout;
  }

  // -------------------------------------------------------------- process
  async process(payoutId: string): Promise<Payout> {
    const p = this.payouts.get(payoutId);
    if (!p) throw new Error(`payout ${payoutId} not found`);
    if (p.state !== 'reviewing') throw new Error(`payout ${payoutId} cannot transition from ${p.state}`);
    p.state = 'processing';
    p.processingAt = nowTs();
    eventEngine.emit('payout.processing', { payoutId, merchantId: p.merchantId, method: p.method }, 0);
    await webhookEngine.emit({
      merchantId: p.merchantId,
      eventType: 'payout.processing',
      payload: { payoutId, method: p.method, state: p.state },
    });

    try {
      const holder = this.holder(p.merchantId);
      const amount = p.sourceAmount;
      if (p.method === 'onchain') {
        // Onchain: transfer TWIN tokens to destination wallet.
        const dest = p.destination.address ?? `wallet:${p.merchantId}`;
        const res = await twinTokenEngine.transfer(p.sourceAsset, amount, holder, dest, `payout:${p.id}`);
        if (!res.success || !res.txHash) {
          throw new Error(res.error ?? 'onchain_transfer_failed');
        }
        p.txHash = res.txHash;
        p.evidence.push(this.simulatedEvidence(p, `onchain-transfer:${res.txHash}`));
      } else {
        // Bank / mobile: burn TWIN tokens and query the connector.
        const burn = await twinTokenEngine.burn(p.sourceAsset, amount, holder);
        if (!burn.success || !burn.txHash) {
          throw new Error(burn.error ?? 'burn_failed');
        }
        p.txHash = burn.txHash;
        // External leg via connector if available; otherwise simulated evidence.
        const external = await this.queryConnector(p);
        p.evidence.push(this.simulatedEvidence(p, `burn:${burn.txHash}`));
        if (external) p.evidence.push(external);
      }

      p.state = 'completed';
      p.completedAt = nowTs();
      eventEngine.emit('payout.completed', {
        payoutId, merchantId: p.merchantId, method: p.method,
        sourceAmount: p.sourceAmount, destinationAmount: p.destinationAmount,
        txHash: p.txHash, fee: p.fee, netAmount: p.netAmount,
      }, 0);
      await webhookEngine.emit({
        merchantId: p.merchantId,
        eventType: 'payout.completed',
        payload: { payoutId, state: p.state, txHash: p.txHash, destinationAmount: p.destinationAmount },
      });
    } catch (err) {
      p.state = 'failed';
      p.failureReason = err instanceof Error ? err.message : 'unknown';
      eventEngine.emit('payout.failed', {
        payoutId, merchantId: p.merchantId, reason: p.failureReason,
      }, 0);
      await webhookEngine.emit({
        merchantId: p.merchantId,
        eventType: 'payout.failed',
        payload: { payoutId, state: p.state, reason: p.failureReason },
      });
    }
    return p;
  }

  // -------------------------------------------------------------- cancel
  cancel(payoutId: string, reason: string): Payout | null {
    const p = this.payouts.get(payoutId);
    if (!p) return null;
    if (p.state === 'completed' || p.state === 'processing') return null;
    p.state = 'cancelled';
    p.failureReason = reason;
    eventEngine.emit('payout.cancelled', { payoutId, merchantId: p.merchantId, reason }, 0);
    return p;
  }

  // ----------------------------------------------------------- accessors
  get(payoutId: string): Payout | undefined { return this.payouts.get(payoutId); }

  list(filter?: { merchantId?: string; state?: PayoutState }): Payout[] {
    let out = [...this.payouts.values()];
    if (filter?.merchantId) out = out.filter((p) => p.merchantId === filter.merchantId);
    if (filter?.state) out = out.filter((p) => p.state === filter.state);
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  stats(merchantId: string): PayoutStats {
    const items = this.list({ merchantId });
    const byState: Record<PayoutState, number> = {
      reviewing: 0, processing: 0, completed: 0, failed: 0, cancelled: 0,
    };
    let totalVolume = 0, totalFees = 0, totalNet = 0;
    for (const p of items) {
      byState[p.state] += 1;
      totalVolume = round(totalVolume + p.sourceAmount, 6);
      totalFees = round(totalFees + p.fee, 6);
      totalNet = round(totalNet + p.netAmount, 6);
    }
    return {
      merchantId,
      total: items.length,
      byState,
      totalVolume,
      totalFees,
      totalNet,
      completedCount: byState.completed,
      failedCount: byState.failed,
      pendingCount: byState.reviewing + byState.processing,
    };
  }

  // ---------------------------------------------------- availableBalance
  availableBalance(merchantId: string, assetCode: string): number {
    return twinTokenEngine.getAvailableBalance(this.holder(merchantId), assetCode);
  }

  // ------------------------------------------------------- creditMerchant
  async creditMerchant(merchantId: string, assetCode: string, amount: number, memo: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    return twinTokenEngine.mint(assetCode, amount, this.holder(merchantId));
  }

  // --------------------------------------------------------------- reset
  reset(): void {
    this.payouts.clear();
  }

  // ----------------------------------------------------------- internals
  private fxRate(from: string, to: string): number {
    if (from === to) return 1;
    const direct = REFERENCE_FX[`${from}:${to}`];
    if (direct) return direct;
    // Cross via USD if both legs known.
    const fromUsd = REFERENCE_FX[`${from}:USD`];
    const usdTo = REFERENCE_FX[`USD:${to}`];
    if (fromUsd && usdTo) return round(fromUsd * usdTo, 6);
    return 1;
  }

  private async queryConnector(p: Payout): Promise<Evidence | null> {
    try {
      if (p.method === 'bank' && CONNECTOR_REGISTRY.openBanking) {
        const inst = CONNECTOR_REGISTRY.openBanking;
        if (inst && typeof inst.initiateTransfer === 'function') {
          const r = await inst.initiateTransfer({
            amount: p.destinationAmount,
            currency: p.destinationCurrency,
            account: p.destination.accountNumber,
            name: p.destination.accountName,
          });
          if (r && r.reference) {
            return this.simulatedEvidence(p, `bank:${r.reference}`);
          }
        }
      }
      if (p.method === 'mobile_money' && CONNECTOR_REGISTRY.mpesa) {
        const inst = CONNECTOR_REGISTRY.mpesa;
        if (inst && typeof inst.sendB2C === 'function') {
          const r = await inst.sendB2C({
            amount: p.destinationAmount,
            currency: p.destinationCurrency,
            msisdn: p.destination.msisdn,
          });
          if (r && r.conversationId) {
            return this.simulatedEvidence(p, `mpesa:${r.conversationId}`);
          }
        }
      }
    } catch {
      // Fall through to simulated evidence.
    }
    return null;
  }

  private simulatedEvidence(p: Payout, ref: string): Evidence {
    return createEvidence({
      type: 'settlement_proof',
      source: p.method === 'onchain' ? 'on_chain_state' : 'open_banking',
      verificationLevel: p.method === 'onchain' ? 'cryptographic' : 'institutional',
      entityId: this.holder(p.merchantId),
      attestedAmount: p.destinationAmount,
      currency: p.destinationCurrency,
      attester: p.method === 'onchain' ? 'stellar-network' : `${p.method}-connector`,
      reputation: 1.0,
      payload: {
        payoutId: p.id,
        method: p.method,
        sourceAsset: p.sourceAsset,
        sourceAmount: p.sourceAmount,
        destinationAmount: p.destinationAmount,
        reference: ref,
      },
    });
  }
}

export const payoutService = new PayoutService();
