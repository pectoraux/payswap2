import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/extensions/install/[installId]/suspend
 *
 * Admin-only. Suspends an extension install at the platform level (e.g. as
 * part of an incident response). The merchant cannot re-enable it until an
 * admin lifts the suspension by setting it back to `enabled` via the
 * merchant-facing enable endpoint (which will refuse while the suspension
 * reason persists) — for this demo, the admin simply calls enable/disable
 * again to manage the suspension.
 *
 * Body (optional): { reason?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ installId: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  const { installId } = await params;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const reason =
    typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : null;

  const install = await db.extensionInstall.findUnique({
    where: { id: installId },
  });
  if (!install) {
    return NextResponse.json(
      { ok: false, error: 'Install not found' },
      { status: 404 },
    );
  }

  const updated = await db.extensionInstall.update({
    where: { id: installId },
    data: { status: 'suspended' },
  });

  return NextResponse.json({ ok: true, install: updated, reason });
}
