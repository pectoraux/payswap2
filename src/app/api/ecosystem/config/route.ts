import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/extension-ecosystem';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const extensionId = sp.get('extensionId') ?? '';
  const tenantId = sp.get('tenantId') ?? 'default';
  return NextResponse.json({ config: config.get(extensionId, tenantId) });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const action = body.action as string;
  if (action === 'setConfig') {
    const cfg = config.set(body.extensionId as string, body.tenantId as string, body.values as Record<string, unknown>, body.featureFlags as Record<string, boolean>);
    return NextResponse.json({ config: cfg });
  }
  if (action === 'setSecret') {
    config.setSecret(body.extensionId as string, body.tenantId as string, body.key as string, body.value as string);
    return NextResponse.json({ ok: true, message: `✓ Secret "${body.key}" stored (AES-256-GCM encrypted)` });
  }
  if (action === 'getSecret') {
    const value = config.getSecret(body.extensionId as string, body.tenantId as string, body.key as string);
    return NextResponse.json({ hasValue: value !== null, message: value ? '✓ Secret retrieved' : 'Secret not found' });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
