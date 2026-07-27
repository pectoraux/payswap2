/**
 * GET /api/runtime/control-plane — economic control plane report.
 * (M-ECO-34.5.)
 *
 * Returns the complete control plane report:
 *   - Economic Constitution validation
 *   - Liquidity Digital Twin (all countries)
 *   - Capital Allocation recommendations
 *   - Inventory Management recommendations
 *   - Reserve Evolution plans
 *   - Network Optimization
 *   - Governance Queue (approval classifications)
 *   - Economic Explanations
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const report = runtime.controlPlane.getReport();
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
