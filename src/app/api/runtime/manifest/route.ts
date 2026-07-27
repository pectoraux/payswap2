/**
 * GET /api/runtime/manifest — kernel manifest. (M-RT-28.)
 *
 * The kernel manifest is the runtime's identity card.
 * Equivalent of a database schema version for the entire runtime.
 */

import { NextResponse } from 'next/server';
import { runtime, buildManifest } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const manifest = buildManifest(runtime);
    return NextResponse.json({ ok: true, ...manifest });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
