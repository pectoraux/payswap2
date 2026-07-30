import { NextRequest, NextResponse } from 'next/server';
import { portal } from '@/extension-ecosystem';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const action = typeof body?.action === 'string' ? body.action : '';

  if (action === 'createOrg') {
    const org = portal.createOrganization(body.name as string, body.slug as string, body.description as string, (session.user as { id: string }).id, (session.user as { email?: string }).email ?? 'unknown');
    return NextResponse.json({ org, message: `✓ Organization "${org.name}" created` }, { status: 201 });
  }
  if (action === 'createPublisher') {
    const publisher = portal.createPublisher(body.orgId as string, body.name as string, body.slug as string, body.description as string);
    return NextResponse.json({ publisher, message: `✓ Publisher "${publisher.name}" created with signing key ${publisher.signingKeyIds[0]}` }, { status: 201 });
  }
  if (action === 'generateApiKey') {
    const { apiKey, fullKey } = portal.generateApiKey(body.orgId as string, body.name as string, body.scopes as string[]);
    return NextResponse.json({ apiKey, fullKey, message: `✓ API key created — save the full key, it won't be shown again` }, { status: 201 });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const view = sp.get('view') ?? 'orgs';
  if (view === 'orgs') return NextResponse.json({ organizations: portal.listOrganizations() });
  if (view === 'publishers') return NextResponse.json({ publishers: portal.listPublishers(sp.get('orgId') ?? '') });
  if (view === 'apiKeys') return NextResponse.json({ apiKeys: portal.listApiKeys(sp.get('orgId') ?? '') });
  if (view === 'signingCerts') return NextResponse.json({ signingCerts: portal.listSigningCerts(sp.get('orgId') ?? '') });
  return NextResponse.json({ error: 'Unknown view' }, { status: 400 });
}
