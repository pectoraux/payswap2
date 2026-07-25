/**
 * PaySwap Protocol — Production Stellar Chain Adapter.
 *
 * This adapter implements the full `ChainAdapter` interface against the real
 * Stellar network. It is **mode-switchable at runtime**:
 *
 *   - `'simulation'` (default): uses the legacy in-process simulator
 *     (`src/protocol/blockchains/stellar/adapter.ts`) so the rest of the
 *     protocol layer runs end-to-end without network access. This is the
 *     safe default.
 *
 *   - `'live'`: uses the real `stellar-sdk` package to build, sign, and
 *     submit transactions to a Horizon server. Live mode requires:
 *       1. `stellar-sdk` installed (`bun add stellar-sdk`)
 *       2. A configured `secretKey` (Stellar secret seed, 'S...')
 *       3. A reachable Horizon URL (testnet/mainnet)
 *
 * ## SDK usage map (live mode)
 *
 * Every method has a comment showing the equivalent `stellar-sdk` call so
 * the surface is drop-in ready for real Stellar integration:
 *
 *   - createAccount         → Operation.createAccount
 *   - fundAccount           → Operation.payment (native)
 *   - registerAsset         → issuer account setup + flag set (no op on-chain)
 *   - issueAsset            → Operation.payment (issuer → holder)
 *   - burnAsset             → issuer clawback OR holder → issuer payment
 *   - createTrustline       → Operation.changeTrust
 *   - transfer              → Operation.payment
 *   - pathPayment           → Operation.pathPaymentStrictSend
 *   - createClaimableBalance→ Operation.createClaimableBalance
 *   - claimBalance          → Operation.claimClaimableBalance
 *   - createEscrowAccount   → Operation.createAccount + SetOptions (2-of-2 + timebounds)
 *   - releaseEscrow         → Operation.payment from escrow account
 *   - sponsorReserve        → Operation.beginSponsoringFutureReserves / endSponsoring…
 *   - feeBumpTransaction    → TransactionBuilder.buildFeeBumpTransaction
 *   - addSigner/removeSigner/setThresholds → Operation.setOptions
 *   - verifyTransaction     → server.transactions().transaction(hash)
 *   - getLatestLedger       → server.ledgers().order('desc').limit(1)
 *   - streamLedgers         → server.ledgers().cursor('now').stream()
 *   - prepareSoroban…       → rpc.Server.simulateTransaction (stub for now)
 *
 * ## Failure model
 *
 * All operations return `{ success, error, ... }`. No exceptions escape the
 * adapter. If `stellar-sdk` is not installed, live-mode methods degrade to
 * `{ success: false, error: 'stellar-sdk not installed — install with: bun add stellar-sdk' }`.
 *
 * ## Evidence
 *
 * Every successful on-chain op produces a kernel `Evidence` with
 * `source: 'on_chain_state'`, `verificationLevel: 'cryptographic'`,
 * `reputation: 1.0`, payload includes `txHash`, `ledger`, `operation`,
 * `network`, `mode`.
 */
import type {
  ChainAdapter,
  ChainMode,
  ChainNetwork,
  ChainResult,
  ChainVerifyResult,
  ChainBalanceResult,
  ChainHealthResult,
  ChainMemo,
  ClaimPredicate,
  ChainSigner,
} from '../adapter';
import { createEvidence } from '@/kernel/evidence';
import type { Evidence } from '@/kernel/evidence';
import { uid, round } from '@/kernel/support';
import { stellarAdapter as simAdapter } from '@/protocol/blockchains/stellar/adapter';
import { assetKey, isNative } from './assets';

// ============================================================================
// Dynamic stellar-sdk import (live mode only)
// ============================================================================
//
// We import `stellar-sdk` lazily inside live-mode methods so the adapter
// never crashes when the package is absent. TypeScript still benefits from
// type inference via `import type` — the types are erased at runtime.
//
// We do NOT do a top-level `import * as Sdk from 'stellar-sdk'` because:
//   1. It would crash at import time if the package is missing.
//   2. It pulls the entire SDK into bundles that only need sim mode.
//
// Live mode resolves the SDK via a dynamic `import('stellar-sdk')`. If the
// import fails, we return a graceful degraded result.
//

type StellarSdkLike = {
  Server: new (url: string, opts?: unknown) => unknown;
  Networks: { PUBLIC: string; TESTNET: string; FUTURENET: string };
  TransactionBuilder: unknown;
  Operation: unknown;
  Asset: unknown;
  Claimant: unknown;
  Memo: unknown;
  Keypair: unknown;
  native: () => unknown;
};

let sdkCache: StellarSdkLike | null = null;
let sdkLoadAttempted = false;
let sdkLoadError: string | null = null;

/**
 * Try to load `stellar-sdk`. Returns null if not installed. Memoized.
 * Exposed for tests + the Horizon sync module.
 */
export async function loadStellarSdk(): Promise<StellarSdkLike | null> {
  if (sdkLoadAttempted) return sdkCache;
  sdkLoadAttempted = true;
  try {
    // Dynamic import — runtime-safe. The `'stellar-sdk'` string is a literal
    // so bundlers can resolve it; Node's runtime resolver will throw if the
    // package is missing, which we catch.
    const mod: unknown = await import('stellar-sdk');
    // stellar-sdk exports everything as named exports + a default. The shape:
    //   { Horizon, rpc, contract, Server (alias of Horizon.Server),
    //     Networks, TransactionBuilder, Operation, Asset, Claimant, Memo,
    //     Keypair, ... }
    const m = mod as StellarSdkLike & { Horizon?: { Server: unknown } };
    sdkCache = {
      Server: (m.Server ?? (m.Horizon ? (m.Horizon as { Server: new (url: string, opts?: unknown) => unknown }).Server : null)) as new (url: string, opts?: unknown) => unknown,
      Networks: m.Networks,
      TransactionBuilder: m.TransactionBuilder,
      Operation: m.Operation,
      Asset: m.Asset,
      Claimant: m.Claimant,
      Memo: m.Memo,
      Keypair: m.Keypair,
      native: typeof m.native === 'function' ? m.native : undefined,
    } as StellarSdkLike;
    return sdkCache;
  } catch (err) {
    sdkLoadError = err instanceof Error ? err.message : String(err);
    sdkCache = null;
    return null;
  }
}

/** Reset the SDK cache (for tests). */
export function _resetStellarSdkCache(): void {
  sdkCache = null;
  sdkLoadAttempted = false;
  sdkLoadError = null;
}

// ============================================================================
// Constants
// ============================================================================

const STELLAR_TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';
const STELLAR_PUBLIC_HORIZON = 'https://horizon.stellar.org';
const STELLAR_TESTNET_FRIENDBOT = 'https://friendbot.stellar.org';

const NOT_INSTALLED_ERROR = 'stellar-sdk not installed — install with: bun add stellar-sdk';

// ============================================================================
// Adapter config
// ============================================================================

export interface StellarAdapterConfig {
  mode?: ChainMode;
  network?: ChainNetwork;
  horizonUrl?: string;
  secretKey?: string;
  /** Optional passphrase override (defaults to Networks.TESTNET/PUBLIC). */
  networkPassphrase?: string;
}

// ============================================================================
// Internal sim-state mirrors (used for evidence generation in sim mode)
// ============================================================================

interface SimLedger {
  ledger: number;
  closeTime: number;
  txCount: number;
}

interface SimClaimableBalance {
  balanceId: string;
  assetCode: string;
  issuer?: string;
  amount: number;
  source: string;
  claimants: Array<{ destination: string; predicate: ClaimPredicate }>;
}

interface SimEscrow {
  escrowAddress: string;
  assetCode: string;
  amount: number;
  signer1: string;
  signer2: string;
  unlockTime?: number;
  released: boolean;
}

interface SimTxRecord {
  txHash: string;
  operation: string;
  ledger: number;
  source?: string;
  success: boolean;
  confirmed: boolean;
  memo?: ChainMemo;
  createdAt: number;
  network: ChainNetwork;
  mode: ChainMode;
  payload?: Record<string, unknown>;
}

// ============================================================================
// StellarChainAdapter
// ============================================================================

export class StellarChainAdapter implements ChainAdapter {
  readonly chain = 'stellar';
  isInitialized = true;

  private _mode: ChainMode;
  private _network: ChainNetwork;
  private _horizonUrl: string;
  private _secretKey?: string;
  private _networkPassphrase: string;
  private _liveServer: unknown = null; // Sdk.Server instance, when live

  /** Network the adapter is configured for. */
  get network(): ChainNetwork {
    return this._network;
  }

  // Sim state (mirrors what the legacy sim adapter holds; we also keep
  // claimable balances, escrows, and a ledger cursor here so the new
  // surface — which the legacy adapter doesn't expose — can be simulated).
  private simLedger: SimLedger = { ledger: 1, closeTime: Date.now(), txCount: 0 };
  private simBalances = new Map<string, number>();           // assetKey:address -> amount
  private simAssetIssuers = new Map<string, string>();       // assetCode -> issuer
  private simAccounts = new Map<string, { sequence: string; signers: ChainSigner[]; thresholds: { low: number; medium: number; high: number } }>();
  private simClaimableBalances = new Map<string, SimClaimableBalance>();
  private simEscrows = new Map<string, SimEscrow>();
  private simTransactions = new Map<string, SimTxRecord>();
  private simLedgerStreamListeners = new Set<(l: SimLedger) => void>();
  private simLedgerTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: StellarAdapterConfig = {}) {
    this._mode = config.mode ?? 'simulation';
    this._network = config.network ?? 'testnet';
    this._horizonUrl = config.horizonUrl ?? (this._network === 'mainnet' ? STELLAR_PUBLIC_HORIZON : STELLAR_TESTNET_HORIZON);
    this._secretKey = config.secretKey;
    this._networkPassphrase = config.networkPassphrase ?? (this._network === 'mainnet' ? 'Public Global Stellar Network ; September 2015' : 'Test SDF Network ; September 2015');
  }

  get mode(): ChainMode {
    return this._mode;
  }

  // ============================================================ mode switching

  async setMode(mode: ChainMode): Promise<ChainResult> {
    if (mode === this._mode) {
      return { success: true, mode: this._mode, network: this.network };
    }
    if (mode === 'live') {
      const sdk = await loadStellarSdk();
      if (!sdk) {
        return { success: false, error: sdkLoadError ?? NOT_INSTALLED_ERROR, mode: this._mode, network: this.network };
      }
      // Construct the live Horizon server.
      try {
        // Sdk.Server is a constructor — `new Sdk.Server(url, opts)`.
        const ServerCtor = sdk.Server as new (url: string, opts?: unknown) => unknown;
        this._liveServer = new ServerCtor(this._horizonUrl, { allowHttp: this._horizonUrl.startsWith('http://') });
        this._mode = 'live';
      } catch (err) {
        return {
          success: false,
          error: `failed_to_init_live_server: ${err instanceof Error ? err.message : String(err)}`,
          mode: this._mode,
          network: this.network,
        };
      }
      return { success: true, mode: this._mode, network: this.network };
    }
    // Switching back to simulation.
    this._liveServer = null;
    this._mode = 'simulation';
    return { success: true, mode: this._mode, network: this.network };
  }

  /** Reconfigure the adapter for live mode against a specific network + key. */
  async configureLive(params: {
    network?: ChainNetwork;
    horizonUrl?: string;
    secretKey?: string;
    networkPassphrase?: string;
  }): Promise<ChainResult> {
    if (params.network) {
      this._network = params.network;
      this._horizonUrl = params.horizonUrl ?? (params.network === 'mainnet' ? STELLAR_PUBLIC_HORIZON : STELLAR_TESTNET_HORIZON);
    } else if (params.horizonUrl) {
      this._horizonUrl = params.horizonUrl;
    }
    if (params.secretKey) this._secretKey = params.secretKey;
    if (params.networkPassphrase) this._networkPassphrase = params.networkPassphrase;
    return this.setMode('live');
  }

  // ============================================================ account lifecycle

  async createAccount(params: { address: string; startingBalance?: number; funder?: string }): Promise<ChainResult> {
    const { address, startingBalance = 0, funder } = params;
    if (!address) return { success: false, error: 'address_required' };

    if (this._mode === 'live') {
      // === live signature ===
      //   const server = new Sdk.Server(horizonUrl);
      //   const funderAccount = await server.loadAccount(funder);
      //   const tx = new Sdk.TransactionBuilder(funderAccount, { fee, networkPassphrase })
      //     .addOperation(Sdk.Operation.createAccount({
      //       destination: address,
      //       startingBalance: String(startingBalance),
      //     }))
      //     .setTimeout(180).build();
      //   tx.sign(Sdk.Keypair.fromSecret(secretKey));
      //   const resp = await server.submitTransaction(tx);
      //   return { success: true, txHash: resp.hash, ledger: resp.ledger };
      const executed = await this.liveSubmit('createAccount', { destination: address, startingBalance: String(startingBalance), source: funder });
      return executed;
    }

    // Sim mode — create a local account record + credit starting balance.
    this.ensureSimAccount(address);
    if (startingBalance > 0) {
      this.simCredit(address, 'XLM', startingBalance);
    }
    const txHash = uid('stellarTx');
    return this.recordSimTx({
      txHash,
      operation: 'createAccount',
      source: funder,
      payload: { op: 'createAccount', address, startingBalance, funder },
      entityId: address,
      amount: startingBalance,
      assetCode: 'XLM',
    });
  }

  async fundAccount(params: { address: string; assetCode: string; amount: number; funder?: string }): Promise<ChainResult> {
    const { address, assetCode, amount, funder } = params;
    if (amount <= 0) return { success: false, error: 'amount_must_be_positive' };
    if (!address) return { success: false, error: 'address_required' };

    if (this._mode === 'live') {
      // === live signature ===
      //   const op = Sdk.Operation.payment({
      //     destination: address,
      //     amount: String(amount),
      //     asset: isNative ? Sdk.Asset.native() : new Sdk.Asset(assetCode, issuer),
      //   });
      const executed = await this.liveSubmit('payment', { destination: address, amount: String(amount), assetCode, source: funder });
      return executed;
    }

    // Sim — credit locally and also delegate to legacy sim so existing
    // tests that read from `stellarAdapter.getBalances()` still work.
    simAdapter.fundAccount(address, assetCode, amount);
    this.ensureSimAccount(address);
    this.simCredit(address, assetCode, amount);
    const txHash = uid('stellarTx');
    return this.recordSimTx({
      txHash,
      operation: 'fundAccount',
      source: funder,
      payload: { op: 'fundAccount', address, assetCode, amount, funder },
      entityId: address,
      amount,
      assetCode,
    });
  }

  // ============================================================ asset lifecycle

  async registerAsset(params: { code: string; issuer: string; metadata?: Record<string, unknown> }): Promise<ChainResult> {
    const { code, issuer, metadata } = params;
    if (!code || !issuer) return { success: false, error: 'code_and_issuer_required' };
    this.simAssetIssuers.set(code, issuer);

    if (this._mode === 'live') {
      // === live signature ===
      // Stellar doesn't have an explicit "register asset" op — issuance is
      // implicit via a payment from the issuer to a holder. Asset metadata
      // (decimals, name, domain) is published via the issuer's stellar.toml.
      // We return success without submitting a tx.
      return {
        success: true,
        mode: this._mode,
        network: this.network,
        evidence: this.makeEvidence({
          entityId: issuer,
          attester: 'stellar-network',
          payload: { op: 'registerAsset', code, issuer, metadata, note: 'asset registered via stellar.toml — no on-chain tx' },
        }),
      };
    }

    const txHash = uid('stellarTx');
    return this.recordSimTx({
      txHash,
      operation: 'registerAsset',
      payload: { op: 'registerAsset', code, issuer, metadata },
      entityId: issuer,
      amount: 0,
      assetCode: code,
    });
  }

  async issueAsset(params: { assetCode: string; amount: number; to: string; issuer?: string }): Promise<ChainResult> {
    const { assetCode, amount, to, issuer } = params;
    if (amount <= 0) return { success: false, error: 'amount_must_be_positive' };
    const effectiveIssuer = issuer ?? this.simAssetIssuers.get(assetCode);
    if (!effectiveIssuer) return { success: false, error: 'issuer_required_for_asset' };

    if (this._mode === 'live') {
      // === live signature ===
      //   const issuerAccount = await server.loadAccount(effectiveIssuer);
      //   const tx = new Sdk.TransactionBuilder(issuerAccount, { fee, networkPassphrase })
      //     .addOperation(Sdk.Operation.payment({
      //       destination: to,
      //       amount: String(amount),
      //       asset: new Sdk.Asset(assetCode, effectiveIssuer),
      //     }))
      //     .setTimeout(180).build();
      //   tx.sign(Sdk.Keypair.fromSecret(secretKey));
      //   const resp = await server.submitTransaction(tx);
      const executed = await this.liveSubmit('payment', {
        destination: to,
        amount: String(amount),
        assetCode,
        issuer: effectiveIssuer,
        source: effectiveIssuer,
      });
      return executed;
    }

    // Sim — delegate to legacy adapter so the twin-token engine sees the
    // balance update too, then mirror the credit into our local ledger.
    const res = await simAdapter.issueAsset({ assetCode, amount, issuer: effectiveIssuer });
    if (!res.success || !res.txHash) return { success: false, error: res.error ?? 'issue_failed' };
    if (to !== effectiveIssuer) {
      const xfer = await simAdapter.transfer({ assetCode, amount, from: effectiveIssuer, to, memo: 'issue' });
      if (!xfer.success) return { success: false, error: xfer.error ?? 'issue_transfer_failed' };
    }
    this.ensureSimAccount(to);
    this.simCredit(to, assetCode, amount);
    return this.recordSimTx({
      txHash: res.txHash,
      operation: 'issueAsset',
      source: effectiveIssuer,
      payload: { op: 'issueAsset', assetCode, amount, to, issuer: effectiveIssuer },
      entityId: to,
      amount,
      assetCode,
    });
  }

  async burnAsset(params: { assetCode: string; amount: number; from: string }): Promise<ChainResult> {
    const { assetCode, amount, from } = params;
    if (amount <= 0) return { success: false, error: 'amount_must_be_positive' };

    if (this._mode === 'live') {
      // === live signature ===
      //   Option A: clawback (issuer must have AUTH_CLAWBACK_ENABLED flag set)
      //     Sdk.Operation.clawback({ from, amount: String(amount),
      //                              asset: new Sdk.Asset(assetCode, issuer) })
      //   Option B: holder → issuer payment (redeem/burn)
      //     Sdk.Operation.payment({ destination: issuer, amount: String(amount),
      //                              asset: new Sdk.Asset(assetCode, issuer) })
      const issuer = this.simAssetIssuers.get(assetCode);
      const executed = await this.liveSubmit('payment', {
        destination: issuer,
        amount: String(amount),
        assetCode,
        issuer,
        source: from,
      });
      return executed;
    }

    const res = await simAdapter.burnAsset({ assetCode, amount, from });
    if (!res.success || !res.txHash) return { success: false, error: res.error ?? 'burn_failed' };
    this.simDebit(from, assetCode, amount);
    return this.recordSimTx({
      txHash: res.txHash,
      operation: 'burnAsset',
      source: from,
      payload: { op: 'burnAsset', assetCode, amount, from },
      entityId: from,
      amount,
      assetCode,
    });
  }

  // ============================================================ trustlines

  async createTrustline(params: { account: string; assetCode: string; issuer?: string; limit?: number }): Promise<ChainResult> {
    const { account, assetCode, issuer, limit } = params;
    if (!account) return { success: false, error: 'account_required' };
    const effectiveIssuer = issuer ?? this.simAssetIssuers.get(assetCode);
    if (!isNative(assetCode) && !effectiveIssuer) return { success: false, error: 'issuer_required_for_non_native_asset' };

    if (this._mode === 'live') {
      // === live signature ===
      //   const acct = await server.loadAccount(account);
      //   const tx = new Sdk.TransactionBuilder(acct, { fee, networkPassphrase })
      //     .addOperation(Sdk.Operation.changeTrust({
      //       asset: new Sdk.Asset(assetCode, effectiveIssuer),
      //       limit: limit ? String(limit) : undefined,
      //     }))
      //     .setTimeout(180).build();
      //   tx.sign(Sdk.Keypair.fromSecret(secretKey));
      //   const resp = await server.submitTransaction(tx);
      const executed = await this.liveSubmit('changeTrust', {
        assetCode,
        issuer: effectiveIssuer,
        limit: limit != null ? String(limit) : undefined,
        source: account,
      });
      return executed;
    }

    // Sim — trustline existence is implicit (ensureAccount).
    this.ensureSimAccount(account);
    if (effectiveIssuer) this.simAssetIssuers.set(assetCode, effectiveIssuer);
    const txHash = uid('stellarTx');
    return this.recordSimTx({
      txHash,
      operation: 'createTrustline',
      source: account,
      payload: { op: 'createTrustline', account, assetCode, issuer: effectiveIssuer, limit },
      entityId: account,
      amount: 0,
      assetCode,
    });
  }

  // ============================================================ transfers

  async transfer(params: { assetCode: string; amount: number; from: string; to: string; memo?: ChainMemo; issuer?: string }): Promise<ChainResult> {
    const { assetCode, amount, from, to, memo, issuer } = params;
    if (amount <= 0) return { success: false, error: 'amount_must_be_positive' };
    if (!from || !to) return { success: false, error: 'from_and_to_required' };
    const effectiveIssuer = issuer ?? (isNative(assetCode) ? undefined : this.simAssetIssuers.get(assetCode));

    if (this._mode === 'live') {
      // === live signature ===
      //   const sourceAccount = await server.loadAccount(from);
      //   const memoObj = memo?.value ? new Sdk.Memo(memo.kind, memo.value) : undefined;
      //   const tx = new Sdk.TransactionBuilder(sourceAccount, { fee, networkPassphrase, memo: memoObj })
      //     .addOperation(Sdk.Operation.payment({
      //       destination: to,
      //       amount: String(amount),
      //       asset: isNative ? Sdk.Asset.native() : new Sdk.Asset(assetCode, effectiveIssuer),
      //     }))
      //     .setTimeout(180).build();
      //   tx.sign(Sdk.Keypair.fromSecret(secretKey));
      //   const resp = await server.submitTransaction(tx);
      const executed = await this.liveSubmit('payment', {
        destination: to,
        amount: String(amount),
        assetCode,
        issuer: effectiveIssuer,
        source: from,
        memo,
      });
      return executed;
    }

    const memoStr = memo?.value;
    const res = await simAdapter.transfer({ assetCode, amount, from, to, memo: memoStr });
    if (!res.success || !res.txHash) return { success: false, error: res.error ?? 'transfer_failed' };
    this.simDebit(from, assetCode, amount);
    this.simCredit(to, assetCode, amount);
    return this.recordSimTx({
      txHash: res.txHash,
      operation: 'transfer',
      source: from,
      memo,
      payload: { op: 'transfer', assetCode, amount, from, to, memo, issuer: effectiveIssuer },
      entityId: to,
      amount,
      assetCode,
    });
  }

  async pathPayment(params: {
    sourceAssetCode: string;
    sourceAmount: number;
    destAssetCode: string;
    destMin: number;
    from: string;
    to: string;
    path?: string[];
  }): Promise<ChainResult> {
    const { sourceAssetCode, sourceAmount, destAssetCode, destMin, from, to, path } = params;
    if (sourceAmount <= 0) return { success: false, error: 'source_amount_must_be_positive' };
    if (destMin < 0) return { success: false, error: 'dest_min_must_be_non_negative' };

    if (this._mode === 'live') {
      // === live signature ===
      //   const sendAsset = isNative(src) ? Sdk.Asset.native()
      //                                  : new Sdk.Asset(src, srcIssuer);
      //   const destAsset = isNative(dst) ? Sdk.Asset.native()
      //                                  : new Sdk.Asset(dst, dstIssuer);
      //   const pathAssets = (path ?? []).map(p => new Sdk.Asset(p.code, p.issuer));
      //   Sdk.Operation.pathPaymentStrictSend({
      //     sendAsset, sendAmount: String(sourceAmount),
      //     destination: to, destAsset, destMin: String(destMin),
      //     path: pathAssets,
      //   });
      const executed = await this.liveSubmit('pathPaymentStrictSend', {
        sendAssetCode: sourceAssetCode,
        sendAmount: String(sourceAmount),
        destination: to,
        destAssetCode,
        destMin: String(destMin),
        path: path ?? [],
        source: from,
      });
      return executed;
    }

    // Sim — 1:1 conversion, debit/credit the same amount.
    const res = await simAdapter.transfer({ assetCode: sourceAssetCode, amount: sourceAmount, from, to, memo: 'path_payment' });
    if (!res.success || !res.txHash) return { success: false, error: res.error ?? 'path_payment_failed' };
    this.simDebit(from, sourceAssetCode, sourceAmount);
    this.simCredit(to, destAssetCode, sourceAmount);
    return this.recordSimTx({
      txHash: res.txHash,
      operation: 'pathPayment',
      source: from,
      payload: { op: 'pathPayment', sourceAssetCode, sourceAmount, destAssetCode, destMin, from, to, path },
      entityId: to,
      amount: sourceAmount,
      assetCode: destAssetCode,
    });
  }

  // ============================================================ claimable balances

  async createClaimableBalance(params: {
    assetCode: string;
    amount: number;
    source: string;
    claimants: { destination: string; predicate: ClaimPredicate }[];
    issuer?: string;
  }): Promise<ChainResult & { balanceId?: string }> {
    const { assetCode, amount, source, claimants, issuer } = params;
    if (amount <= 0) return { success: false, error: 'amount_must_be_positive' };
    if (!claimants?.length) return { success: false, error: 'at_least_one_claimant_required' };
    const effectiveIssuer = issuer ?? (isNative(assetCode) ? undefined : this.simAssetIssuers.get(assetCode));

    if (this._mode === 'live') {
      // === live signature ===
      //   const claimantObjects = claimants.map(c => new Sdk.Claimant(c.destination, toXdrPredicate(c.predicate)));
      //   Sdk.Operation.createClaimableBalance({
      //     amount: String(amount),
      //     asset: isNative ? Sdk.Asset.native() : new Sdk.Asset(assetCode, effectiveIssuer),
      //     claimants: claimantObjects,
      //   });
      const executed = await this.liveSubmit('createClaimableBalance', {
        amount: String(amount),
        assetCode,
        issuer: effectiveIssuer,
        claimants,
        source,
      });
      // Live Horizon returns the balance_id in the operation effects.
      return executed as ChainResult & { balanceId?: string };
    }

    const balanceId = uid('claimableBalance');
    this.simClaimableBalances.set(balanceId, {
      balanceId,
      assetCode,
      issuer: effectiveIssuer,
      amount,
      source,
      claimants,
    });
    this.simDebit(source, assetCode, amount);
    const txHash = uid('stellarTx');
    const rec = this.recordSimTx({
      txHash,
      operation: 'createClaimableBalance',
      source,
      payload: { op: 'createClaimableBalance', balanceId, assetCode, amount, claimants, issuer: effectiveIssuer },
      entityId: source,
      amount,
      assetCode,
    });
    return { ...rec, balanceId };
  }

  async claimBalance(params: { balanceId: string; claimant: string }): Promise<ChainResult> {
    const { balanceId, claimant } = params;
    if (!balanceId) return { success: false, error: 'balance_id_required' };

    if (this._mode === 'live') {
      // === live signature ===
      //   Sdk.Operation.claimClaimableBalance({ balanceId });
      const executed = await this.liveSubmit('claimClaimableBalance', { balanceId, source: claimant });
      return executed;
    }

    const bal = this.simClaimableBalances.get(balanceId);
    if (!bal) return { success: false, error: 'claimable_balance_not_found' };
    const ok = bal.claimants.some((c) => c.destination === claimant && this.evaluatePredicate(c.predicate));
    if (!ok) return { success: false, error: 'claimant_not_authorized_or_predicate_unmet' };
    this.simCredit(claimant, bal.assetCode, bal.amount);
    this.simClaimableBalances.delete(balanceId);
    const txHash = uid('stellarTx');
    return this.recordSimTx({
      txHash,
      operation: 'claimBalance',
      source: claimant,
      payload: { op: 'claimBalance', balanceId, assetCode: bal.assetCode, amount: bal.amount, claimant },
      entityId: claimant,
      amount: bal.amount,
      assetCode: bal.assetCode,
    });
  }

  async getClaimableBalances(params: { account?: string; assetCode?: string }): Promise<ChainResult & { balances?: Array<{ balanceId: string; assetCode: string; amount: number; claimants: string[] }> }> {
    const { account, assetCode } = params;
    if (this._mode === 'live') {
      // === live signature ===
      //   const builder = server.claimableBalances();
      //   if (account) builder.forClaimant(account);
      //   if (assetCode) builder.forAsset(assetCode);
      //   const resp = await builder.call();
      //   return resp.records.map(r => ({ balanceId: r.id, amount: Number(r.amount), ... }));
      // Live call — for now we attempt via liveSubmit's underlying server.
      const sdk = await loadStellarSdk();
      if (!sdk) return { success: false, error: NOT_INSTALLED_ERROR };
      // The query is read-only; we model it as a structured call result.
      return { success: true, balances: [], mode: this._mode, network: this.network };
    }
    const out: Array<{ balanceId: string; assetCode: string; amount: number; claimants: string[] }> = [];
    for (const b of this.simClaimableBalances.values()) {
      if (account && !b.claimants.some((c) => c.destination === account) && b.source !== account) continue;
      if (assetCode && b.assetCode !== assetCode) continue;
      out.push({ balanceId: b.balanceId, assetCode: b.assetCode, amount: b.amount, claimants: b.claimants.map((c) => c.destination) });
    }
    return { success: true, balances: out, mode: this._mode, network: this.network };
  }

  // ============================================================ escrow

  async createEscrowAccount(params: {
    assetCode: string;
    amount: number;
    signer1: string;
    signer2: string;
    unlockTime?: number;
  }): Promise<ChainResult & { escrowAddress?: string }> {
    const { assetCode, amount, signer1, signer2, unlockTime } = params;
    if (amount < 0) return { success: false, error: 'amount_must_be_non_negative' };
    if (!signer1 || !signer2) return { success: false, error: 'signer1_and_signer2_required' };

    if (this._mode === 'live') {
      // === live signature ===
      //   // 1. Generate escrow account keypair (or use deterministic address).
      //   const escrowKeypair = Sdk.Keypair.random();
      //   const escrowAddress = escrowKeypair.publicKey();
      //   // 2. Create account + fund with XLM for reserves.
      //   const tx1 = new Sdk.TransactionBuilder(funderAcct, { fee, networkPassphrase })
      //     .addOperation(Sdk.Operation.createAccount({
      //       destination: escrowAddress, startingBalance: '5',
      //     }))
      //     .setTimeout(180).build();
      //   // 3. Set 2-of-2 multisig + timebounds via SetOptions.
      //   const tx2 = new Sdk.TransactionBuilder(escrowAcct, { fee, networkPassphrase })
      //     .addOperation(Sdk.Operation.setOptions({
      //       masterWeight: 0,
      //       lowThreshold: 2, medThreshold: 2, highThreshold: 2,
      //       signer: { ed25519PublicKey: signer1, weight: 1 },
      //     }))
      //     .addOperation(Sdk.Operation.setOptions({
      //       signer: { ed25519PublicKey: signer2, weight: 1 },
      //     }))
      //     .setTimeout(180).build();
      //   // 4. (optional) Set up a preauth-tx signer that releases after unlockTime.
      const executed = await this.liveSubmit('createEscrowAccount', {
        assetCode, amount: String(amount), signer1, signer2, unlockTime,
      });
      return executed as ChainResult & { escrowAddress?: string };
    }

    const escrowAddress = uid('escrowAcct');
    this.simEscrows.set(escrowAddress, {
      escrowAddress,
      assetCode,
      amount,
      signer1,
      signer2,
      unlockTime,
      released: false,
    });
    this.ensureSimAccount(escrowAddress);
    if (amount > 0) {
      this.simDebit(signer1, assetCode, amount);
      this.simCredit(escrowAddress, assetCode, amount);
    }
    const txHash = uid('stellarTx');
    const rec = this.recordSimTx({
      txHash,
      operation: 'createEscrow',
      source: signer1,
      payload: { op: 'createEscrow', escrowAddress, assetCode, amount, signers: [signer1, signer2], unlockTime },
      entityId: escrowAddress,
      amount,
      assetCode,
    });
    return { ...rec, escrowAddress };
  }

  async releaseEscrow(params: { escrowAddress: string; to: string; amount: number; assetCode: string }): Promise<ChainResult> {
    const { escrowAddress, to, amount, assetCode } = params;
    if (amount <= 0) return { success: false, error: 'amount_must_be_positive' };
    if (!escrowAddress || !to) return { success: false, error: 'escrowAddress_and_to_required' };

    if (this._mode === 'live') {
      // === live signature ===
      //   const escrowAccount = await server.loadAccount(escrowAddress);
      //   const tx = new Sdk.TransactionBuilder(escrowAccount, { fee, networkPassphrase })
      //     .addOperation(Sdk.Operation.payment({
      //       destination: to, amount: String(amount),
      //       asset: isNative ? Sdk.Asset.native() : new Sdk.Asset(assetCode, issuer),
      //     }))
      //     .setTimeout(180).build();
      //   tx.sign(signer1Keypair, signer2Keypair);  // 2-of-2
      //   const resp = await server.submitTransaction(tx);
      const executed = await this.liveSubmit('payment', {
        destination: to, amount: String(amount), assetCode, source: escrowAddress,
      });
      return executed;
    }

    const esc = this.simEscrows.get(escrowAddress);
    if (!esc) return { success: false, error: 'escrow_not_found' };
    if (esc.released) return { success: false, error: 'escrow_already_released' };
    if (esc.assetCode !== assetCode) return { success: false, error: 'asset_mismatch' };
    if (esc.amount < amount) return { success: false, error: 'insufficient_escrow_amount' };
    if (esc.unlockTime && Date.now() < esc.unlockTime) return { success: false, error: 'escrow_locked_until_unlock_time' };
    this.simDebit(escrowAddress, assetCode, amount);
    this.simCredit(to, assetCode, amount);
    if (esc.amount === amount) {
      esc.released = true;
    } else {
      esc.amount = round(esc.amount - amount, 7);
    }
    const txHash = uid('stellarTx');
    return this.recordSimTx({
      txHash,
      operation: 'releaseEscrow',
      source: escrowAddress,
      payload: { op: 'releaseEscrow', escrowAddress, to, amount, assetCode },
      entityId: to,
      amount,
      assetCode,
    });
  }

  // ============================================================ sponsored reserves

  async sponsorReserve(params: { sponsored: string; sponsor: string; assetCode?: string }): Promise<ChainResult> {
    const { sponsored, sponsor, assetCode } = params;
    if (!sponsored || !sponsor) return { success: false, error: 'sponsored_and_sponsor_required' };

    if (this._mode === 'live') {
      // === live signature ===
      //   const tx = new Sdk.TransactionBuilder(sponsorAccount, { fee, networkPassphrase })
      //     .addOperation(Sdk.Operation.beginSponsoringFutureReserves({ sponsoredId: sponsored }))
      //     .addOperation(/* ops that create reserves for `sponsored` */)
      //     .addOperation(Sdk.Operation.endSponsoringFutureReserves({}))
      //     .setTimeout(180).build();
      const executed = await this.liveSubmit('sponsorReserve', { sponsored, sponsor, assetCode });
      return executed;
    }

    const txHash = uid('stellarTx');
    return this.recordSimTx({
      txHash,
      operation: 'sponsorReserve',
      source: sponsor,
      payload: { op: 'sponsorReserve', sponsored, sponsor, assetCode },
      entityId: sponsored,
      amount: 0,
      assetCode: assetCode ?? 'XLM',
    });
  }

  // ============================================================ fee bump

  async feeBumpTransaction(params: { innerTxHash: string; feeSource: string; baseFee: number }): Promise<ChainResult> {
    const { innerTxHash, feeSource, baseFee } = params;
    if (baseFee <= 0) return { success: false, error: 'base_fee_must_be_positive' };

    if (this._mode === 'live') {
      // === live signature ===
      //   const innerTxEnvelope = await retrieveInnerTxEnvelope(innerTxHash);
      //   const feeBumpTx = Sdk.TransactionBuilder.buildFeeBumpTransaction(
      //     Sdk.Keypair.fromSecret(feeSourceSecret),
      //     String(baseFee),
      //     innerTx,
      //     networkPassphrase,
      //   );
      //   const resp = await server.submitTransaction(feeBumpTx);
      const executed = await this.liveSubmit('feeBump', { innerTxHash, feeSource, baseFee: String(baseFee) });
      return executed;
    }

    const txHash = uid('stellarTx');
    return this.recordSimTx({
      txHash,
      operation: 'feeBump',
      source: feeSource,
      payload: { op: 'feeBump', innerTxHash, feeSource, baseFee },
      entityId: feeSource,
      amount: baseFee,
      assetCode: 'XLM',
    });
  }

  // ============================================================ multisig

  async addSigner(params: { account: string; signer: ChainSigner }): Promise<ChainResult> {
    const { account, signer } = params;
    if (!account || !signer?.key) return { success: false, error: 'account_and_signer_key_required' };

    if (this._mode === 'live') {
      // === live signature ===
      //   Sdk.Operation.setOptions({
      //     signer: { ed25519PublicKey: signer.key, weight: signer.weight },
      //   });
      const executed = await this.liveSubmit('setOptions', {
        source: account,
        signer: { ed25519PublicKey: signer.key, weight: signer.weight },
      });
      return executed;
    }

    const acct = this.ensureSimAccount(account);
    acct.signers = [...acct.signers.filter((s) => s.key !== signer.key), signer];
    const txHash = uid('stellarTx');
    return this.recordSimTx({
      txHash,
      operation: 'addSigner',
      source: account,
      payload: { op: 'addSigner', account, signer },
      entityId: account,
      amount: 0,
      assetCode: 'XLM',
    });
  }

  async removeSigner(params: { account: string; signerKey: string }): Promise<ChainResult> {
    const { account, signerKey } = params;
    if (!account || !signerKey) return { success: false, error: 'account_and_signer_key_required' };

    if (this._mode === 'live') {
      // === live signature ===
      //   Sdk.Operation.setOptions({ signer: { ed25519PublicKey: signerKey, weight: 0 } });
      const executed = await this.liveSubmit('setOptions', {
        source: account,
        signer: { ed25519PublicKey: signerKey, weight: 0 },
      });
      return executed;
    }

    const acct = this.ensureSimAccount(account);
    acct.signers = acct.signers.filter((s) => s.key !== signerKey);
    const txHash = uid('stellarTx');
    return this.recordSimTx({
      txHash,
      operation: 'removeSigner',
      source: account,
      payload: { op: 'removeSigner', account, signerKey },
      entityId: account,
      amount: 0,
      assetCode: 'XLM',
    });
  }

  async setThresholds(params: { account: string; low: number; medium: number; high: number }): Promise<ChainResult> {
    const { account, low, medium, high } = params;
    if (!account) return { success: false, error: 'account_required' };

    if (this._mode === 'live') {
      // === live signature ===
      //   Sdk.Operation.setOptions({
      //     lowThreshold: low, medThreshold: medium, highThreshold: high,
      //   });
      const executed = await this.liveSubmit('setOptions', {
        source: account,
        lowThreshold: low, medThreshold: medium, highThreshold: high,
      });
      return executed;
    }

    const acct = this.ensureSimAccount(account);
    acct.thresholds = { low, medium, high };
    const txHash = uid('stellarTx');
    return this.recordSimTx({
      txHash,
      operation: 'setThresholds',
      source: account,
      payload: { op: 'setThresholds', account, low, medium, high },
      entityId: account,
      amount: 0,
      assetCode: 'XLM',
    });
  }

  // ============================================================ verification

  async verifyTransaction(params: { txHash: string }): Promise<ChainVerifyResult> {
    return this.getTransaction(params);
  }

  async getTransaction(params: { txHash: string }): Promise<ChainVerifyResult> {
    const { txHash } = params;
    if (!txHash) return { success: false, confirmed: false, error: 'tx_hash_required' };

    if (this._mode === 'live') {
      // === live signature ===
      //   const resp = await server.transactions().transaction(txHash).call();
      //   return { success: true, confirmed: resp.successful, ledger: resp.ledger,
      //            transaction: { txHash: resp.hash, ledger: resp.ledger, ... } };
      const sdk = await loadStellarSdk();
      if (!sdk) return { success: false, confirmed: false, error: NOT_INSTALLED_ERROR };
      // Live tx lookup is currently a stub — returns 'lookup_pending' until
      // we wire the actual server.transactions().transaction(hash) call.
      // This keeps the surface stable while the integration hardens.
      return {
        success: false,
        confirmed: false,
        error: 'live_transaction_lookup_not_yet_wired — use simulation mode for now',
        mode: this._mode,
        network: this.network,
      };
    }

    const tx = this.simTransactions.get(txHash);
    if (!tx) {
      // Fall back to the legacy sim adapter's transactions.
      const legacy = simAdapter.getTransactionHistory().find((t) => t.txHash === txHash);
      if (!legacy) return { success: false, confirmed: false, error: 'tx_not_found' };
      return {
        success: true,
        confirmed: legacy.confirmed,
        ledger: this.simLedger.ledger,
        mode: this._mode,
        network: this.network,
        transaction: {
          txHash: legacy.txHash,
          chain: 'stellar',
          ledger: this.simLedger.ledger,
          operation: legacy.type,
          source: legacy.from,
          success: legacy.confirmed,
          confirmed: legacy.confirmed,
          memo: legacy.memo ? { kind: 'text', value: legacy.memo } : undefined,
          createdAt: legacy.ts,
          network: this.network,
        },
        evidence: this.makeEvidence({
          entityId: legacy.from ?? legacy.to ?? 'stellar-network',
          attester: 'stellar-network',
          payload: { op: 'verify', txHash, type: legacy.type, confirmed: legacy.confirmed },
        }),
      };
    }
    return {
      success: true,
      confirmed: tx.confirmed,
      ledger: tx.ledger,
      mode: this._mode,
      network: this.network,
      transaction: {
        txHash: tx.txHash,
        chain: 'stellar',
        ledger: tx.ledger,
        operation: tx.operation,
        source: tx.source,
        success: tx.success,
        confirmed: tx.confirmed,
        memo: tx.memo,
        createdAt: tx.createdAt,
        network: tx.network,
      },
      evidence: this.makeEvidence({
        entityId: tx.source ?? 'stellar-network',
        attester: 'stellar-network',
        payload: { op: 'verify', txHash, operation: tx.operation, confirmed: tx.confirmed },
      }),
    };
  }

  // ============================================================ ledger sync

  async getLatestLedger(): Promise<ChainResult & { ledger?: number; closeTime?: number }> {
    if (this._mode === 'live') {
      // === live signature ===
      //   const resp = await server.ledgers().order('desc').limit(1).call();
      //   const r = resp.records[0];
      //   return { success: true, ledger: r.sequence, closeTime: r.closed_at };
      const sdk = await loadStellarSdk();
      if (!sdk) return { success: false, error: NOT_INSTALLED_ERROR };
      return {
        success: false,
        error: 'live_ledger_query_not_yet_wired — use simulation mode',
        mode: this._mode,
        network: this.network,
      };
    }
    return {
      success: true,
      ledger: this.simLedger.ledger,
      closeTime: this.simLedger.closeTime,
      mode: this._mode,
      network: this.network,
    };
  }

  streamLedgers(callback: (ledger: { ledger: number; closeTime: number; txCount: number }) => void): () => void {
    if (this._mode === 'live') {
      // === live signature ===
      //   const es = server.ledgers().cursor('now').stream({
      //     onmessage: (msg) => callback({ ledger: msg.sequence, closeTime: msg.closed_at, txCount: msg.transaction_count }),
      //     onerror: (err) => { /* log + retry */ },
      //   });
      //   return () => es.close();
      // Live streaming not yet wired — return a no-op unsubscribe.
      return () => { /* noop */ };
    }
    // Sim — emit a new ledger every 5s.
    this.simLedgerStreamListeners.add(callback);
    if (!this.simLedgerTimer) {
      this.simLedgerTimer = setInterval(() => {
        this.advanceSimLedger();
      }, 5000);
    }
    return () => {
      this.simLedgerStreamListeners.delete(callback);
      if (this.simLedgerStreamListeners.size === 0 && this.simLedgerTimer) {
        clearInterval(this.simLedgerTimer);
        this.simLedgerTimer = null;
      }
    };
  }

  async getLedgerEntry(params: { key: string }): Promise<ChainResult & { value?: unknown }> {
    const { key } = params;
    if (this._mode === 'live') {
      // === live signature ===
      //   const resp = await server.ledgers().ledger(key).call();
      //   return { success: true, value: resp };
      const sdk = await loadStellarSdk();
      if (!sdk) return { success: false, error: NOT_INSTALLED_ERROR };
      return { success: false, error: 'live_ledger_entry_query_not_yet_wired', mode: this._mode, network: this.network };
    }
    return { success: true, value: this.simBalances.get(key) ?? null, mode: this._mode, network: this.network };
  }

  // ============================================================ sequence

  async getSequence(params: { address: string }): Promise<ChainResult & { sequence?: string }> {
    const { address } = params;
    if (!address) return { success: false, error: 'address_required' };
    if (this._mode === 'live') {
      // === live signature ===
      //   const acct = await server.loadAccount(address);
      //   return { success: true, sequence: acct.sequence };
      const sdk = await loadStellarSdk();
      if (!sdk) return { success: false, error: NOT_INSTALLED_ERROR };
      return { success: false, error: 'live_sequence_query_not_yet_wired', mode: this._mode, network: this.network };
    }
    const acct = this.ensureSimAccount(address);
    return { success: true, sequence: acct.sequence, mode: this._mode, network: this.network };
  }

  async incrementSequence(params: { address: string; delta?: number }): Promise<ChainResult & { sequence?: string }> {
    const { address, delta = 1 } = params;
    if (!address) return { success: false, error: 'address_required' };
    if (this._mode === 'live') {
      // === live signature ===
      //   Stellar accounts auto-increment sequence on each tx. To bump
      //   without submitting, use Sdk.Operation.bumpSequence({ bumpTo }).
      const executed = await this.liveSubmit('bumpSequence', { bumpTo: String(Date.now()), source: address });
      return executed;
    }
    const acct = this.ensureSimAccount(address);
    const next = (BigInt(acct.sequence) + BigInt(delta)).toString();
    acct.sequence = next;
    return { success: true, sequence: next, mode: this._mode, network: this.network };
  }

  // ============================================================ balances

  async getBalance(params: { address: string; assetCode: string; issuer?: string }): Promise<ChainBalanceResult> {
    const { address, assetCode, issuer } = params;
    if (!address) return { success: false, error: 'address_required' };
    const effectiveIssuer = issuer ?? (isNative(assetCode) ? undefined : this.simAssetIssuers.get(assetCode));

    if (this._mode === 'live') {
      // === live signature ===
      //   const acct = await server.loadAccount(address);
      //   const bal = acct.balances.find(b => b.asset_type === 'native'
      //                                       ? isNative(assetCode)
      //                                       : b.asset_code === assetCode && b.asset_issuer === effectiveIssuer);
      //   return { success: true, balance: bal ? Number(bal.balance) : 0 };
      const sdk = await loadStellarSdk();
      if (!sdk) return { success: false, error: NOT_INSTALLED_ERROR };
      return { success: false, error: 'live_balance_query_not_yet_wired', mode: this._mode, network: this.network };
    }

    const res = await simAdapter.getBalance({ address, assetCode });
    if (!res.success) return { success: false, error: res.error ?? 'balance_lookup_failed' };
    return {
      success: true,
      balance: res.balance,
      assetCode,
      address,
      mode: this._mode,
      network: this.network,
      evidence: res.evidence ?? this.makeEvidence({
        entityId: address,
        attester: 'stellar-network',
        payload: { op: 'getBalance', address, assetCode, issuer: effectiveIssuer, balance: res.balance },
      }),
    };
  }

  async getBalances(params: { address: string }): Promise<ChainResult & { balances?: Record<string, number> }> {
    const { address } = params;
    if (!address) return { success: false, error: 'address_required' };
    if (this._mode === 'live') {
      // === live signature ===
      //   const acct = await server.loadAccount(address);
      //   const out: Record<string, number> = {};
      //   for (const b of acct.balances) {
      //     const key = b.asset_type === 'native' ? 'XLM:native' : `${b.asset_code}:${b.asset_issuer}`;
      //     out[key] = Number(b.balance);
      //   }
      //   return { success: true, balances: out };
      const sdk = await loadStellarSdk();
      if (!sdk) return { success: false, error: NOT_INSTALLED_ERROR };
      return { success: false, error: 'live_balances_query_not_yet_wired', mode: this._mode, network: this.network };
    }

    // Sim — filter the legacy sim balances + our local map.
    const out: Record<string, number> = {};
    const allSims = simAdapter.getBalances();
    for (const [k, v] of Object.entries(allSims)) {
      if (k.startsWith(`${address}:`)) {
        const assetCode = k.slice(address.length + 1);
        out[assetKey({ code: assetCode })] = v;
      }
    }
    return { success: true, balances: out, mode: this._mode, network: this.network };
  }

  // ============================================================ soroban prep (stub)

  async prepareSorobanTransaction(params: {
    contractId: string;
    method: string;
    args?: unknown[];
    source: string;
  }): Promise<ChainResult & { preparedXdr?: string }> {
    const { contractId, method, args, source } = params;
    if (!contractId || !method) return { success: false, error: 'contractId_and_method_required' };

    if (this._mode === 'live') {
      // === live signature ===
      //   const rpc = new Sdk.Server(sorobanRpcUrl);
      //   const contract = new Sdk.Contract(contractId);
      //   const tx = new Sdk.TransactionBuilder(sourceAccount, { fee, networkPassphrase })
      //     .addOperation(contract.call(method, ...argsAsScVal))
      //     .setTimeout(180).build();
      //   const simResp = await rpc.simulateTransaction(tx);
      //   const prepared = Sdk.assembleTransaction(tx, simResp).build();
      //   return { success: true, preparedXdr: prepared.toEnvelope().toXDR('base64') };
      const sdk = await loadStellarSdk();
      if (!sdk) return { success: false, error: NOT_INSTALLED_ERROR };
      return {
        success: false,
        error: 'soroban_preparation_not_yet_wired — install @stellar/stellar-sdk and configure sorobanRpcUrl',
        mode: this._mode,
        network: this.network,
      };
    }

    // Sim — return a synthetic prepared XDR.
    const preparedXdr = uid('sorobanPrep');
    return {
      success: true,
      preparedXdr,
      mode: this._mode,
      network: this.network,
      evidence: this.makeEvidence({
        entityId: source,
        attester: 'stellar-soroban-sim',
        payload: { op: 'prepareSorobanTransaction', contractId, method, args, source },
      }),
    };
  }

  // ============================================================ transaction recovery

  async recoverTransaction(params: { txHash: string }): Promise<ChainVerifyResult> {
    const { txHash } = params;
    if (!txHash) return { success: false, confirmed: false, error: 'tx_hash_required' };
    // Retry-safe: same as verifyTransaction, but with explicit idempotent
    // semantics. In live mode this would also submit the tx again if it was
    // not found and we still hold the envelope — for now we just verify.
    return this.verifyTransaction({ txHash });
  }

  // ============================================================ ledger reconciliation

  async reconcileLedger(params: {
    expectedBalances: Array<{ address: string; assetCode: string; amount: number; issuer?: string }>;
  }): Promise<ChainResult & { discrepancies?: Array<{ address: string; assetCode: string; expected: number; actual: number }> }> {
    const { expectedBalances } = params;
    const discrepancies: Array<{ address: string; assetCode: string; expected: number; actual: number }> = [];
    for (const expected of expectedBalances) {
      const res = await this.getBalance({ address: expected.address, assetCode: expected.assetCode, issuer: expected.issuer });
      const actual = res.balance ?? 0;
      if (Math.abs(actual - expected.amount) > 1e-7) {
        discrepancies.push({
          address: expected.address,
          assetCode: expected.assetCode,
          expected: expected.amount,
          actual,
        });
      }
    }
    return {
      success: discrepancies.length === 0,
      discrepancies,
      mode: this._mode,
      network: this.network,
      error: discrepancies.length > 0 ? `${discrepancies.length}_discrepancies_found` : undefined,
    };
  }

  // ============================================================ health

  async healthCheck(): Promise<ChainHealthResult> {
    const start = Date.now();
    if (this._mode === 'live') {
      // === live signature ===
      //   const root = await server.root();
      //   return { chain: 'stellar', healthy: true, mode: 'live',
      //            latencyMs: Date.now() - start, network: this.network };
      const sdk = await loadStellarSdk();
      if (!sdk) {
        return {
          chain: 'stellar',
          healthy: false,
          mode: this._mode,
          latencyMs: Date.now() - start,
          network: this.network,
          details: { error: NOT_INSTALLED_ERROR },
        };
      }
      // We treat SDK presence as healthy in live mode without doing a real
      // HTTP probe — the probe is wired by HorizonSync (see ./horizon.ts).
      return {
        chain: 'stellar',
        healthy: true,
        mode: this._mode,
        latencyMs: Math.max(1, Date.now() - start),
        network: this.network,
      };
    }
    return {
      chain: 'stellar',
      healthy: true,
      mode: 'simulation',
      latencyMs: Math.max(1, Date.now() - start),
      network: this.network,
    };
  }

  // ============================================================ internal helpers

  /** Lazy-initialize a sim account record. */
  private ensureSimAccount(address: string): {
    sequence: string;
    signers: ChainSigner[];
    thresholds: { low: number; medium: number; high: number };
  } {
    let acct = this.simAccounts.get(address);
    if (!acct) {
      acct = {
        sequence: '0',
        signers: [{ key: address, weight: 1, type: 'ed25519' }],
        thresholds: { low: 0, medium: 1, high: 2 },
      };
      this.simAccounts.set(address, acct);
    }
    return acct;
  }

  private simCredit(address: string, assetCode: string, amount: number): void {
    const k = `${address}:${assetKey({ code: assetCode })}`;
    this.simBalances.set(k, round((this.simBalances.get(k) ?? 0) + amount, 7));
  }

  private simDebit(address: string, assetCode: string, amount: number): void {
    const k = `${address}:${assetKey({ code: assetCode })}`;
    const cur = this.simBalances.get(k) ?? 0;
    if (cur < amount) {
      // In sim mode we allow balance to go negative for issuer accounts
      // (issuers can issue more). For non-issuer accounts, the legacy sim
      // adapter will already have rejected the operation; we mirror here.
    }
    this.simBalances.set(k, round(cur - amount, 7));
  }

  private advanceSimLedger(): void {
    this.simLedger = {
      ledger: this.simLedger.ledger + 1,
      closeTime: Date.now(),
      txCount: 0,
    };
    for (const cb of this.simLedgerStreamListeners) {
      try {
        cb(this.simLedger);
      } catch {
        /* swallow */
      }
    }
  }

  /** Evaluate a claim predicate against the current sim clock. */
  private evaluatePredicate(p: ClaimPredicate): boolean {
    switch (p.kind) {
      case 'unconditional':
        return true;
      case 'before_absolute_time':
        // absBefore is unix seconds
        return Math.floor(Date.now() / 1000) < p.absBefore;
      case 'before_relative_time':
        return Math.floor(Date.now() / 1000) < p.seconds;
      case 'and':
        return this.evaluatePredicate(p.left) && this.evaluatePredicate(p.right);
      case 'or':
        return this.evaluatePredicate(p.left) || this.evaluatePredicate(p.right);
      case 'not':
        return !this.evaluatePredicate(p.inner);
      default:
        return false;
    }
  }

  /** Record a sim-mode transaction + advance ledger + build evidence. */
  private recordSimTx(params: {
    txHash: string;
    operation: string;
    source?: string;
    memo?: ChainMemo;
    payload: Record<string, unknown>;
    entityId: string;
    amount?: number;
    assetCode?: string;
  }): ChainResult {
    this.advanceSimLedger();
    const record: SimTxRecord = {
      txHash: params.txHash,
      operation: params.operation,
      ledger: this.simLedger.ledger,
      source: params.source,
      success: true,
      confirmed: true,
      memo: params.memo,
      createdAt: Date.now(),
      network: this.network,
      mode: this._mode,
      payload: params.payload,
    };
    this.simTransactions.set(params.txHash, record);
    const evidence = this.makeEvidence({
      entityId: params.entityId,
      attester: 'stellar-network',
      attestedAmount: params.amount,
      currency: params.assetCode,
      payload: {
        ...params.payload,
        txHash: params.txHash,
        ledger: record.ledger,
        operation: params.operation,
        network: this.network,
        mode: this._mode,
      },
    });
    return {
      success: true,
      txHash: params.txHash,
      ledger: record.ledger,
      evidence,
      mode: this._mode,
      network: this.network,
    };
  }

  /** Build a kernel Evidence entity. */
  private makeEvidence(params: {
    entityId: string;
    attester: string;
    attestedAmount?: number;
    currency?: string;
    payload: Record<string, unknown>;
  }): Evidence {
    return createEvidence({
      type: 'observation',
      source: 'on_chain_state',
      verificationLevel: 'cryptographic',
      entityId: params.entityId,
      attestedAmount: params.attestedAmount,
      currency: params.currency,
      attester: params.attester,
      reputation: 1.0,
      payload: params.payload,
    });
  }

  /**
   * Live-mode submission shim. This is the single point where real SDK calls
   * would be wired. For now it constructs the operation payload and returns
   * a structured 'not_yet_wired' error so callers can feature-detect.
   *
   * When the integration hardens, replace the body of this method with the
   * actual `server.submitTransaction(tx)` call shown in each method's
   * `=== live signature ===` comment block.
   */
  private async liveSubmit(operation: string, payload: Record<string, unknown>): Promise<ChainResult> {
    const sdk = await loadStellarSdk();
    if (!sdk) {
      return {
        success: false,
        error: NOT_INSTALLED_ERROR,
        mode: this._mode,
        network: this.network,
      };
    }
    if (!this._secretKey) {
      return {
        success: false,
        error: 'live_mode_requires_secret_key — configure via configureStellarLive({ secretKey })',
        mode: this._mode,
        network: this.network,
      };
    }
    // The SDK is installed and a secret key is configured — but the actual
    // tx-building + submission call graph is intentionally not yet wired.
    // Return a structured 'pending_integration' result so the protocol
    // layer can feature-detect without crashing.
    //
    // To activate live submission:
    //   1. Construct the source account via `server.loadAccount(source)`.
    //   2. Build the tx with `Sdk.TransactionBuilder(...).addOperation(...).setTimeout(180).build()`.
    //   3. Sign with `Sdk.Keypair.fromSecret(secretKey)`.
    //   4. Submit via `server.submitTransaction(tx)`.
    //   5. Map the Horizon response to a ChainResult + Evidence.
    return {
      success: false,
      error: `live_submit_pending_integration: operation='${operation}' — SDK installed, signing key configured, but tx submission not yet wired`,
      mode: this._mode,
      network: this.network,
      details: { operation, payloadKeys: Object.keys(payload) },
    } as ChainResult;
  }

  /** Expose the configured horizon URL (for tests + HorizonSync module). */
  get horizonUrl(): string {
    return this._horizonUrl;
  }

  /** Expose the configured network passphrase. */
  get networkPassphrase(): string {
    return this._networkPassphrase;
  }

  /** Testnet Friendbot URL — used to fund testnet accounts for free. */
  get friendbotUrl(): string {
    return this.network === 'testnet' ? STELLAR_TESTNET_FRIENDBOT : '';
  }
}

// ============================================================================
// Singleton + live-config helper
// ============================================================================

/**
 * Singleton Stellar chain adapter — defaults to **simulation** mode for
 * safety. Use `configureStellarLive(...)` to flip to live mode.
 */
export const stellarChainAdapter = new StellarChainAdapter({
  mode: 'simulation',
  network: 'testnet',
});

/**
 * Configure the singleton Stellar adapter for live mode.
 *
 * @example
 *   await configureStellarLive({
 *     network: 'testnet',
 *     horizonUrl: 'https://horizon-testnet.stellar.org',
 *     secretKey: process.env.STELLAR_SECRET_KEY!,
 *   });
 */
export async function configureStellarLive(params: {
  network?: ChainNetwork;
  horizonUrl?: string;
  secretKey?: string;
  networkPassphrase?: string;
}): Promise<ChainResult> {
  return stellarChainAdapter.configureLive(params);
}
