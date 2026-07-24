import { NextResponse } from 'next/server';
import { healthCheck } from '@/protocol/resilience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/resilience/health — resilience subsystem health */
export async function GET() {
  return NextResponse.json(healthCheck());
}
