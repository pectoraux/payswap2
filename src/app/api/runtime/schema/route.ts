/**
 * GET /api/runtime/schema — schema registry report. (M-RT-27.)
 *
 * Returns the full schema report: event types, versions, upcasters,
 * projection compatibility.
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const report = runtime.schema.getReport();
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
