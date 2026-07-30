import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { installExtension, type InstallOptions } from '@/extension-platform';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const userId = (session.user as { id?: string })?.id as string | undefined;
  const actorEmail = (session.user as { email?: string })?.email as string | undefined;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const pkg = body?.package;
  const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : 'default';
  const approvedPermissions = Array.isArray(body?.approvedPermissions) ? body.approvedPermissions : undefined;
  if (!pkg) return NextResponse.json({ error: 'package is required' }, { status: 400 });

  const opts: InstallOptions = { tenantId, approvedPermissions: approvedPermissions as InstallOptions['approvedPermissions'] };
  const result = installExtension(pkg as Parameters<typeof installExtension>[0], opts);

  try {
    await db.auditLog.create({
      data: { userId: userId ?? null, action: 'EXTENSION.INSTALL', resourceType: 'Extension', resourceId: result.extensionId, result: result.status === 'ACTIVE' ? 'SUCCESS' : 'ERROR',
        details: JSON.stringify({ extensionId: result.extensionId, version: result.version, status: result.status, ekgEntityId: result.ekgEntityId, durationMs: result.durationMs, actorEmail: actorEmail ?? null }) },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({
    extensionId: result.extensionId,
    version: result.version,
    status: result.status,
    ekgEntityId: result.ekgEntityId,
    durationMs: result.durationMs,
    log: result.log,
    error: result.error,
    message: result.status === 'ACTIVE'
      ? `✓ Extension ${result.extensionId}@${result.version} installed + registered in EKG — discoverable via resolve()`
      : `✗ Installation failed: ${result.error}`,
  }, { status: result.status === 'ACTIVE' ? 201 : 422 });
}
