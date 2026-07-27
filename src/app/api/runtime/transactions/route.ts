/**
 * GET /api/runtime/transactions — list recent transactions (for the inspector).
 * POST /api/runtime/transactions — execute a command via the Transaction Coordinator.
 * (M-RT-26.)
 */

import { NextResponse } from 'next/server';
import { runtime, type RuntimeCommand } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const recent = runtime.coordinator.getRecentTransactions();
    return NextResponse.json({
      ok: true,
      total: recent.length,
      committed: recent.filter((t) => t.status === 'committed').length,
      rolledBack: recent.filter((t) => t.status === 'rolled_back').length,
      transactions: recent,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { type, payload, metadata } = body;
    if (!type || !payload || !metadata) {
      return NextResponse.json({ ok: false, error: 'Required: { type, payload, metadata }' }, { status: 400 });
    }
    const command: RuntimeCommand = { type, payload, metadata };
    const result = await runtime.coordinator.execute(command);
    return NextResponse.json({ ok: result.success, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
