import { NextRequest, NextResponse } from 'next/server';
import { walletService } from '@/protocol/wallets/wallet-service';
import { stellarAdapter } from '@/protocol/blockchains/stellar/adapter';
import { blockchainRegistry } from '@/protocol/blockchains/adapter';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Register Stellar adapter
let stellarRegistered = false;
function initStellar() {
  if (stellarRegistered) return;
  blockchainRegistry.register(stellarAdapter);
  stellarRegistered = true;
}

/** POST /api/wallets — create account + wallet */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  initStellar();
  const body = await req.json();
  const { action } = body;

  if (action === 'create_account') {
    const account = walletService.createAccount({
      type: body.type ?? 'individual',
      name: body.name, email: body.email, phone: body.phone, country: body.country,
    });
    // Create default wallet
    const wallet = walletService.createWallet(account.id, body.currency ?? 'GHS');
    // Link Stellar account
    const stellarAddress = `G${account.id.toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(56, 'X')}`;
    const bcAccount = walletService.linkBlockchainAccount(account.id, 'stellar', stellarAddress);
    // Fund Stellar account with test XLM
    stellarAdapter.fundAccount(stellarAddress, 'TWIN' + (body.currency ?? 'GHS'), 1000000);
    return NextResponse.json({ account, wallet, blockchainAccount: bcAccount });
  }

  if (action === 'get_balance') {
    const wallet = walletService.getWallet(body.walletId);
    if (!wallet) return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });
    // Get on-chain balance from Stellar
    const stellarAccount = walletService.getBlockchainAccounts(wallet.accountId).find((b) => b.chain === 'stellar');
    if (stellarAccount) {
      const result = await stellarAdapter.getBalance({
        address: stellarAccount.address,
        assetCode: 'TWIN' + wallet.currency,
      });
      return NextResponse.json({ wallet, onChainBalance: result.balance, evidence: result.evidence ? 'verified' : null });
    }
    return NextResponse.json({ wallet, onChainBalance: null });
  }

  if (action === 'list_wallets') {
    const wallets = walletService.getWalletsByAccount(body.accountId);
    return NextResponse.json({ wallets });
  }

  if (action === 'transactions') {
    const txs = walletService.getTransactions(body.walletId);
    return NextResponse.json({ transactions: txs });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

/** GET /api/wallets — list accounts */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  initStellar();
  return NextResponse.json({ accounts: [] });
}
