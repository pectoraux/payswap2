import { NextRequest, NextResponse } from 'next/server';
import { snapshotStore, checkpointManager } from '@/protocol/persistence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/persistence/snapshots — list ledger snapshots */
export async function GET() {
  const [snapshots, count] = await Promise.all([
    snapshotStore.list(20),
    snapshotStore.count(),
  ]);
  return NextResponse.json({ snapshots, count });
}

/** POST /api/persistence/snapshots — take a checkpoint (flush + snapshot) */
export async function POST() {
  const result = await checkpointManager.checkpoint();
  return NextResponse.json(result);
}
