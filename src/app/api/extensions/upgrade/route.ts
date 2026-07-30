import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { upgradeExtension } from '@/extension-platform';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const pkg = body?.package;
  const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : 'default';
  if (!pkg) return NextResponse.json({ error: 'package is required' }, { status: 400 });
  const result = upgradeExtension(pkg as Parameters<typeof upgradeExtension>[0], tenantId);
  return NextResponse.json({ ...result, message: result.status === 'ACTIVE' ? `✓ Upgraded to ${result.version}` : `✗ Upgrade failed: ${result.error}` }, { status: result.status === 'ACTIVE' ? 201 : 422 });
}
