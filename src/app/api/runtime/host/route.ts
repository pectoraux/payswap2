/**
 * GET /api/runtime/host — dual-runtime status report. (M-RT-29.)
 *
 * Returns the status of both Sandbox and Live runtimes, including
 * isolation verification.
 */

import { NextResponse } from 'next/server';
import { runtimeHost } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const report = runtimeHost.getReport();
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}

/** POST: switch the active environment. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { environment } = body;
    if (environment !== 'sandbox' && environment !== 'live') {
      return NextResponse.json({ ok: false, error: 'environment must be "sandbox" or "live"' }, { status: 400 });
    }
    runtimeHost.switchEnvironment(environment);
    return NextResponse.json({ ok: true, activeEnvironment: runtimeHost.getActiveEnvironment() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
