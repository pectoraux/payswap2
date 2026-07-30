import { NextRequest, NextResponse } from 'next/server';
import { oauth } from '@/extension-ecosystem';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const action = body.action as string;
  if (action === 'register') {
    const cfg = oauth.registerProvider(body.extensionId as string, body.provider as never, body.clientId as string, body.clientSecret as string, body.scopes as string[], body.redirectUri as string);
    return NextResponse.json({ config: cfg, message: `✓ OAuth provider ${cfg.provider} registered` }, { status: 201 });
  }
  if (action === 'start') {
    const { authUrl, sessionId } = oauth.startFlow(body.extensionId as string, body.tenantId as string, body.provider as never);
    return NextResponse.json({ authUrl, sessionId });
  }
  if (action === 'callback') {
    const tokens = oauth.handleCallback(body.sessionId as string, body.code as string);
    return NextResponse.json({ tokens, message: '✓ OAuth flow completed — tokens stored encrypted' });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const tokens = oauth.getTokens(sp.get('extensionId') ?? '', sp.get('tenantId') ?? 'default', sp.get('provider') as never);
  return NextResponse.json({ tokens });
}
