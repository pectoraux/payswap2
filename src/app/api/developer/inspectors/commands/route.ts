/**
 * GET /api/developer/inspectors/commands
 *
 * Reads the runtime command registry (payswapRuntime.commands) and returns each
 * registered command type with its description + schema (derived from the
 * built-in payload interfaces in src/runtime/dispatcher/types.ts).
 *
 * Query params:
 *   - recent=true: also return recent command invocations (last N events of
 *     kind 'runtime' with type starting 'command.'). The runtime doesn't
 *     currently log commands separately, so we approximate by reading
 *     recent domain events and grouping by their streamType.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { runtime as payswapRuntime } from '@/runtime';
import type { CommandHandler } from '@/runtime/dispatcher/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Static schema definitions — derived from the TypeScript payload interfaces
// in src/runtime/dispatcher/types.ts. The runtime doesn't expose JSON schema,
// so we hand-curate the field list here (kept in sync with the types file).
const PAYLOAD_SCHEMAS: Record<string, Array<{ field: string; type: string; required: boolean; description: string }>> = {
  'payment.create': [
    { field: 'merchantId', type: 'string', required: true, description: 'Owning merchant' },
    { field: 'customerId', type: 'string', required: false, description: 'Optional customer' },
    { field: 'amount', type: 'number', required: true, description: 'Amount in minor units or major (per currency)' },
    { field: 'currency', type: 'string', required: true, description: 'ISO 4217 currency code' },
    { field: 'sourceCurrency', type: 'string', required: false, description: 'Customer-facing currency' },
    { field: 'destinationCurrency', type: 'string', required: false, description: 'Merchant-facing currency' },
    { field: 'method', type: 'string', required: false, description: 'Payment method (card, mobile_money, etc.)' },
    { field: 'corridor', type: 'string', required: false, description: 'Corridor key (e.g. "GH-KE")' },
    { field: 'description', type: 'string', required: false, description: 'Human-readable description' },
    { field: 'reference', type: 'string', required: false, description: 'Idempotency / external reference' },
  ],
  'payment.capture': [
    { field: 'paymentId', type: 'string', required: true, description: 'The payment to capture' },
    { field: 'lpId', type: 'string', required: false, description: 'Optional LP to assign' },
  ],
  'refund.create': [
    { field: 'paymentId', type: 'string', required: true, description: 'Original payment' },
    { field: 'merchantId', type: 'string', required: true, description: 'Owning merchant' },
    { field: 'amount', type: 'number', required: true, description: 'Amount to refund' },
    { field: 'type', type: '"FULL" | "PARTIAL"', required: true, description: 'Refund type' },
    { field: 'reason', type: 'string', required: false, description: 'Reason for the refund' },
    { field: 'requestedBy', type: 'string', required: true, description: 'Actor requesting the refund' },
  ],
  'refund.execute': [
    { field: 'refundId', type: 'string', required: true, description: 'Refund to execute (must be APPROVED)' },
  ],
  'payout.create': [
    { field: 'merchantId', type: 'string', required: true, description: 'Owning merchant' },
    { field: 'method', type: 'string', required: true, description: 'Payout rail (bank, mobile_money, etc.)' },
    { field: 'sourceAmount', type: 'number', required: true, description: 'Source amount' },
    { field: 'sourceAsset', type: 'string', required: true, description: 'Source asset code' },
    { field: 'sourceCurrency', type: 'string', required: true, description: 'Source currency' },
    { field: 'destinationCurrency', type: 'string', required: true, description: 'Destination currency' },
    { field: 'destination', type: 'string', required: false, description: 'Recipient account / wallet' },
    { field: 'reason', type: 'string', required: false, description: 'Payout reason / memo' },
  ],
  'invoice.create': [
    { field: 'merchantId', type: 'string', required: true, description: 'Owning merchant' },
    { field: 'customerId', type: 'string', required: false, description: 'Customer being billed' },
    { field: 'amount', type: 'number', required: true, description: 'Invoice total' },
    { field: 'currency', type: 'string', required: true, description: 'ISO 4217 currency code' },
    { field: 'dueDate', type: 'number', required: false, description: 'Epoch ms due date' },
    { field: 'items', type: 'array<{ description: string; quantity: number; unitPrice: number }>', required: false, description: 'Line items' },
  ],
  'reserve.lock': [
    { field: 'reserveId', type: 'string', required: true, description: 'Reserve to lock' },
    { field: 'amount', type: 'number', required: true, description: 'Amount to lock' },
    { field: 'reason', type: 'string', required: true, description: 'Why this lock was placed' },
  ],
  'reserve.release': [
    { field: 'reserveId', type: 'string', required: true, description: 'Reserve to release' },
    { field: 'amount', type: 'number', required: true, description: 'Amount to release' },
    { field: 'reason', type: 'string', required: true, description: 'Why this release was placed' },
  ],
  'wallet.credit': [
    { field: 'walletId', type: 'string', required: true, description: 'Wallet to credit' },
    { field: 'amount', type: 'number', required: true, description: 'Credit amount' },
    { field: 'currency', type: 'string', required: true, description: 'Currency code' },
    { field: 'reason', type: 'string', required: true, description: 'Credit reason' },
    { field: 'counterparty', type: 'string', required: false, description: 'Counterparty account' },
    { field: 'reference', type: 'string', required: false, description: 'External reference' },
  ],
  'wallet.debit': [
    { field: 'walletId', type: 'string', required: true, description: 'Wallet to debit' },
    { field: 'amount', type: 'number', required: true, description: 'Debit amount' },
    { field: 'currency', type: 'string', required: true, description: 'Currency code' },
    { field: 'reason', type: 'string', required: true, description: 'Debit reason' },
    { field: 'counterparty', type: 'string', required: false, description: 'Counterparty account' },
    { field: 'reference', type: 'string', required: false, description: 'External reference' },
  ],
  'wallet.reserve': [
    { field: 'walletId', type: 'string', required: true, description: 'Wallet to reserve from' },
    { field: 'amount', type: 'number', required: true, description: 'Amount to reserve' },
    { field: 'currency', type: 'string', required: true, description: 'Currency code' },
    { field: 'reason', type: 'string', required: true, description: 'Reservation reason' },
    { field: 'operationId', type: 'string', required: true, description: 'Operation to reserve for' },
  ],
  'wallet.release': [
    { field: 'walletId', type: 'string', required: true, description: 'Wallet to release from' },
    { field: 'amount', type: 'number', required: true, description: 'Amount to release' },
    { field: 'currency', type: 'string', required: true, description: 'Currency code' },
    { field: 'reason', type: 'string', required: true, description: 'Release reason' },
    { field: 'operationId', type: 'string', required: true, description: 'Operation that owns the reservation' },
  ],
};

// Group commands by category for the sidebar.
function categorize(commandType: string): string {
  if (commandType.startsWith('payment.')) return 'Payments';
  if (commandType.startsWith('refund.')) return 'Refunds';
  if (commandType.startsWith('payout.')) return 'Payouts';
  if (commandType.startsWith('invoice.')) return 'Invoices';
  if (commandType.startsWith('reserve.')) return 'Treasury / Reserves';
  if (commandType.startsWith('wallet.')) return 'Wallets';
  return 'Other';
}

// The event types each command produces (for the "Events emitted" sidebar entry).
const COMMAND_EVENTS: Record<string, string[]> = {
  'payment.create': ['payment.recorded'],
  'payment.capture': ['payment.captured', 'payment.settled'],
  'refund.create': ['refund.requested'],
  'refund.execute': ['refund.executed'],
  'payout.create': ['payout.requested'],
  'invoice.create': ['invoice.issued'],
  'reserve.lock': ['reserve.locked'],
  'reserve.release': ['reserve.released'],
  'wallet.credit': ['wallet.credited', 'treasury.account.credited'],
  'wallet.debit': ['wallet.debited', 'treasury.account.debited'],
  'wallet.reserve': ['wallet.reserved', 'treasury.position.opened'],
  'wallet.release': ['wallet.released', 'treasury.position.closed'],
};

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const wantRecent = sp.get('recent') === 'true';

  try {
    const types = payswapRuntime.commands.types();
    const handlers: Array<{
      commandType: string;
      description: string;
      category: string;
      schema: Array<{ field: string; type: string; required: boolean; description: string }>;
      eventsEmitted: string[];
    }> = [];

    for (const t of types) {
      const handler = payswapRuntime.commands.get(t) as (CommandHandler | null);
      handlers.push({
        commandType: t,
        description: handler?.description ?? 'No description registered.',
        category: categorize(t),
        schema: PAYLOAD_SCHEMAS[t] ?? [],
        eventsEmitted: COMMAND_EVENTS[t] ?? [],
      });
    }

    // Group by category.
    const byCategory: Record<string, typeof handlers> = {};
    for (const h of handlers) {
      if (!byCategory[h.category]) byCategory[h.category] = [];
      byCategory[h.category].push(h);
    }

    // Recent invocations — approximate by reading the last 100 events and
    // grouping by stream type (each command produces events on a stream of
    // that type). This gives a coarse view of what commands have been
    // dispatched recently.
    let recent: Array<{
      timestamp: number;
      streamId: string;
      streamType: string;
      eventType: string;
      actor: string;
      environment: string;
      seq: number;
    }> = [];
    if (wantRecent) {
      const total = payswapRuntime.eventStore.size();
      const evs = await payswapRuntime.eventStore.readAll(Math.max(0, total - 100), 100);
      recent = evs
        .filter((e) => e.kind === 'domain')
        .map((e) => ({
          timestamp: e.metadata.timestamp,
          streamId: e.streamId,
          streamType: e.streamType,
          eventType: e.type,
          actor: e.metadata.actor,
          environment: e.metadata.environment,
          seq: e.globalPosition,
        }))
        .reverse();
    }

    return NextResponse.json({
      ok: true,
      totalCommands: handlers.length,
      categories: Object.keys(byCategory).sort(),
      handlers,
      byCategory,
      recent,
    });
  } catch (err) {
    console.error('[api/developer/inspectors/commands] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
