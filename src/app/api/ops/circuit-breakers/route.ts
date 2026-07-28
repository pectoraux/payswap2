import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { circuitBreakerRegistry } from '@/lib/circuit-breaker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  return NextResponse.json({
    ok: true,
    breakers: circuitBreakerRegistry.getAllStats(),
  });
}

export async function POST() {
  const session = await requireSession();
  if (!session) return unauthorized();

  circuitBreakerRegistry.resetAll();
  return NextResponse.json({ ok: true, message: 'All circuit breakers reset' });
}
