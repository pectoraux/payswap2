import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/extensions/install/[installId]/configure
 *
 * Update the per-merchant configuration for an installed extension. Body:
 *   { settings: object }
 *
 * Accepts either `settings` (preferred) or `config` (legacy alias).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ installId: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const { installId } = await params;
  const install = await db.extensionInstall.findUnique({
    where: { id: installId },
  });
  if (!install || install.merchantId !== merchantId) {
    return NextResponse.json(
      { ok: false, error: 'Install not found' },
      { status: 404 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const raw = body.settings ?? body.config;
  if (raw === undefined || raw === null || raw === '') {
    return NextResponse.json(
      { ok: false, error: 'settings is required' },
      { status: 400 },
    );
  }

  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { ok: false, error: 'settings must be a valid JSON object' },
        { status: 400 },
      );
    }
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
    return NextResponse.json(
      { ok: false, error: 'settings must be a JSON object' },
      { status: 400 },
    );
  }

  const updated = await db.extensionInstall.update({
    where: { id: installId },
    data: { config: JSON.stringify(parsed) },
  });

  return NextResponse.json({ ok: true, install: updated });
}
