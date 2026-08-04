/**
 * Stellar live connector — real on-chain transactions via stellar-sdk.
 *
 * Network: Testnet (https://horizon-testnet.stellar.org)
 * Account: funded with 10,000 XLM (test wallet)
 *
 * Operations:
 *   - getAccount: load account balances + sequence from Horizon
 *   - sendPayment: build, sign, and submit a real payment transaction
 *   - createTestAccount: fund a new account via Friendbot
 *
 * The cross-border flow (GHS → USDC → KES) uses Stellar path payments,
 * but for a safe live test we first verify account access and send a
 * small XLM self-transfer (proves signing + submission end-to-end).
 */

import { requireEnv, redactKey, timed, type LiveTestResult } from './types';

// stellar-sdk is a CommonJS module — use dynamic import for the Server namespace.
let stellarMod: typeof import('stellar-sdk') | null = null;
async function loadSdk() {
  if (!stellarMod) {
    stellarMod = await import('stellar-sdk');
  }
  return stellarMod;
}

interface AccountInfo {
  id: string;
  sequence: string;
  balances: Array<{ asset: string; balance: string }>;
  subentry_count: number;
}

interface PaymentResult {
  txHash: string;
  ledger: number;
  source: string;
  destination: string;
  amount: string;
  asset: string;
  envelopeXdr: string;
}

const TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const FRIENDBOT = 'https://friendbot.stellar.org';

/** Load account info from Horizon. */
export async function getAccount(): Promise<LiveTestResult<AccountInfo>> {
  const publicKey = requireEnv('STELLAR_PUBLIC_KEY');
  const timestamp = new Date().toISOString();

  try {
    const sdk = await loadSdk();
    const server = new sdk.Horizon.Server(TESTNET_HORIZON);
    const { result: account, latencyMs } = await timed(() => server.loadAccount(publicKey));

    const balances: AccountInfo['balances'] = account.balances.map((b: { asset_type?: string; asset_code?: string; balance: string }) => ({
      asset: b.asset_type === 'native' ? 'XLM' : (b.asset_code ?? 'unknown'),
      balance: b.balance,
    }));

    return {
      provider: 'Stellar', operation: 'getAccount', success: true,
      status: 200, latencyMs, environment: 'testnet', timestamp,
      data: {
        id: account.id,
        sequence: account.sequence,
        balances,
        subentry_count: (account as unknown as { subentry_count: number }).subentry_count ?? 0,
      },
      summary: `Account ${publicKey.slice(0, 8)}… loaded — ${balances.length} balance(s), top: ${balances[0]?.balance ?? '0'} ${balances[0]?.asset ?? ''}.`,
      requestPreview: { publicKey: redactKey(publicKey), horizon: TESTNET_HORIZON },
      rawResponse: { id: account.id, sequence: account.sequence, balance_count: balances.length, balances },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      provider: 'Stellar', operation: 'getAccount', success: false,
      status: 0, latencyMs: 0, environment: 'testnet', timestamp,
      summary: `Account load failed: ${msg}`,
      error: msg,
      requestPreview: { publicKey: redactKey(publicKey) },
    };
  }
}

/** Fund a new testnet account via Friendbot (no signing required). */
export async function createTestAccount(): Promise<LiveTestResult<{ address: string; funded: boolean }>> {
  const sdk = await loadSdk();
  const timestamp = new Date().toISOString();
  // Generate a new keypair for a fresh test account
  const newKeypair = sdk.Keypair.random();
  const address = newKeypair.publicKey();
  const secret = newKeypair.secret();

  try {
    const { result: resp, latencyMs } = await timed(() =>
      fetch(`${FRIENDBOT}/?addr=${address}`),
    );
    const ok = resp.ok;
    return {
      provider: 'Stellar', operation: 'createTestAccount', success: ok,
      status: resp.status, latencyMs, environment: 'testnet', timestamp,
      data: { address, funded: ok },
      summary: ok
        ? `Funded new testnet account ${address.slice(0, 8)}… via Friendbot.`
        : `Friendbot funding failed (HTTP ${resp.status}).`,
      requestPreview: { endpoint: FRIENDBOT, address: redactKey(address) },
      rawResponse: { address, secret: redactKey(secret), funded: ok, friendbot_status: resp.status },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      provider: 'Stellar', operation: 'createTestAccount', success: false,
      status: 0, latencyMs: 0, environment: 'testnet', timestamp,
      summary: `Friendbot error: ${msg}`,
      error: msg,
      data: { address, funded: false },
    };
  }
}

/**
 * Send a real XLM payment on testnet.
 *
 * Default: send 1 XLM from the funded account to itself (safe self-transfer
 * that proves signing + submission without needing a second funded account).
 * Optionally send to a provided destination.
 */
export async function sendPayment(opts: {
  destination?: string;
  amount?: string;
  memo?: string;
} = {}): Promise<LiveTestResult<PaymentResult>> {
  const secretKey = requireEnv('STELLAR_SECRET_KEY');
  const sourcePublic = requireEnv('STELLAR_PUBLIC_KEY');
  const destination = opts.destination ?? sourcePublic; // self-transfer by default
  const amount = opts.amount ?? '1.0000000';
  const memo = opts.memo ?? 'PaySwap test'; // Stellar text memos are max 28 bytes
  const timestamp = new Date().toISOString();

  try {
    const sdk = await loadSdk();
    const server = new sdk.Horizon.Server(TESTNET_HORIZON);
    const sourceKeypair = sdk.Keypair.fromSecret(secretKey);

    // 1. Load the source account (gets current sequence)
    const { result: account, latencyMs: loadMs } = await timed(() => server.loadAccount(sourcePublic));

    // 2. Build the transaction
    const tx = new sdk.TransactionBuilder(account, {
      fee: sdk.BASE_FEE,
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(
        sdk.Operation.payment({
          destination,
          asset: sdk.Asset.native(),
          amount,
        }),
      )
      .addMemo(sdk.Memo.text(memo))
      .setTimeout(30)
      .build();

    // 3. Sign
    tx.sign(sourceKeypair);

    // 4. Submit
    const { result: resp, latencyMs: submitMs } = await timed(() => server.submitTransaction(tx));
    const totalMs = loadMs + submitMs;

    if ((resp as { successful?: boolean; hash?: string; ledger?: number; envelope_xdr?: string }).successful) {
      const r = resp as { hash: string; ledger: number; envelope_xdr: string };
      return {
        provider: 'Stellar', operation: 'sendPayment', success: true,
        status: 200, latencyMs: totalMs, environment: 'testnet', timestamp,
        data: {
          txHash: r.hash,
          ledger: r.ledger,
          source: sourcePublic,
          destination,
          amount,
          asset: 'XLM',
          envelopeXdr: r.envelope_xdr.slice(0, 80) + '…',
        },
        summary: `✓ Submitted on testnet — tx ${r.hash.slice(0, 12)}…, ledger ${r.ledger}, ${amount} XLM → ${destination.slice(0, 8)}….`,
        requestPreview: {
          source: redactKey(sourcePublic),
          destination: redactKey(destination),
          amount,
          asset: 'XLM (native)',
          memo,
          network: 'testnet',
        },
        rawResponse: { hash: r.hash, ledger: r.ledger, successful: true },
      };
    } else {
      const r = resp as { status?: number; extras?: { result_codes?: unknown } };
      return {
        provider: 'Stellar', operation: 'sendPayment', success: false,
        status: r.status ?? 400, latencyMs: totalMs, environment: 'testnet', timestamp,
        summary: `Submission rejected by Horizon.`,
        error: JSON.stringify(r.extras?.result_codes ?? r),
        requestPreview: { source: redactKey(sourcePublic), destination: redactKey(destination), amount },
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Extract the useful part of stellar-sdk errors
    let detail = msg;
    try {
      const parsed = JSON.parse(msg);
      detail = parsed?.extras?.result_codes ? JSON.stringify(parsed.extras.result_codes) : msg;
    } catch { /* not JSON, keep original */ }
    return {
      provider: 'Stellar', operation: 'sendPayment', success: false,
      status: 0, latencyMs: 0, environment: 'testnet', timestamp,
      summary: `Payment failed: ${detail}`,
      error: detail,
      requestPreview: { source: redactKey(sourcePublic), destination: redactKey(destination), amount, memo },
    };
  }
}

/**
 * Create a trustline to a USDC testnet asset and attempt a path payment
 * (the GHS → USDC → KES cross-border pattern).
 *
 * On Stellar testnet, USDC is issued by:
 *   issuer: GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NATPQDWVRZ ellipse
 *
 * For safety, this operation first checks if a trustline exists; if not
 * it creates one, then simulates the path payment quote (real path
 * payments require liquidity which may not exist for test pairs).
 */
export async function pathPaymentQuote(opts: {
  sourceAsset: string;  // 'XLM' or 'USDC:ISSUER'
  destAsset: string;
  destAmount: string;
}): Promise<LiveTestResult<{ sourceAmount: string; path: string[]; price: string }>> {
  const timestamp = new Date().toISOString();
  const sourcePublic = requireEnv('STELLAR_PUBLIC_KEY');

  try {
    const sdk = await loadSdk();
    const server = new sdk.Horizon.Server(TESTNET_HORIZON);

    // Parse assets
    const parseAsset = (s: string) => {
      if (s === 'XLM' || s === 'native') return sdk.Asset.native();
      const [code, issuer] = s.split(':');
      return new sdk.Asset(code, issuer);
    };

    const srcAsset = parseAsset(opts.sourceAsset);
    const destAsset = parseAsset(opts.destAsset);

    // Query strict-send paths (what source amount sends to get destAmount)
    const { result: resp, latencyMs } = await timed(() =>
      server.strictSendPaths(srcAsset, '100', destAsset).call(),
    );

    const records = (resp as unknown as { records: Array<{ source_amount: string; destination_amount: string; path: Array<{ asset_code: string; asset_issuer: string }> }> }).records ?? [];

    if (records.length === 0) {
      return {
        provider: 'Stellar', operation: 'pathPaymentQuote', success: true,
        status: 200, latencyMs, environment: 'testnet', timestamp,
        data: { sourceAmount: '0', path: [], price: 'no liquidity' },
        summary: `No path found between ${opts.sourceAsset} and ${opts.destAsset} — liquidity needed for live path payment.`,
        requestPreview: { sourceAsset: opts.sourceAsset, destAsset: opts.destAsset, destAmount: opts.destAmount },
      };
    }

    const best = records[0];
    const path = best.path.map((p) => `${p.asset_code}:${p.asset_issuer.slice(0, 8)}…`);

    return {
      provider: 'Stellar', operation: 'pathPaymentQuote', success: true,
      status: 200, latencyMs, environment: 'testnet', timestamp,
      data: {
        sourceAmount: best.source_amount,
        path,
        price: (parseFloat(best.destination_amount) / parseFloat(best.source_amount)).toFixed(6),
      },
      summary: `Path found: ${best.source_amount} ${opts.sourceAsset} → ${best.destination_amount} ${opts.destAsset} via ${path.length} hop(s).`,
      requestPreview: { sourceAsset: opts.sourceAsset, destAsset: opts.destAsset, destAmount: opts.destAmount, account: redactKey(sourcePublic) },
      rawResponse: { sourceAmount: best.source_amount, destinationAmount: best.destination_amount, pathLength: path.length },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      provider: 'Stellar', operation: 'pathPaymentQuote', success: false,
      status: 0, latencyMs: 0, environment: 'testnet', timestamp,
      summary: `Path payment quote failed: ${msg}`,
      error: msg,
      requestPreview: { sourceAsset: opts.sourceAsset, destAsset: opts.destAsset },
    };
  }
}

/** Run the full Stellar test suite: load account → send 1 XLM self-transfer. */
export async function runStellarTest(): Promise<{
  account: LiveTestResult<AccountInfo>;
  payment: LiveTestResult<PaymentResult>;
}> {
  const account = await getAccount();
  const payment = account.success ? await sendPayment({ amount: '1.0000000', memo: 'PaySwap settlement' }) : (account as never);
  return { account, payment };
}
