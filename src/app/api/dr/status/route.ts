import { NextResponse } from 'next/server';
import { drStatusService } from '@/protocol/disaster-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/dr/status — disaster recovery status */
export async function GET() {
  return NextResponse.json(drStatusService.getStatus());
}
