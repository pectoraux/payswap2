/**
 * Built-in Command Handlers. (M-RT-21, Phase 4.)
 *
 * Each handler processes one command type and produces events.
 * Handlers are PURE: they compute events, they don't append them.
 *
 * The dispatcher handles the actual append (after invariant verification).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INTEGRATE-1 (runtime-integration-agent): The PaymentCommandHandler,
 * RefundCommandHandler, and PayoutCommandHandler now produce the FULL event
 * chain needed by the Economic Kernel:
 *
 *   payment.create  → payment.recorded + payment.completed + ledger.entry.posted
 *   refund.create   → refund.requested  + refund.executed  + ledger.entry.posted
 *   payout.create   → payout.recorded   + payout.completed + ledger.entry.posted
 *
 * Each "ledger.entry.posted" event contains a balanced double-entry journal
 * (Σ debits == Σ credits) so the Economic Ledger can derive per-payment
 * accounting entries from the event store alone.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { RuntimeCommand } from './types';
import type { CommandHandler, CommandResult } from './registry';
import type { UncommittedEvent } from '../events';
import type { RuntimeSnapshot } from '../invariants';
import type { Environment } from '../types';
import { uid } from '../types';
import { selectSettlementSource, isLocal, twinTokenCode, resolvePayment, type WaterfallInput, type WaterfallResult, type SettlementTier, TIER_FEES, TIER_NAMES } from '../liquidity/settlement-waterfall';
import { backingVerifier } from '../../protocol/treasury-v2/backing';
import { reserveDriftMonitor } from '../../protocol/treasury-v2/reserve-drift-monitor';
import { backingFallbackTier, fxBlockPayment, isCorridorPaused } from '../../protocol/treasury-v2/closed-loop-controllers';
import { netSettlementEngine } from '../../protocol/settlement/net-settlement';
import { lpMandateService } from '../liquidity/lp-mandate-service';
import { fxExposureService } from '../liquidity/fx-exposure-service';
import { auctionEngine } from '../../protocol/settlement/auctions';
import { fxEngine } from '../../kernel/fx';
import { Money } from '../../money/money';
import type {
  CreatePaymentCommand,
  CreatePaymentPayload,
  CreateRefundCommand,
  CreateRefundPayload,
  ExecuteRefundCommand,
  ReserveLiquidityCommand,
  ReleaseLiquidityCommand,
  WalletCreditCommand,
  WalletDebitCommand,
  WalletReserveCommand,
  WalletReleaseCommand,
  CreatePayoutCommand,
  CreatePayoutPayload,
} from './types';

// ─── Enhanced Payloads (INTEGRATE-1) ──────────────────────────────────────
//
// The frozen `CreatePaymentPayload` in types.ts is intentionally minimal so we
// accept the additional financial fields (lpId, lpFeeBps, success, customer
// contact) the runtime needs to compile a complete payment + ledger entry.
// The service layer passes these via the command payload; the handler reads
// them through this extended interface. No mutation of the frozen kernel.

interface EnhancedPaymentPayload extends CreatePaymentPayload {
  lpId?: string;
  lpFeeBps?: number;
  success?: boolean;
  customerName?: string;
  customerEmail?: string;
  actorId?: string;
  timestamp?: number;
  environment?: string;
  description?: string;
  reference?: string;
}

interface EnhancedRefundPayload extends CreateRefundPayload {
  environment?: string;
  actorId?: string;
  timestamp?: number;
  reason?: string;
}

interface EnhancedPayoutPayload extends CreatePayoutPayload {
  feeBps?: number;
  fee?: number;
  netAmount?: number;
  txHash?: string;
  evidence?: string;
  destination?: string;
  environment?: string;
  actorId?: string;
  timestamp?: number;
  success?: boolean;
}

// ─── Journal helpers (INTEGRATE-1) ────────────────────────────────────────
//
// Pure helpers that build balanced `ledger.entry.posted` events. Every entry
// has Σ debits == Σ credits (within a cent of floating-point epsilon).

interface JournalLine {
  account: string;
  debit: number;
  credit: number;
  description?: string;
}

function buildLedgerEntryEvent(
  env: string,
  correlationId: string,
  paymentRef: string,
  description: string,
  lines: JournalLine[],
): UncommittedEvent {
  // MON-4: exact balance check. Previously: Math.abs(debitSum - creditSum) < 0.01
  // (a tolerance that could conceal a one-cent-per-transaction leak). Now:
  // the debit and credit sums are rounded to 2 decimal places (cents) and
  // must be EXACTLY equal. A one-cent discrepancy fails the check.
  //
  // The rounding to 2dp is necessary because the input amounts are IEEE-754
  // doubles (MON-3 will replace them with integer minor units). Once MON-3
  // lands, this becomes a pure integer comparison with no rounding.
  const debitSum = Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100);
  const creditSum = Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100);
  return {
    type: 'ledger.entry.posted',
    streamId: `${env}:ledger:${paymentRef}`,
    streamType: 'ledger',
    kind: 'domain',
    payload: {
      entryId: uid('je'),
      refId: paymentRef,
      refType: 'payment',
      description,
      lines,
      debitTotal: debitSum / 100,
      creditTotal: creditSum / 100,
      isBalanced: debitSum === creditSum,
      postedAt: Date.now(),
      correlationId,
    } as unknown as Record<string, unknown>,
  };
}

// ─── Payment Command Handler ───────────────────────────────────────────────

/**
 * Handles "payment.create" — produces the full payment lifecycle event chain:
 *
 *   1. payment.recorded   (status PENDING) — always
 *   2. payment.completed  (status COMPLETED) — when payload.success !== false
 *      OR
 *      payment.failed     (status FAILED)    — when payload.success === false
 *   3. ledger.entry.posted — only when the payment succeeds, containing the
 *      balanced double-entry journal:
 *        Debit  asset:merchant_receivable        amount
 *        Credit liability:lp_payable             netAmount
 *        Credit equity:fee_income                fee
 *
 * The PaymentProjection consumes (1) + (2) to upsert the Prisma Payment row.
 * The ledger event (3) is the source of truth for the Economic Ledger's
 * per-payment journal entries.
 */
export class PaymentCommandHandler implements CommandHandler<CreatePaymentCommand> {
  readonly commandType = 'payment.create';
  readonly description = 'Create a new payment (produces payment.recorded + payment.completed/failed + ledger.entry.posted)';

  handle(command: CreatePaymentCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload as EnhancedPaymentPayload;
    const env = command.metadata.environment;
    const paymentId = uid('pay');
    const streamId = `${env}:payment:${paymentId}`;
    const now = payload.timestamp ?? Date.now();

    // Compile financial terms (fee / net) using exact Money arithmetic.
    // MON-3: previously `Math.round(payload.amount * (lpFeeBps / 10000) * 100) / 100`
    // — IEEE-754 double with rounding at each step. Now: Money.mulBps() uses
    // integer minor units with HALF_UP rounding. fee + net == gross exactly.
    const lpId = payload.lpId ?? 'lp_simulated';
    const lpFeeBps = payload.lpFeeBps ?? 80;
    const currency = (payload.destinationCurrency ?? payload.currency) as import('../../money/money').Currency;
    const grossMoney = Money.fromMajor(payload.amount, currency);
    const feeMoney = grossMoney.mulBps(lpFeeBps);
    const fee = feeMoney.toNumber();
    const success = payload.success ?? true;
    const netAmount = success
      ? grossMoney.subtract(feeMoney).toNumber()
      : 0;
    const reference = payload.reference ?? `PAY-${paymentId.slice(-8)}`;
    const corridor = payload.corridor ?? `${payload.currency}-${payload.currency}`;

    const events: UncommittedEvent[] = [];

    // 1. payment.recorded (PENDING) — the immutable financial fact.
    events.push({
      type: 'payment.recorded',
      streamId,
      streamType: 'payment',
      kind: 'domain',
      payload: {
        paymentId,
        merchantId: payload.merchantId,
        customerId: payload.customerId ?? null,
        reference,
        amount: payload.amount,
        currency: payload.currency,
        sourceCurrency: payload.sourceCurrency ?? payload.currency,
        destinationCurrency: payload.destinationCurrency ?? payload.currency,
        status: 'PENDING',
        method: payload.method ?? null,
        corridor,
        lpId,
        fee,
        netAmount,
        fxRate: fxEngine.rate(
          payload.sourceCurrency ?? payload.currency,
          payload.destinationCurrency ?? payload.currency,
        ) ?? 1,
        description: payload.description ?? null,
        createdAt: now,
        settledAt: null,
        customerName: payload.customerName ?? null,
        customerEmail: payload.customerEmail ?? null,
        environment: env,
        actorId: payload.actorId ?? command.metadata.actor.id,
      } as unknown as Record<string, unknown>,
    });

    // 2. payment.completed OR payment.failed — the lifecycle transition.
    // E7 CLOSED LOOP (pre-check): for cross-currency payments, check FX
    // exposure BEFORE emitting payment.completed. If the limit is breached,
    // emit payment.failed instead — the payment is blocked, not completed.
    // This is the "act" that was previously missing: the FX exposure was
    // computed (and a limit_breached event emitted) but the payment
    // continued as if nothing happened.
    //
    // F2 FIX: the FX rate now comes from `fxEngine.quote()` (real
    // USD-indexed rates), NOT hardcoded `rate: 1`. If the corridor isn't in
    // the rate table, emit `fx.rate_missing` and skip the position opening —
    // a wrong number that looks authoritative is worse than a gap.
    let fxBlockBreached: { corridor: string; reason: string } | null = null;
    const srcCcy = payload.sourceCurrency ?? payload.currency;
    const dstCcy = payload.destinationCurrency ?? payload.currency;
    const isCrossCurrency = success && srcCcy !== dstCcy;
    let fxQuote: { rate: number; midRate: number; spreadBps: number } | null = null;

    if (isCrossCurrency) {
      // F2: get a REAL rate from the FX engine. quote() returns null if the
      // corridor is unknown — we emit fx.rate_missing and refuse to open a
      // position. Do NOT fall back to rate: 1 (a wrong number that looks
      // authoritative is worse than a gap).
      const quote = fxEngine.quote(payload.amount, srcCcy, dstCcy);
      if (quote === null) {
        events.push({
          type: 'fx.rate_missing',
          streamId: `${env}:fx:${paymentId}`, streamType: 'fx', kind: 'domain',
          payload: {
            paymentId, fromCurrency: srcCcy, toCurrency: dstCcy,
            reason: `No FX rate available for ${srcCcy}:${dstCcy} — position not opened`,
            ts: now,
          } as unknown as Record<string, unknown>,
        });
        fxQuote = null;
      } else {
        fxQuote = { rate: quote.effectiveRate, midRate: quote.midRate, spreadBps: quote.spreadBps };
      }
    }

    if (isCrossCurrency && fxQuote) {
      // Pre-flight: would opening this position breach the limit?
      const projectedPosition = fxExposureService.openPosition({
        fromCurrency: srcCcy,
        toCurrency: dstCcy,
        rate: fxQuote.rate,
        sourceAmount: payload.amount,
        destinationAmount: netAmount,
        paymentId,
      });
      if (!projectedPosition) {
        // Limit would be breached → block the payment.
        const blockAction = fxBlockPayment(paymentId, `${srcCcy}:${dstCcy}`, 'FX exposure limit breached (pre-flight)');
        fxBlockBreached = { corridor: `${srcCcy}:${dstCcy}`, reason: blockAction.reason ?? 'FX exposure limit breached' };
        events.push({
          type: 'fx.limit_breached',
          streamId: `${env}:fx:${paymentId}`, streamType: 'fx', kind: 'domain',
          payload: {
            paymentId, corridor: fxBlockBreached.corridor, reason: fxBlockBreached.reason,
            blockedAt: now, closedLoop: 'E7_fx_block', closedLoopActionId: blockAction.id,
            paymentBlocked: true, preFlight: true,
            rate: fxQuote.rate, midRate: fxQuote.midRate,
          } as unknown as Record<string, unknown>,
        });
      } else {
        // Position opened successfully → close it immediately; the tier-5
        // path will re-open it if the payment actually reaches tier 5.
        // (This is a pre-flight check; we don't want to keep the position
        // open if the payment fails for other reasons.)
        fxExposureService.closePosition(projectedPosition.id);
      }
    }

    if (success && fxBlockBreached) {
      // E7 ACTUATOR: emit payment.failed (not payment.completed) so the
      // lifecycle projection marks the payment as FAILED. This is the
      // "act" — previously the payment would complete despite the FX breach.
      events.push({
        type: 'payment.failed',
        streamId, streamType: 'payment', kind: 'domain',
        payload: {
          paymentId,
          intentId: command.metadata.commandId ?? command.metadata.correlationId,
          reason: `FX exposure limit breached for corridor ${fxBlockBreached.corridor}`,
          failedAt: now,
          closedLoop: 'E7_fx_block',
        } as unknown as Record<string, unknown>,
      });
    } else if (success && isCorridorPaused(dstCcy)) {
      // E3 ACTUATOR: the destination corridor is paused (by the E3 drift
      // critical loop or by manual operator action). Block the payment —
      // do NOT complete it. Previously: the pause event was emitted but
      // nothing checked it, so payments continued through paused corridors.
      events.push({
        type: 'payment.failed',
        streamId, streamType: 'payment', kind: 'domain',
        payload: {
          paymentId,
          intentId: command.metadata.commandId ?? command.metadata.correlationId,
          reason: `Corridor ${dstCcy} is paused (E3 drift critical or manual)`,
          failedAt: now,
          closedLoop: 'E3_drift_pause',
          pausedCurrency: dstCcy,
        } as unknown as Record<string, unknown>,
      });
    } else if (success) {
      events.push({
        type: 'payment.completed',
        streamId,
        streamType: 'payment',
        kind: 'domain',
        payload: {
          paymentId,
          intentId: command.metadata.commandId ?? command.metadata.correlationId,
          planId: `plan_${paymentId}`,
          amount: payload.amount,
          from: payload.sourceCurrency ?? payload.currency,
          to: payload.destinationCurrency ?? payload.currency,
          lpId,
          feeBps: lpFeeBps,
          fee,
          netAmount,
          settledAt: now,
        } as unknown as Record<string, unknown>,
      });

      // ── ROUTING VIA THE SETTLEMENT WATERFALL (2-layer model) ─────────
      // The PaymentCommandHandler uses the settlement waterfall — the ONLY
      // routing rule. Two layers, five tiers, deterministic priority:
      //   LOCAL: tier 1 (PaySwap FIAT) → 2 (LP FIAT) → 5 (auction)
      //   CROSS-BORDER: tier 3 (PaySwap crypto) → 4 (LP crypto) → 5 (auction)
      const corridorParts = corridor.split('-');
      const fromCcy = corridorParts[0] ?? payload.currency;
      const toCcy = corridorParts[1] ?? payload.currency;

      const currencyToCountry: Record<string, string> = {
        GHS: 'Ghana', XOF: 'Togo', KES: 'Kenya', NGN: 'Nigeria',
        ZAR: 'South Africa', UGX: 'Uganda', RWF: 'Rwanda', USD: 'United States',
      };
      const fromCountryName = currencyToCountry[fromCcy] ?? fromCcy;
      const toCountryName = currencyToCountry[toCcy] ?? toCcy;

      // Reserve states (matching the PaySwap world state)
      const RESERVE_STATES: Record<string, { hasFiatReserve: boolean; fiatReserveAmount: number; stablecoinReserveAmount: number }> = {
        Ghana: { hasFiatReserve: true, fiatReserveAmount: 50_000, stablecoinReserveAmount: 20_000 },
        Togo: { hasFiatReserve: false, fiatReserveAmount: 0, stablecoinReserveAmount: 0 },
        Kenya: { hasFiatReserve: false, fiatReserveAmount: 0, stablecoinReserveAmount: 0 },
        Nigeria: { hasFiatReserve: false, fiatReserveAmount: 0, stablecoinReserveAmount: 0 },
      };

      const senderState = RESERVE_STATES[fromCountryName] ?? { hasFiatReserve: false, fiatReserveAmount: 0, stablecoinReserveAmount: 0 };
      const receiverState = RESERVE_STATES[toCountryName] ?? { hasFiatReserve: false, fiatReserveAmount: 0, stablecoinReserveAmount: 0 };

      // LP bandwidth (would come from BandwidthEngine in production)
      const lpFiatAvailable = 30_000; // LP FIAT in destination country
      const lpCryptoAvailable = 110_000; // LP crypto bandwidth

      // Run the waterfall
      const waterfallInput: WaterfallInput = {
        amount: payload.amount,
        originCountry: fromCountryName,
        destinationCountry: toCountryName,
        sourceCurrency: fromCcy,
        destinationCurrency: toCcy,
        senderReserve: { country: fromCountryName, currency: fromCcy, tier: 'FIAT', ownership: 'PAYSWAP', assetKind: 'FIAT', ...senderState },
        receiverReserve: { country: toCountryName, currency: toCcy, tier: 'FIAT', ownership: 'PAYSWAP', assetKind: 'FIAT', ...receiverState },
        lpFiatAvailable,
        lpCryptoAvailable,
        payswapStablecoinAvailable: 20_000,
        payswapTwinTokenAvailable: 50_000, // TWINGHS minted for Ghana
      };

      const waterfall = selectSettlementSource(waterfallInput);
      const treasuryStreamId = `${env}:treasury:${paymentId}`;
      const local = isLocal({ originCountry: fromCountryName, destinationCountry: toCountryName, sourceCurrency: fromCcy, destinationCurrency: toCcy });
      // Stellar convention everywhere — one canonical twin token name.
      const twinSymbol = twinTokenCode(toCcy);

      // S3: Per-leg resolution — derive strategy from the waterfall per leg
      const legResolution = resolvePayment({
        originCountry: fromCountryName,
        destinationCountry: toCountryName,
        sourceCurrency: fromCcy,
        destinationCurrency: toCcy,
        amount: payload.amount,
        senderHasFiatReserve: senderState.hasFiatReserve,
        senderFiatReserveAmount: senderState.fiatReserveAmount,
        receiverHasFiatReserve: receiverState.hasFiatReserve,
        receiverFiatReserveAmount: receiverState.fiatReserveAmount,
        senderLpFiatAvailable: lpFiatAvailable,
        receiverLpFiatAvailable: lpFiatAvailable,
        payswapStablecoinAvailable: 20_000,
        payswapTwinTokenAvailable: 50_000,
        lpCryptoAvailable: lpCryptoAvailable,
      });

      // Emit routing.decision with the waterfall result + per-leg derivation
      events.push({
        type: 'routing.decision',
        streamId: `${env}:routing:${paymentId}`,
        streamType: 'routing',
        kind: 'domain',
        payload: {
          paymentId,
          model: 'two-reserve-waterfall',
          isLocal: local,
          derivedStrategy: legResolution.strategy,
          tier: waterfall.tier,
          tierName: waterfall.tierName,
          source: waterfall.source,
          feeBps: waterfall.feeBps,
          payswapSharePct: waterfall.payswapSharePct,
          lpSharePct: waterfall.lpSharePct,
          fromCountry: fromCountryName,
          toCountry: toCountryName,
          fromCurrency: fromCcy,
          toCurrency: toCcy,
          senderHasFiatReserve: senderState.hasFiatReserve,
          receiverHasFiatReserve: receiverState.hasFiatReserve,
          twinTokenSymbol: twinSymbol,         // Stellar convention: TWINGHS
          twinTokenCode: twinSymbol,           // same — one canonical name
          skipped: waterfall.skipped,
          // S3: Per-leg resolution details
          sendLeg: { tier: legResolution.sendLeg.tier, source: legResolution.sendLeg.source, served: legResolution.sendLeg.served },
          receiveLeg: { tier: legResolution.receiveLeg.tier, source: legResolution.receiveLeg.source, served: legResolution.receiveLeg.served },
          allSkipped: legResolution.allSkipped,
          explanation: waterfall.explanation,
          compiledBy: 'SettlementWaterfall',
          compiledAt: now,
        } as unknown as Record<string, unknown>,
      });

      // ── Tier-specific events (driven by the waterfall) ──
      if (waterfall.tier === 1) {
        // I2 DECISION: LOCAL_RAIL (tier 1) does NOT mint twin tokens.
        // Twin token supply tracks reserve *top-ups* (treasury operations),
        // not payment flows. A local GHS→GHS payment is a symmetric FIAT
        // movement (+X in, −X out) → net reserve movement 0 → net twin
        // movement 0. Minting TWINGHS here would be wasteful and would
        // pollute the backing invariant. See DECISIONS.md (I2).
        //
        // What LOCAL_RAIL DOES do: credit the FIAT reserve (sender's deposit)
        // and rely on a separate merchant-disbursement step (or wallet
        // transfer) to balance the reserve. Twin tokens are minted only on
        // the cross-border tier-3 path (real sender-side FIAT deposit).
        events.push({
          type: 'treasury.account.credited',
          streamId: treasuryStreamId, streamType: 'treasury', kind: 'domain',
          payload: { accountId: `reserve:${fromCcy}`, amount: payload.amount, currency: fromCcy, reason: `Tier 1: PaySwap FIAT reserve for ${paymentId} (LOCAL_RAIL — no twin mint)`, counterparty: payload.merchantId, creditedAt: now, twinMintSkipped: true } as unknown as Record<string, unknown>,
        });
        // I1: record the credit into the drift monitor (per-currency net flow).
        reserveDriftMonitor.recordCredit(fromCcy, payload.amount, 'tier1:local_rail');

      } else if (waterfall.tier === 2) {
        // S2: Tier 2 — LP FIAT bandwidth via mandate service
        // Check if any LP has an active mandate for this country/currency
        const mandateAvailable = lpMandateService.getTotalAvailable(toCountryName, toCcy);
        const mandateCheck = mandateAvailable >= payload.amount;
        events.push({
          type: 'liquidity.resolved',
          streamId: `${env}:liquidity:${paymentId}`, streamType: 'liquidity', kind: 'domain',
          payload: {
            paymentId, tier: 2, source: 'lp_fiat', amount: payload.amount,
            mandateAvailable, mandateCheck,
            feeBps: waterfall.feeBps, lpSharePct: waterfall.lpSharePct,
            reason: `Tier 2: LP FIAT bandwidth ${mandateCheck ? 'used' : 'insufficient mandate'} for ${paymentId}`,
            resolvedAt: now,
          } as unknown as Record<string, unknown>,
        });
        if (mandateCheck) {
          // Record the debit against the LP's mandate
          // (in production, the actual debit happens via the PSP)
          events.push({
            type: 'lp.fiat_debited',
            streamId: `${env}:liquidity:${paymentId}`, streamType: 'liquidity', kind: 'domain',
            payload: { paymentId, tier: 2, country: toCountryName, currency: toCcy, amount: payload.amount, debitedAt: now } as unknown as Record<string, unknown>,
          });
          // I1: LP FIAT debit shows up as a debit on the destination reserve's
          // drift (the LP is providing FIAT capacity in the destination country).
          reserveDriftMonitor.recordDebit(toCcy, payload.amount, 'tier2:lp_fiat');
        }

      } else if (waterfall.tier === 3) {
        // Tier 3: PaySwap crypto reserves — twin token (if dest has FIAT) or stablecoin
        const destHasFiat = receiverState.hasFiatReserve;
        const cryptoAsset = destHasFiat ? twinSymbol : 'USDC';
        events.push({
          type: 'treasury.account.credited',
          streamId: treasuryStreamId, streamType: 'treasury', kind: 'domain',
          payload: { accountId: destHasFiat ? `twin:${twinSymbol}` : 'stablecoin:USDC', amount: payload.amount, currency: destHasFiat ? toCcy : 'USDC', reason: `Tier 3: PaySwap ${cryptoAsset} for ${paymentId}`, counterparty: payload.merchantId, creditedAt: now } as unknown as Record<string, unknown>,
        });
        // I1: Tier 3 is a cross-border flow — sender's FIAT reserve is debited
        // (the sender's FIAT was used to fund the crypto-side settlement).
        reserveDriftMonitor.recordDebit(fromCcy, payload.amount, 'tier3:payswap_crypto');
        if (destHasFiat) {
          // W1: Backing verifier check before mint (uses Stellar asset code)
          const tier3StellarCode = twinTokenCode(toCcy);
          const tier3MintCheck = backingVerifier.onMint(tier3StellarCode, netAmount);
          if (!tier3MintCheck.allowed) {
            // E5 CLOSED LOOP: backing block → tier fallback.
            // Previously: emit treasury.backing_blocked and continue with NO mint
            // (silently broken). Now: emit the block AND actually re-route the
            // payment through the tier 4 code path (LP crypto). The settlement
            // contract is labeled "Tier 4: LP crypto (E5 fallback)", NOT "Tier 3".
            const fallback = backingFallbackTier(3, tier3StellarCode, netAmount);
            events.push({
              type: 'treasury.backing_blocked',
              streamId: `${env}:treasury:${paymentId}`, streamType: 'treasury', kind: 'domain',
              payload: {
                paymentId, assetCode: tier3StellarCode, displaySymbol: twinSymbol,
                amount: netAmount, reason: tier3MintCheck.reason, blockedAt: now,
                fallbackTier: fallback.tier,
                fallbackReason: fallback.reason,
                closedLoop: 'E5_backing_fallback',
                reRoutedToTier4: fallback.tier === 4,
              } as unknown as Record<string, unknown>,
            });
            // E5 ACTUATOR: if fallback is tier 4, execute the FULL tier 4 code
            // path (not just a metadata event). This is the "act" — the payment
            // is actually re-routed through LP crypto, with the correct fee
            // model, settlement contract label, and corridor obligation.
            if (fallback.tier === 4) {
              events.push({
                type: 'liquidity.resolved',
                streamId: `${env}:liquidity:${paymentId}`, streamType: 'liquidity', kind: 'domain',
                payload: {
                  paymentId, tier: 4, source: 'lp_crypto',
                  amount: netAmount, lpCryptoAvailable,
                  feeBps: TIER_FEES[4].bps, lpSharePct: TIER_FEES[4].lpPct,
                  reason: `E5 BACKING FALLBACK: tier 3 backing blocked (${tier3MintCheck.reason}), re-routed to tier 4 (LP crypto) for ${paymentId}`,
                  trigger: 'backing_blocked',
                  resolvedAt: now,
                } as unknown as Record<string, unknown>,
              });
              // Record corridor obligation for the re-routed payment.
              netSettlementEngine.record(fromCountryName, toCountryName, toCcy, netAmount);
              events.push({
                type: 'corridor.obligation.recorded',
                streamId: `${env}:corridor:${paymentId}`, streamType: 'corridor', kind: 'domain',
                payload: { paymentId, fromCountry: fromCountryName, toCountry: toCountryName, currency: toCcy, amount: netAmount, recordedAt: now, reRouted: true } as unknown as Record<string, unknown>,
              });
              // Settlement contract labeled as Tier 4 (E5 fallback).
              events.push({
                type: 'settlement.contract.created',
                streamId: `${env}:settlement:${paymentId}`, streamType: 'settlement_contract', kind: 'domain',
                payload: { contractId: `sc_${paymentId}`, fromCountry: fromCcy, toCountry: toCcy, amount: netAmount, escrowAmount: netAmount, escrowCurrency: 'USDC', strategy: 'Tier 4: LP crypto (E5 fallback)', createdAt: now } as unknown as Record<string, unknown>,
              });
              events.push({
                type: 'settlement.contract.funded',
                streamId: `${env}:settlement:${paymentId}`, streamType: 'settlement_contract', kind: 'domain',
                payload: { contractId: `sc_${paymentId}`, fundedAt: now } as unknown as Record<string, unknown>,
              });
            } else {
              // E5 GAP FIX: fallback.tier is null (loop paused or no fallback
              // available). Previously: the payment was already marked
              // payment.completed but NO settlement events were emitted — a
              // silent failure (merchant sees "completed", no settlement
              // exists). Now: emit a BLOCKED settlement contract so the
              // projection can see the payment completed but settlement was
              // blocked. This is not a payment.failed (the lifecycle already
              // transitioned to completed), but it IS an auditable record
              // that the settlement didn't happen.
              events.push({
                type: 'settlement.contract.created',
                streamId: `${env}:settlement:${paymentId}`, streamType: 'settlement_contract', kind: 'domain',
                payload: {
                  contractId: `sc_${paymentId}`, fromCountry: fromCcy, toCountry: toCcy,
                  amount: netAmount, escrowAmount: 0, escrowCurrency: 'USDC',
                  strategy: 'Tier 3: backing_blocked_no_fallback',
                  status: 'BLOCKED',
                  blockedReason: tier3MintCheck.reason,
                  closedLoop: 'E5_backing_fallback',
                  fallbackTier: null,
                  createdAt: now,
                } as unknown as Record<string, unknown>,
              });
              // No settlement.contract.funded — the contract is BLOCKED, not funded.
            }
          } else {
            // Destination has FIAT reserve → mint twin token (FIAT deposit → mint)
            events.push({
              type: 'twin.minted',
              streamId: `${env}:twin:${paymentId}`, streamType: 'twin_token', kind: 'domain',
              payload: { accountId: `custodial:${payload.customerId ?? payload.merchantId}`, tokenType: 'claim', currency: toCcy, amount: netAmount, backed: true, mintedAtFrame: now, memo: `Tier 3: Mint ${twinSymbol} for ${paymentId}`, assetCode: tier3StellarCode, displaySymbol: twinSymbol } as unknown as Record<string, unknown>,
            });
            events.push({
              type: 'twin.backed',
              streamId: `${env}:twin:${paymentId}`, streamType: 'twin_token', kind: 'domain',
              payload: { settlementAccountId: `reserve:${toCcy}`, currency: toCcy, amount: payload.amount, backedAtFrame: now } as unknown as Record<string, unknown>,
            });
            // I1: twin mint at destination implies destination reserve credited.
            reserveDriftMonitor.recordCredit(toCcy, payload.amount, 'tier3:twin_mint');
            // W2: Record corridor obligation for netting (only when NOT re-routed).
            netSettlementEngine.record(fromCountryName, toCountryName, toCcy, netAmount);
            events.push({
              type: 'corridor.obligation.recorded',
              streamId: `${env}:corridor:${paymentId}`, streamType: 'corridor', kind: 'domain',
              payload: { paymentId, fromCountry: fromCountryName, toCountry: toCountryName, currency: toCcy, amount: netAmount, recordedAt: now } as unknown as Record<string, unknown>,
            });
            // Settlement contract for cross-border escrow
            events.push({
              type: 'settlement.contract.created',
              streamId: `${env}:settlement:${paymentId}`, streamType: 'settlement_contract', kind: 'domain',
              payload: { contractId: `sc_${paymentId}`, fromCountry: fromCcy, toCountry: toCcy, amount: netAmount, escrowAmount: netAmount, escrowCurrency: 'USDC', strategy: `Tier 3: ${cryptoAsset}`, createdAt: now } as unknown as Record<string, unknown>,
            });
            events.push({
              type: 'settlement.contract.funded',
              streamId: `${env}:settlement:${paymentId}`, streamType: 'settlement_contract', kind: 'domain',
              payload: { contractId: `sc_${paymentId}`, fundedAt: now } as unknown as Record<string, unknown>,
            });
          }
        } else {
          // Dest has no FIAT reserve → stablecoin path. Record obligation + contract.
          netSettlementEngine.record(fromCountryName, toCountryName, toCcy, netAmount);
          events.push({
            type: 'corridor.obligation.recorded',
            streamId: `${env}:corridor:${paymentId}`, streamType: 'corridor', kind: 'domain',
            payload: { paymentId, fromCountry: fromCountryName, toCountry: toCountryName, currency: toCcy, amount: netAmount, recordedAt: now } as unknown as Record<string, unknown>,
          });
          events.push({
            type: 'settlement.contract.created',
            streamId: `${env}:settlement:${paymentId}`, streamType: 'settlement_contract', kind: 'domain',
            payload: { contractId: `sc_${paymentId}`, fromCountry: fromCcy, toCountry: toCcy, amount: netAmount, escrowAmount: netAmount, escrowCurrency: 'USDC', strategy: `Tier 3: ${cryptoAsset}`, createdAt: now } as unknown as Record<string, unknown>,
          });
          events.push({
            type: 'settlement.contract.funded',
            streamId: `${env}:settlement:${paymentId}`, streamType: 'settlement_contract', kind: 'domain',
            payload: { contractId: `sc_${paymentId}`, fundedAt: now } as unknown as Record<string, unknown>,
          });
        }

      } else if (waterfall.tier === 4) {
        // Tier 4: LP crypto bandwidth
        events.push({
          type: 'liquidity.resolved',
          streamId: `${env}:liquidity:${paymentId}`, streamType: 'liquidity', kind: 'domain',
          payload: { paymentId, tier: 4, source: 'lp_crypto', amount: payload.amount, lpCryptoAvailable, feeBps: waterfall.feeBps, lpSharePct: waterfall.lpSharePct, reason: `Tier 4: LP crypto bandwidth used for ${paymentId}`, resolvedAt: now } as unknown as Record<string, unknown>,
        });
        netSettlementEngine.record(fromCountryName, toCountryName, toCcy, netAmount);
        events.push({
          type: 'corridor.obligation.recorded',
          streamId: `${env}:corridor:${paymentId}`, streamType: 'corridor', kind: 'domain',
          payload: { paymentId, fromCountry: fromCountryName, toCountry: toCountryName, currency: toCcy, amount: netAmount, recordedAt: now } as unknown as Record<string, unknown>,
        });
        events.push({
          type: 'settlement.contract.created',
          streamId: `${env}:settlement:${paymentId}`, streamType: 'settlement_contract', kind: 'domain',
          payload: { contractId: `sc_${paymentId}`, fromCountry: fromCcy, toCountry: toCcy, amount: netAmount, escrowAmount: netAmount, escrowCurrency: 'USDC', strategy: 'Tier 4: LP crypto', createdAt: now } as unknown as Record<string, unknown>,
        });
        events.push({
          type: 'settlement.contract.funded',
          streamId: `${env}:settlement:${paymentId}`, streamType: 'settlement_contract', kind: 'domain',
          payload: { contractId: `sc_${paymentId}`, fundedAt: now } as unknown as Record<string, unknown>,
        });

      } else {
        // S5: Tier 5 — Marketplace auction (async, parks in PENDING_LIQUIDITY)
        // Open an auction for LPs to bid on this settlement.
        // S5 FIX: open() signature is (amount, currency, country, deadlineMs) —
        // 4 positional args, NOT a single object. Previously called with an
        // object, which corrupted the auction data silently.
        let auctionId: string | null = null;
        try {
          const auction = auctionEngine.open(
            netAmount,         // amount
            toCcy,             // currency
            toCountryName,     // country (destination)
            now + 300_000,     // deadlineMs (5-minute auction window)
          );
          auctionId = auction.id;
        } catch { /* auction engine may not be initialized */ }

        events.push({
          type: 'liquidity.resolved',
          streamId: `${env}:liquidity:${paymentId}`, streamType: 'liquidity', kind: 'domain',
          payload: {
            paymentId, tier: 5, source: 'marketplace', amount: payload.amount,
            auctionId, status: 'PENDING_LIQUIDITY',
            feeBps: waterfall.feeBps, lpSharePct: waterfall.lpSharePct,
            reason: `Tier 5: Marketplace auction ${auctionId ? 'opened' : 'failed to open'} for ${paymentId}`,
            resolvedAt: now,
          } as unknown as Record<string, unknown>,
        });
        events.push({
          type: 'settlement.contract.created',
          streamId: `${env}:settlement:${paymentId}`, streamType: 'settlement_contract', kind: 'domain',
          payload: { contractId: `sc_${paymentId}`, fromCountry: fromCcy, toCountry: toCcy, amount: netAmount, escrowAmount: netAmount, escrowCurrency: 'USDC', strategy: 'Tier 5: Auction', auctionId, status: 'PENDING_LIQUIDITY', createdAt: now } as unknown as Record<string, unknown>,
        });
        events.push({
          type: 'settlement.contract.funded',
          streamId: `${env}:settlement:${paymentId}`, streamType: 'settlement_contract', kind: 'domain',
          payload: { contractId: `sc_${paymentId}`, fundedAt: now } as unknown as Record<string, unknown>,
        });
        // F3: Record FX exposure for cross-currency auctions
        // F2 FIX: use the REAL rate from fxEngine. quote() returns null if
        // the corridor is unknown — emit fx.rate_missing, don't open a position.
        if (fromCcy !== toCcy) {
          const tier5Quote = fxEngine.quote(payload.amount, fromCcy, toCcy);
          if (tier5Quote === null) {
            events.push({
              type: 'fx.rate_missing',
              streamId: `${env}:fx:${paymentId}`, streamType: 'fx', kind: 'domain',
              payload: {
                paymentId, fromCurrency: fromCcy, toCurrency: toCcy,
                reason: `No FX rate available for ${fromCcy}:${toCcy} at tier 5 — position not opened`,
                tier: 5, ts: now,
              } as unknown as Record<string, unknown>,
            });
          } else {
            const fxPosition = fxExposureService.openPosition({
              fromCurrency: fromCcy,
              toCurrency: toCcy,
              rate: tier5Quote.effectiveRate,
              sourceAmount: payload.amount,
              destinationAmount: netAmount,
              paymentId,
            });
            if (fxPosition) {
              events.push({
                type: 'fx.position_opened',
                streamId: `${env}:fx:${paymentId}`, streamType: 'fx', kind: 'domain',
                payload: { paymentId, positionId: fxPosition.id, corridor: fxPosition.corridor, sourceAmount: payload.amount, rate: tier5Quote.effectiveRate, openedAt: now } as unknown as Record<string, unknown>,
              });
              // F3 FIX: close the position immediately — the settlement
              // completes synchronously in this handler, so the FX risk
              // is momentary. Previously: positions were opened but never
              // closed → exposure accumulated forever → eventually all
              // cross-currency payments blocked by the pre-flight check.
              const closed = fxExposureService.closePosition(fxPosition.id);
              if (closed) {
                events.push({
                  type: 'fx.position_closed',
                  streamId: `${env}:fx:${paymentId}`, streamType: 'fx', kind: 'domain',
                  payload: { paymentId, positionId: fxPosition.id, corridor: fxPosition.corridor, closedAt: now } as unknown as Record<string, unknown>,
                });
              }
            }
          }
        }
      }

      // 3. ledger.entry.posted — balanced double-entry for the settlement.
      events.push(buildLedgerEntryEvent(
        env,
        command.metadata.correlationId,
        paymentId,
        `Payment ${paymentId} settled (amount=${payload.amount} ${payload.currency}, fee=${fee}, net=${netAmount})`,
        [
          { account: 'asset:merchant_receivable', debit: payload.amount, credit: 0, description: `Merchant receivable for ${payload.merchantId}` },
          { account: 'liability:lp_payable', debit: 0, credit: netAmount, description: `LP payable to ${lpId}` },
          { account: 'equity:fee_income', debit: 0, credit: fee, description: `Fee income (${lpFeeBps} bps)` },
        ],
      ));
    } else {
      events.push({
        type: 'payment.failed',
        streamId,
        streamType: 'payment',
        kind: 'domain',
        payload: {
          paymentId,
          intentId: command.metadata.commandId ?? command.metadata.correlationId,
          reason: 'Simulated failure',
          failedAt: now,
        } as unknown as Record<string, unknown>,
      });
    }

    return {
      success: true,
      commandType: this.commandType,
      events,
      streamId,
      entityId: paymentId,
      message: `Payment ${paymentId} ${success ? 'recorded + completed' : 'recorded + failed'} (${events.length} events)`,
    };
  }
}

// ─── Refund Command Handlers ───────────────────────────────────────────────

/**
 * Handles "refund.create" — produces the full refund lifecycle event chain:
 *
 *   1. refund.requested  (status PENDING) — always
 *   2. refund.executed   (status PROCESSED) — always (refunds in the app are
 *      processed synchronously; the manual approve/reject flow is a separate
 *      concern that goes through refund.execute)
 *   3. ledger.entry.posted — balanced reversal of the original payment:
 *        Debit  liability:lp_payable             refundAmount
 *        Debit  equity:fee_income                 proportionalFee (0 for now)
 *        Credit asset:merchant_receivable         refundAmount
 */
export class RefundCommandHandler implements CommandHandler<CreateRefundCommand> {
  readonly commandType = 'refund.create';
  readonly description = 'Create a new refund (produces refund.requested + refund.executed + ledger.entry.posted)';

  handle(command: CreateRefundCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload as EnhancedRefundPayload;
    const env = command.metadata.environment;
    const refundId = uid('ref');
    const streamId = `${env}:refund:${refundId}`;
    const now = payload.timestamp ?? Date.now();

    const events: UncommittedEvent[] = [];

    // 1. refund.requested (PENDING)
    events.push({
      type: 'refund.requested',
      streamId,
      streamType: 'refund',
      kind: 'domain',
      payload: {
        refundId,
        merchantId: payload.merchantId,
        paymentId: payload.paymentId,
        amount: payload.amount,
        type: payload.type,
        reason: payload.reason ?? null,
        status: 'PENDING',
        requestedBy: payload.requestedBy,
        environment: env,
        createdAt: now,
      } as unknown as Record<string, unknown>,
    });

    // 2. refund.executed (PROCESSED) — refunds are processed synchronously
    //    in the application; the approve/reject flow is a separate concern.
    events.push({
      type: 'refund.executed',
      streamId,
      streamType: 'refund',
      kind: 'domain',
      payload: {
        refundId,
        executedAt: now + 1, // +1ms to ensure ordering after requested
        processedAt: now + 1,
      } as unknown as Record<string, unknown>,
    });

    // 3. ledger.entry.posted — balanced reversal.
    events.push(buildLedgerEntryEvent(
      env,
      command.metadata.correlationId,
      refundId,
      `Refund ${refundId} executed (payment=${payload.paymentId}, amount=${payload.amount})`,
      [
        { account: 'liability:lp_payable', debit: payload.amount, credit: 0, description: `Reverse LP payable for refund of ${payload.paymentId}` },
        { account: 'asset:merchant_receivable', debit: 0, credit: payload.amount, description: `Reverse merchant receivable for ${payload.merchantId}` },
      ],
    ));

    return {
      success: true,
      commandType: this.commandType,
      events,
      streamId,
      entityId: refundId,
      message: `Refund ${refundId} requested + executed (${events.length} events)`,
    };
  }
}

/** Handles "refund.execute" — produces a refund.executed event. */
export class ExecuteRefundCommandHandler implements CommandHandler<ExecuteRefundCommand> {
  readonly commandType = 'refund.execute';
  readonly description = 'Execute a refund (produces refund.executed event)';

  handle(command: ExecuteRefundCommand, snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const refund = snapshot.refunds.get(payload.refundId) as { status?: string; merchantId?: string } | undefined;

    if (!refund) {
      return {
        success: false,
        commandType: this.commandType,
        events: [],
        message: `Refund ${payload.refundId} not found`,
        error: 'REFUND_NOT_FOUND',
      };
    }

    if (refund.status !== 'APPROVED') {
      return {
        success: false,
        commandType: this.commandType,
        events: [],
        message: `Refund ${payload.refundId} is not APPROVED (current: ${refund.status})`,
        error: 'REFUND_NOT_APPROVED',
      };
    }

    const streamId = `${command.metadata.environment}:refund:${payload.refundId}`;
    const event: UncommittedEvent = {
      type: 'refund.executed',
      streamId,
      streamType: 'refund',
      kind: 'domain',
      payload: {
        refundId: payload.refundId,
        executedAt: Date.now(),
      } as unknown as Record<string, unknown>,
    };

    return {
      success: true,
      commandType: this.commandType,
      events: [event],
      streamId,
      entityId: payload.refundId,
      message: `Refund ${payload.refundId} executed`,
    };
  }
}

// ─── Payout Command Handler (INTEGRATE-1) ──────────────────────────────────

/**
 * Handles "payout.create" — produces the full payout lifecycle event chain:
 *
 *   1. payout.recorded   (status COMPLETED) — always
 *   2. payout.completed  — always (payouts in the app complete synchronously)
 *   3. ledger.entry.posted — balanced double-entry:
 *        Debit  liability:merchant_payable    netAmount + fee
 *        Credit asset:cash                    netAmount
 *        Credit equity:fee_income             fee
 *
 * The Prisma Payout table is updated by the payout runtime subscriber
 * registered in src/services/projections/index.ts.
 */
export class PayoutCommandHandler implements CommandHandler<CreatePayoutCommand> {
  readonly commandType = 'payout.create';
  readonly description = 'Create a new payout (produces payout.recorded + payout.completed + ledger.entry.posted)';

  handle(command: CreatePayoutCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload as EnhancedPayoutPayload;
    const env = command.metadata.environment;
    const payoutId = uid('payout');
    const streamId = `${env}:payout:${payoutId}`;
    const now = payload.timestamp ?? Date.now();

    const sourceAmount = payload.sourceAmount;
    const feeBps = payload.feeBps ?? 50;
    // MON-3: exact Money arithmetic for payout fees.
    const payoutCurrency = (payload.sourceCurrency ?? 'USD') as import('../../money/money').Currency;
    const payoutGross = Money.fromMajor(sourceAmount, payoutCurrency);
    const payoutFeeMoney = payoutGross.mulBps(feeBps);
    const fee = payload.fee ?? payoutFeeMoney.toNumber();
    const netAmount = payload.netAmount ?? payoutGross.subtract(payoutFeeMoney).toNumber();
    const success = payload.success ?? true;
    const txHash = payload.txHash ?? `sim_tx_${payoutId.slice(-8)}`;

    const events: UncommittedEvent[] = [];

    // 1. payout.recorded (COMPLETED — payouts settle synchronously)
    events.push({
      type: 'payout.recorded',
      streamId,
      streamType: 'payout',
      kind: 'domain',
      payload: {
        payoutId,
        merchantId: payload.merchantId,
        method: payload.method,
        sourceAmount,
        sourceAsset: payload.sourceAsset,
        sourceCurrency: payload.sourceCurrency,
        destinationCurrency: payload.destinationCurrency,
        destination: payload.destination ?? null,
        fxRate: 1,
        feeBps,
        fee,
        netAmount,
        status: success ? 'COMPLETED' : 'FAILED',
        txHash,
        evidence: payload.evidence ?? JSON.stringify({ source: 'open_banking', verificationLevel: 'institutional' }),
        reason: payload.reason ?? null,
        environment: env,
        actorId: payload.actorId ?? command.metadata.actor.id,
        createdAt: now,
        processedAt: success ? now : null,
        completedAt: success ? now : null,
      } as unknown as Record<string, unknown>,
    });

    if (success) {
      // 2. payout.completed
      events.push({
        type: 'payout.completed',
        streamId,
        streamType: 'payout',
        kind: 'domain',
        payload: {
          payoutId,
          amount: sourceAmount,
          net: netAmount,
          fee,
          txHash,
          completedAt: now,
        } as unknown as Record<string, unknown>,
      });

      // 3. ledger.entry.posted — balanced payout entry.
      events.push(buildLedgerEntryEvent(
        env,
        command.metadata.correlationId,
        payoutId,
        `Payout ${payoutId} completed (gross=${sourceAmount}, fee=${fee}, net=${netAmount})`,
        [
          { account: 'liability:merchant_payable', debit: sourceAmount, credit: 0, description: `Merchant payable for ${payload.merchantId}` },
          { account: 'asset:cash', debit: 0, credit: netAmount, description: `Cash disbursed to ${payload.merchantId}` },
          { account: 'equity:fee_income', debit: 0, credit: fee, description: `Payout fee income (${feeBps} bps)` },
        ],
      ));
    }

    return {
      success: true,
      commandType: this.commandType,
      events,
      streamId,
      entityId: payoutId,
      message: `Payout ${payoutId} ${success ? 'recorded + completed' : 'recorded + failed'} (${events.length} events)`,
    };
  }
}

// ─── Reserve Command Handlers ──────────────────────────────────────────────

/** Handles "reserve.lock" — produces a reserve.locked event. */
export class ReserveLiquidityCommandHandler implements CommandHandler<ReserveLiquidityCommand> {
  readonly commandType = 'reserve.lock';
  readonly description = 'Lock liquidity in a reserve (produces reserve.locked event)';

  handle(command: ReserveLiquidityCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const streamId = `${command.metadata.environment}:reserve:${payload.reserveId}`;

    const event: UncommittedEvent = {
      type: 'reserve.locked',
      streamId,
      streamType: 'reserve',
      kind: 'domain',
      payload: {
        reserveId: payload.reserveId,
        amount: payload.amount,
        reason: payload.reason,
      } as unknown as Record<string, unknown>,
    };

    return {
      success: true,
      commandType: this.commandType,
      events: [event],
      streamId,
      entityId: payload.reserveId,
      message: `Locked ${payload.amount} in reserve ${payload.reserveId}`,
    };
  }
}

/** Handles "reserve.release" — produces a reserve.released event. */
export class ReleaseLiquidityCommandHandler implements CommandHandler<ReleaseLiquidityCommand> {
  readonly commandType = 'reserve.release';
  readonly description = 'Release liquidity from a reserve (produces reserve.released event)';

  handle(command: ReleaseLiquidityCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const streamId = `${command.metadata.environment}:reserve:${payload.reserveId}`;

    const event: UncommittedEvent = {
      type: 'reserve.released',
      streamId,
      streamType: 'reserve',
      kind: 'domain',
      payload: {
        reserveId: payload.reserveId,
        amount: payload.amount,
        reason: payload.reason,
      } as unknown as Record<string, unknown>,
    };

    return {
      success: true,
      commandType: this.commandType,
      events: [event],
      streamId,
      entityId: payload.reserveId,
      message: `Released ${payload.amount} from reserve ${payload.reserveId}`,
    };
  }
}

// ─── Wallet Command Handlers (M-RT-23 + M-RT-24B) ──────────────────────────
//
// M-RT-24B: Wallet handlers now emit DUAL events:
//   1. wallet.* event (on the wallet stream) — for the wallet projection
//   2. treasury.account.* event (on the treasury stream) — for the treasury projection
//
// This ensures the treasury is the CANONICAL financial state. Wallets are
// claims on treasury, not independent balance owners.
//
//   Wallet → Treasury Account → Ledger → Reserves

/** Helper: build the treasury account ID for a wallet. */
function walletTreasuryAccountId(walletId: string): string {
  return `treasury_wallet_${walletId}`;
}

/** Helper: build the treasury stream ID for a wallet. */
function walletTreasuryStreamId(env: string, walletId: string): string {
  return `${env}:treasury:${walletTreasuryAccountId(walletId)}`;
}

/** Handles "wallet.credit" — produces wallet.credited + treasury.account.credited events. */
export class WalletCreditCommandHandler implements CommandHandler<WalletCreditCommand> {
  readonly commandType = 'wallet.credit';
  readonly description = 'Credit a wallet (produces wallet.credited + treasury.account.credited events)';

  handle(command: WalletCreditCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const env = command.metadata.environment;
    const walletStreamId = `${env}:wallet:${payload.walletId}`;
    const treasuryStreamId = walletTreasuryStreamId(env, payload.walletId);
    const treasuryAccountId = walletTreasuryAccountId(payload.walletId);
    const now = Date.now();

    const events: UncommittedEvent[] = [
      // 1. Wallet event (for the wallet projection).
      {
        type: 'wallet.credited',
        streamId: walletStreamId,
        streamType: 'wallet',
        kind: 'domain',
        payload: {
          walletId: payload.walletId,
          amount: payload.amount,
          currency: payload.currency,
          counterparty: payload.counterparty ?? null,
          reference: payload.reference ?? null,
          txHash: null,
          reason: payload.reason,
          creditedAt: now,
        } as unknown as Record<string, unknown>,
      },
      // 2. Treasury event (for the treasury projection — canonical financial state).
      {
        type: 'treasury.account.credited',
        streamId: treasuryStreamId,
        streamType: 'treasury',
        kind: 'domain',
        payload: {
          accountId: treasuryAccountId,
          amount: payload.amount,
          currency: payload.currency,
          reason: `Wallet credit: ${payload.reason}`,
          counterparty: payload.counterparty ?? null,
          creditedAt: now,
        } as unknown as Record<string, unknown>,
      },
    ];

    return {
      success: true,
      commandType: this.commandType,
      events,
      streamId: walletStreamId,
      entityId: payload.walletId,
      message: `Credited ${payload.amount} ${payload.currency} to wallet ${payload.walletId} (treasury: ${treasuryAccountId})`,
    };
  }
}

/** Handles "wallet.debit" — produces wallet.debited + treasury.account.debited events. */
export class WalletDebitCommandHandler implements CommandHandler<WalletDebitCommand> {
  readonly commandType = 'wallet.debit';
  readonly description = 'Debit a wallet (produces wallet.debited + treasury.account.debited events)';

  handle(command: WalletDebitCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const env = command.metadata.environment;
    const walletStreamId = `${env}:wallet:${payload.walletId}`;
    const treasuryStreamId = walletTreasuryStreamId(env, payload.walletId);
    const treasuryAccountId = walletTreasuryAccountId(payload.walletId);
    const now = Date.now();

    const events: UncommittedEvent[] = [
      {
        type: 'wallet.debited',
        streamId: walletStreamId,
        streamType: 'wallet',
        kind: 'domain',
        payload: {
          walletId: payload.walletId,
          amount: payload.amount,
          currency: payload.currency,
          counterparty: payload.counterparty ?? null,
          reference: payload.reference ?? null,
          txHash: null,
          reason: payload.reason,
          debitedAt: now,
        } as unknown as Record<string, unknown>,
      },
      {
        type: 'treasury.account.debited',
        streamId: treasuryStreamId,
        streamType: 'treasury',
        kind: 'domain',
        payload: {
          accountId: treasuryAccountId,
          amount: payload.amount,
          currency: payload.currency,
          reason: `Wallet debit: ${payload.reason}`,
          counterparty: payload.counterparty ?? null,
          debitedAt: now,
        } as unknown as Record<string, unknown>,
      },
    ];

    return {
      success: true,
      commandType: this.commandType,
      events,
      streamId: walletStreamId,
      entityId: payload.walletId,
      message: `Debited ${payload.amount} ${payload.currency} from wallet ${payload.walletId} (treasury: ${treasuryAccountId})`,
    };
  }
}

/** Handles "wallet.reserve" — produces wallet.reserved + treasury.position.opened events. */
export class WalletReserveCommandHandler implements CommandHandler<WalletReserveCommand> {
  readonly commandType = 'wallet.reserve';
  readonly description = 'Reserve wallet balance (produces wallet.reserved + treasury.position.opened events)';

  handle(command: WalletReserveCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const env = command.metadata.environment;
    const walletStreamId = `${env}:wallet:${payload.walletId}`;
    const treasuryStreamId = walletTreasuryStreamId(env, payload.walletId);
    const treasuryAccountId = walletTreasuryAccountId(payload.walletId);
    const now = Date.now();

    const events: UncommittedEvent[] = [
      {
        type: 'wallet.reserved',
        streamId: walletStreamId,
        streamType: 'wallet',
        kind: 'domain',
        payload: {
          walletId: payload.walletId,
          amount: payload.amount,
          currency: payload.currency,
          reason: payload.reason,
          operationId: payload.operationId,
          reservedAt: now,
        } as unknown as Record<string, unknown>,
      },
      {
        type: 'treasury.position.opened',
        streamId: treasuryStreamId,
        streamType: 'treasury',
        kind: 'domain',
        payload: {
          accountId: treasuryAccountId,
          positionType: 'lp',
          reference: payload.operationId,
          amount: payload.amount,
          currency: payload.currency,
          terms: payload.reason,
          openedAt: now,
        } as unknown as Record<string, unknown>,
      },
    ];

    return {
      success: true,
      commandType: this.commandType,
      events,
      streamId: walletStreamId,
      entityId: payload.walletId,
      message: `Reserved ${payload.amount} ${payload.currency} in wallet ${payload.walletId} (treasury: ${treasuryAccountId})`,
    };
  }
}

/** Handles "wallet.release" — produces wallet.released + treasury.position.closed events. */
export class WalletReleaseCommandHandler implements CommandHandler<WalletReleaseCommand> {
  readonly commandType = 'wallet.release';
  readonly description = 'Release reserved wallet balance (produces wallet.released + treasury.position.closed events)';

  handle(command: WalletReleaseCommand, _snapshot: RuntimeSnapshot): CommandResult {
    const payload = command.payload;
    const env = command.metadata.environment;
    const walletStreamId = `${env}:wallet:${payload.walletId}`;
    const treasuryStreamId = walletTreasuryStreamId(env, payload.walletId);
    const treasuryAccountId = walletTreasuryAccountId(payload.walletId);
    const now = Date.now();

    const events: UncommittedEvent[] = [
      {
        type: 'wallet.released',
        streamId: walletStreamId,
        streamType: 'wallet',
        kind: 'domain',
        payload: {
          walletId: payload.walletId,
          amount: payload.amount,
          currency: payload.currency,
          reason: payload.reason,
          operationId: payload.operationId,
          releasedAt: now,
        } as unknown as Record<string, unknown>,
      },
      {
        type: 'treasury.position.closed',
        streamId: treasuryStreamId,
        streamType: 'treasury',
        kind: 'domain',
        payload: {
          accountId: treasuryAccountId,
          closeAmount: payload.amount,
          reason: payload.reason,
          closedAt: now,
        } as unknown as Record<string, unknown>,
      },
    ];

    return {
      success: true,
      commandType: this.commandType,
      events,
      streamId: walletStreamId,
      entityId: payload.walletId,
      message: `Released ${payload.amount} ${payload.currency} from wallet ${payload.walletId} (treasury: ${treasuryAccountId})`,
    };
  }
}

// ─── All Built-in Handlers ─────────────────────────────────────────────────

/** All built-in command handlers, in registration order. */
export const BUILTIN_HANDLERS: CommandHandler[] = [
  new PaymentCommandHandler(),
  new RefundCommandHandler(),
  new ExecuteRefundCommandHandler(),
  new PayoutCommandHandler(),
  new ReserveLiquidityCommandHandler(),
  new ReleaseLiquidityCommandHandler(),
  new WalletCreditCommandHandler(),
  new WalletDebitCommandHandler(),
  new WalletReserveCommandHandler(),
  new WalletReleaseCommandHandler(),
];
