import { NextResponse } from 'next/server';
import { deadLetterQueue } from '@/protocol/resilience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/resilience/dlq — list dead-letter queue entries */
export async function GET() {
  return NextResponse.json({ entries: deadLetterQueue.list(), count: deadLetterQueue.list().length });
}
