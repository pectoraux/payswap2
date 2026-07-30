import { NextRequest, NextResponse } from 'next/server';
import { rollbackExtension } from '@/extension-platform';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const extId = typeof body?.extensionId === 'string' ? body.extensionId : '';
  const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : 'default';
  if (!extId) return NextResponse.json({ error: 'extensionId is required' }, { status: 400 });
  const ok = rollbackExtension(extId, tenantId);
  return NextResponse.json({ success: ok, message: ok ? `✓ Rolled back to previous version` : '✗ No previous version to roll back to' }, { status: ok ? 200 : 409 });
}
