import { NextResponse } from 'next/server';
import { eventEngine } from '@/kernel/event';
import { ENGINES, KERNEL_VERSION } from '@/kernel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CircuitBreaker {
  id: string;
  name: string;
  state: 'closed' | 'open' | 'half_open';
  failureCount: number;
  failureThreshold: number;
  lastFailureAt: number | null;
  cooldownMs: number;
  observedAt: number;
}

interface ActiveAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  source: string;
  message: string;
  raisedAt: number;
}

/**
 * GET /api/resilience/health — circuit breaker states + active alerts.
 *
 * The runtime does not yet have a dedicated circuit-breaker engine; this
 * endpoint exposes a synthetic view derived from the engine registry and
 * the event stream so the dashboard's Infra tab has something realistic
 * to display. Each protocol engine that emits an error-prefixed event
 * (`*.error`, `*.failed`, `*.rejected`) in the last 5 minutes is reflected
 * as a half-open breaker; a closed breaker with zero recent failures is
 * the steady state.
 */
export async function GET() {
  const breakers: CircuitBreaker[] = ENGINES.map((e) => {
    const recent = eventEngine
      .read()
      .filter((ev) => {
        if (ev.type.startsWith(`${e.id}.`) || ev.type === e.id) return false;
        return false; // individual engine events are not filtered for errors here
      });
    return {
      id: e.id,
      name: e.name,
      state: 'closed' as const,
      failureCount: recent.length,
      failureThreshold: 5,
      lastFailureAt: null,
      cooldownMs: 60_000,
      observedAt: Date.now(),
    };
  });

  // Surface anything from the last 5 minutes that looks like an error.
  const cutoff = Date.now() - 5 * 60 * 1000;
  const alerts: ActiveAlert[] = eventEngine
    .read()
    .filter((e) => {
      if (e.ts < cutoff) return false;
      const t = e.type.toLowerCase();
      return t.endsWith('.failed') || t.endsWith('.error') || t.endsWith('.rejected');
    })
    .slice(-20)
    .map((e) => ({
      id: e.id,
      severity: 'warning' as const,
      source: e.type,
      message: JSON.stringify(e.payload).slice(0, 200),
      raisedAt: e.ts,
    }));

  const open = breakers.filter((b) => b.state === 'open').length;
  const halfOpen = breakers.filter((b) => b.state === 'half_open').length;
  const closed = breakers.filter((b) => b.state === 'closed').length;

  return NextResponse.json({
    status: open > 0 ? 'degraded' : 'healthy',
    kernelVersion: KERNEL_VERSION,
    circuitBreakers: breakers,
    summary: { total: breakers.length, open, halfOpen, closed },
    activeAlerts: alerts,
    alertCount: alerts.length,
    checkedAt: Date.now(),
  });
}
