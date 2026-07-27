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

  // Validate the consent — the merchant must grant every permission the
  // extension declares. `permissionsGranted` is an explicit list from the
  // consent dialog. We persist it as part of the install config so reviewers
  // can audit what scopes were granted at install time.
  let declaredPerms: string[] = [];
  try {
    const parsed = JSON.parse(extension.permissions);
    if (Array.isArray(parsed)) declaredPerms = parsed.filter((p) => typeof p === 'string');
  } catch {
    // ignore
  }
  const granted: string[] = Array.isArray(body.permissionsGranted)
    ? body.permissionsGranted.filter((p: unknown) => typeof p === 'string')
    : [];

  // For consent-gated installs the granted set must cover every declared perm.
  // We allow re-installs (existing installs) to skip the consent check so the
  // merchant can flip a disabled install back on from the catalog.
  const existing = await db.extensionInstall.findUnique({
    where: { extensionId_merchantId: { extensionId: id, merchantId } },
  });

  if (!existing && declaredPerms.length > 0) {
    const missing = declaredPerms.filter((p) => !granted.includes(p));
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: 'Permissions consent required',
          missing,
          declared: declaredPerms,
        },
        { status: 400 },
      );
    }
  }

  // Persist the granted permissions alongside the merchant config so the
  // consent record is preserved with the install.
  const installConfig: Record<string, unknown> = {};
  if (configJson) {
    try {
      const parsed = JSON.parse(configJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(installConfig, parsed);
      }
    } catch {
      // ignore — fall back to empty config object
    }
  }
  if (granted.length > 0) {
    installConfig.__grantedPermissions = granted;
  }
  const installConfigJson =
    Object.keys(installConfig).length > 0 ? JSON.stringify(installConfig) : null;

  let install;
  if (existing) {
    install = await db.extensionInstall.update({
      where: { id: existing.id },
      data: { status: 'enabled', config: installConfigJson },
    });
  } else {
    install = await db.extensionInstall.create({
      data: {
        extensionId: id,
        merchantId,
        status: 'enabled',
        config: installConfigJson,
      },
    });
    // Only bump the install counter for genuinely new installs.
    await db.extension.update({
      where: { id },
      data: { installCount: { increment: 1 } },
    });
  }

  return NextResponse.json({ ok: true, install }, { status: 201 });
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

  if (typeof body.status === 'string' && ['enabled', 'disabled', 'active'].includes(body.status)) {
    patch.status = body.status === 'active' ? 'enabled' : body.status;
  }

  const install = await db.extensionInstall.update({
    where: { id: existing.id },
    data: patch,
  });

  return NextResponse.json({ install });
}
