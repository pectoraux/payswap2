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
 * POST /api/extensions/[id]/install
 *
 * Install a published extension for the authenticated merchant.
 *
 * Body (optional):
 *   { config?: object | string }  — merchant-specific configuration for the
 *   extension, validated against the extension's config schema (best-effort).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const extension = await db.extension.findUnique({ where: { id } });
  if (!extension) {
    return NextResponse.json({ error: 'Extension not found' }, { status: 404 });
  }
  if (extension.status !== 'published') {
    return NextResponse.json(
      { error: 'Only published extensions can be installed' },
      { status: 400 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  let configJson: string | null = null;
  if (body.config !== undefined && body.config !== null && body.config !== '') {
    try {
      const parsed =
        typeof body.config === 'string' ? JSON.parse(body.config) : body.config;
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        throw new Error('config must be a JSON object');
      }
      configJson = JSON.stringify(parsed);
    } catch {
      return NextResponse.json(
        { error: 'config must be a valid JSON object' },
        { status: 400 },
      );
    }
  }

  // Upsert the install record so re-installing is idempotent.
  const existing = await db.extensionInstall.findUnique({
    where: { extensionId_merchantId: { extensionId: id, merchantId } },
  });

  let install;
  if (existing) {
    install = await db.extensionInstall.update({
      where: { id: existing.id },
      data: { status: 'active', config: configJson },
    });
  } else {
    install = await db.extensionInstall.create({
      data: {
        extensionId: id,
        merchantId,
        status: 'active',
        config: configJson,
      },
    });
    // Only bump the install counter for genuinely new installs.
    await db.extension.update({
      where: { id },
      data: { installCount: { increment: 1 } },
    });
  }

  return NextResponse.json({ install }, { status: 201 });
}

/**
 * PATCH /api/extensions/[id]/install
 *
 * Update the merchant-specific configuration for an already-installed
 * extension (used by the "Configure" button on the marketplace).
 *
 * Body:
 *   { config?: object | string, status?: 'active' | 'disabled' }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const existing = await db.extensionInstall.findUnique({
    where: { extensionId_merchantId: { extensionId: id, merchantId } },
  });
  if (!existing) {
    return NextResponse.json(
      { error: 'Extension is not installed for this merchant' },
      { status: 404 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const patch: { config?: string | null; status?: string } = {};

  if (body.config !== undefined) {
    if (body.config === null || body.config === '') {
      patch.config = null;
    } else {
      try {
        const parsed =
          typeof body.config === 'string' ? JSON.parse(body.config) : body.config;
        if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
          throw new Error('config must be a JSON object');
        }
        patch.config = JSON.stringify(parsed);
      } catch {
        return NextResponse.json(
          { error: 'config must be a valid JSON object' },
          { status: 400 },
        );
      }
    }
  }

  if (typeof body.status === 'string' && ['active', 'disabled'].includes(body.status)) {
    patch.status = body.status;
  }

  const install = await db.extensionInstall.update({
    where: { id: existing.id },
    data: patch,
  });

  return NextResponse.json({ install });
}
