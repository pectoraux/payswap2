import { NextRequest, NextResponse } from 'next/server';
import { stellarAdapter } from '@/protocol/blockchains/stellar/adapter';
import { blockchainRegistry } from '@/protocol/blockchains/adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let stellarRegistered = false;
function initStellar() {
  if (stellarRegistered) return;
  blockchainRegistry.register(stellarAdapter);
  stellarRegistered = true;
}

/** GET /api/blockchain — list registered chains */
export async function GET() {
  initStellar();
  return NextResponse.json({
    chains: blockchainRegistry.chains(),
    adapters: blockchainRegistry.all().map((a) => ({ chain: a.chain, initialized: a.isInitialized })),
  });
}

/** POST /api/blockchain — execute blockchain operation */
export async function POST(req: NextRequest) {
  initStellar();
  const body = await req.json();
  const { operation, chain = 'stellar' } = body;

  const adapter = blockchainRegistry.get(chain);
  if (!adapter) return NextResponse.json({ error: `Chain ${chain} not registered` }, { status: 400 });

  switch (operation) {
    case 'issue_asset': {
      const result = await adapter.issueAsset(body);
      return NextResponse.json(result);
    }
    case 'burn_asset': {
      const result = await adapter.burnAsset(body);
      return NextResponse.json(result);
    }
    case 'transfer': {
      const result = await adapter.transfer(body);
      return NextResponse.json(result);
    }
    case 'verify': {
      const result = await adapter.verify(body);
      return NextResponse.json(result);
    }
    case 'get_balance': {
      const result = await adapter.getBalance(body);
      return NextResponse.json(result);
    }
    case 'create_escrow': {
      const result = await adapter.createEscrow(body);
      return NextResponse.json(result);
    }
    case 'health_check': {
      const result = await adapter.healthCheck();
      return NextResponse.json({ chain, ...result });
    }
    default:
      return NextResponse.json({ error: `Unknown operation: ${operation}` }, { status: 400 });
  }
}
