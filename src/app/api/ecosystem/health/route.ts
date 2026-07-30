import { NextRequest, NextResponse } from 'next/server';
import { observability } from '@/extension-ecosystem';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const extensionId = sp.get('extensionId') ?? '';
  const tenantId = sp.get('tenantId') ?? 'default';
  const view = sp.get('view') ?? 'health';
  if (view === 'metrics') return NextResponse.json({ metrics: observability.getMetrics(extensionId, tenantId) });
  if (view === 'logs') return NextResponse.json({ logs: observability.getLogs(extensionId, tenantId, Number(sp.get('limit') ?? 100)) });
  return NextResponse.json({ health: observability.getHealth(extensionId, tenantId) });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const action = body.action as string;
  if (action === 'recordHealth') {
    const record = observability.recordHealth(body.extensionId as string, body.tenantId as string, body.healthy as boolean, body.checks as never);
    return NextResponse.json({ record });
  }
  if (action === 'recordMetrics') {
    const record = observability.recordMetrics(body.extensionId as string, body.tenantId as string, body.metrics as never);
    return NextResponse.json({ record });
  }
  if (action === 'log') {
    observability.log(body.extensionId as string, body.tenantId as string, body.level as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', body.message as string, body.meta as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
