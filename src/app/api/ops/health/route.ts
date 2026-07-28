import { NextResponse } from 'next/server';
import { ENGINES, RUNTIME_SERVICES, KERNEL_VERSION } from '@/kernel';
import { eventEngine } from '@/kernel/event';
import { twinTokenEngine } from '@/protocol/twin-token/engine';
import { merchantPlatform } from '@/protocol/merchant/platform';
import { payoutService } from '@/protocol/payouts/payout-service';
import { webhookEngine } from '@/protocol/webhooks/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/ops/health — overall runtime health snapshot.
 *
 * TODO(HARDEN): This is one of 6 overlapping health/overview endpoints per
 * the HARDEN-1 audit:
 *   - `/api/ops/health`              (THIS — canonical runtime health)
 *   - `/api/ops/sre/health-check`    (SRE deep-check incl. connectors-v2)
 *   - `/api/resilience/health`       (circuit-breaker-specific — keep)
 *   - `/api/protocol/health`         (protocol-level — fold in or remove)
 *   - `/api/ops/overview`            (ops rollup — fold into THIS)
 *   - `/api/developer/overview`      (role-scoped developer — keep)
 * Consolidate to 3 canonical: THIS (runtime), `/api/resilience/health`
 * (circuit breakers), `/api/developer/overview` (developer-scoped). Tracked
 * by HARDEN-1 audit (priority fix #8).
 */
export async function GET() {
  const engines = ENGINES;
  const online = engines.filter((e) => e.status === 'online').length;
  const degraded = engines.filter((e) => e.status === 'degraded').length;
  const offline = engines.filter((e) => e.status === 'offline').length;
  const events = eventEngine.read().length;
  const assets = twinTokenEngine.allAssets();
  const supply = assets.reduce((s, a) => s + a.totalSupply, 0);
  const merchants = merchantPlatform.allMerchants().length;
  const payouts = payoutService.list().length;
  const endpoints = webhookEngine.allEndpoints().length;
  return NextResponse.json({
    status: offline > 0 ? 'offline' : degraded > 0 ? 'degraded' : 'online',
    kernelVersion: KERNEL_VERSION,
    uptimeMs: process.uptime ? process.uptime() * 1000 : 0,
    engineSummary: { total: engines.length, online, degraded, offline },
    services: RUNTIME_SERVICES,
    counts: { events, twinAssets: assets.length, twinSupply: supply, merchants, payouts, webhookEndpoints: endpoints },
    checkedAt: Date.now(),
  });
}
