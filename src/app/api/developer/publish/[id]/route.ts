import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  unauthorized,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import {
  parseMarketplaceMeta,
  serializeMarketplaceMeta,
  type MarketplaceMeta,
  type PricingPlan,
} from '@/marketplace';
import type { PluginManifest, Permission } from '@/sdk/types';
import { pluginVerifier } from '@/marketplace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

/**
 * GET /api/developer/publish/[id]
 *
 * Get a single marketplace plugin owned by the developer (any status).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id' }, { status: 400 });
  }

  try {
    const row = await db.extension.findUnique({ where: { id } });
    if (!row || row.developerId !== userId) {
      return NextResponse.json(
        { ok: false, error: 'Plugin not found' },
        { status: 404 },
      );
    }
    const meta = parseMarketplaceMeta(row.config);
    return NextResponse.json({
      ok: true,
      plugin: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        category: row.category,
        iconUrl: row.iconUrl,
        version: row.version,
        status: row.status,
        longDescription: meta.longDescription ?? '',
        manifest: meta.manifest ?? null,
        capabilities: meta.capabilities ?? [],
        permissions: meta.permissions ?? [],
        pricing: meta.pricing ?? { model: 'free', summary: 'Free' },
        documentationUrl: meta.documentationUrl ?? '',
        supportUrl: meta.supportUrl ?? '',
        privacyUrl: meta.privacyUrl ?? '',
        termsUrl: meta.termsUrl ?? '',
        screenshots: meta.screenshots ?? [],
        tags: meta.tags ?? [],
        dependencies: meta.dependencies ?? [],
        developerBio: meta.developerBio ?? '',
        verification: meta.verification ?? null,
        reviewNotes: row.reviewNotes,
        submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
        reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('[api/developer/publish/[id] GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/developer/publish/[id]
 *
 * Update a marketplace plugin (only when in draft/rejected status).
 *
 * Body: any subset of the fields accepted by POST /api/developer/publish.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id' }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const row = await db.extension.findUnique({ where: { id } });
    if (!row || row.developerId !== userId) {
      return NextResponse.json(
        { ok: false, error: 'Plugin not found' },
        { status: 404 },
      );
    }
    // Only allow edits when in draft or rejected status.
    if (!['draft', 'rejected'].includes(row.status)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Cannot edit a plugin in status "${row.status}". Withdraw it first.`,
        },
        { status: 400 },
      );
    }

    const meta = parseMarketplaceMeta(row.config);

    // Apply patches.
    if (isString(body.name) && body.name.trim()) {
      row.name = body.name.trim();
    }
    if (isString(body.description) && body.description.trim()) {
      row.description = body.description.trim();
    }
    if (isString(body.category) && body.category.trim()) {
      row.category = body.category.trim();
    }
    if (isString(body.iconUrl)) {
      row.iconUrl = body.iconUrl.trim() || null;
    }
    if (isString(body.version) && body.version.trim()) {
      row.version = body.version.trim();
    }
    if (isString(body.longDescription)) {
      meta.longDescription = body.longDescription.trim() || undefined;
    }
    if (isString(body.documentationUrl)) {
      meta.documentationUrl = body.documentationUrl.trim() || undefined;
    }
    if (isString(body.supportUrl)) {
      meta.supportUrl = body.supportUrl.trim() || undefined;
    }
    if (isString(body.privacyUrl)) {
      meta.privacyUrl = body.privacyUrl.trim() || undefined;
    }
    if (isString(body.termsUrl)) {
      meta.termsUrl = body.termsUrl.trim() || undefined;
    }
    if (isString(body.developerBio)) {
      meta.developerBio = body.developerBio.trim() || undefined;
    }
    if (body.manifest !== undefined) {
      meta.manifest = body.manifest as PluginManifest;
      // Sync capabilities + permissions from manifest.
      if (meta.manifest) {
        meta.capabilities = meta.manifest.capabilities;
        meta.permissions = meta.manifest.permissions as Permission[];
      }
    }
    if (Array.isArray(body.capabilities)) {
      meta.capabilities = body.capabilities;
    }
    if (Array.isArray(body.permissions)) {
      meta.permissions = body.permissions as Permission[];
      row.permissions = JSON.stringify(body.permissions);
    }
    if (body.pricing !== undefined) {
      const pricing = body.pricing as PricingPlan;
      if (!['free', 'one-time', 'subscription', 'usage-based'].includes(pricing.model)) {
        return NextResponse.json(
          { ok: false, error: 'Invalid pricing model' },
          { status: 400 },
        );
      }
      meta.pricing = pricing;
      row.pricing = pricing.model === 'free' ? 'free' : 'paid';
      row.price = (pricing.price ?? 0) as any;
    }
    if (Array.isArray(body.screenshots)) {
      meta.screenshots = body.screenshots.filter(
        (s: any) => s && typeof s.url === 'string' && typeof s.caption === 'string',
      );
    }
    if (Array.isArray(body.tags)) {
      meta.tags = body.tags.filter(isString);
    }
    if (Array.isArray(body.dependencies)) {
      meta.dependencies = body.dependencies.filter(
        (d: any) => d && typeof d.slug === 'string',
      );
    }

    // Re-run verification if manifest changed.
    if (body.manifest !== undefined && meta.manifest) {
      try {
        meta.verification = await pluginVerifier.verify(meta.manifest);
      } catch (err) {
        console.error('[api/developer/publish/[id] PATCH] verify failed:', err);
      }
    }

    // Append changelog entry when version changed.
    if (body.version && body.version.trim() && body.version.trim() !== row.version) {
      const oldChangelog = JSON.parse(row.changelog ?? '[]');
      oldChangelog.unshift({
        version: body.version.trim(),
        date: new Date().toISOString(),
        changes: body.changelogNote ?? `Updated to ${body.version.trim()}`,
      });
      row.changelog = JSON.stringify(oldChangelog);
    }

    const updated = await db.extension.update({
      where: { id },
      data: {
        name: row.name,
        description: row.description,
        category: row.category,
        iconUrl: row.iconUrl,
        version: row.version,
        permissions: row.permissions,
        pricing: row.pricing,
        price: row.price,
        config: serializeMarketplaceMeta(meta),
        changelog: row.changelog,
      },
    });

    return NextResponse.json({ ok: true, plugin: updated });
  } catch (err) {
    console.error('[api/developer/publish/[id] PATCH] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/developer/publish/[id]
 *
 * Delete a draft plugin. Only allowed when the plugin has never been
 * submitted (status = draft).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id' }, { status: 400 });
  }

  try {
    const row = await db.extension.findUnique({ where: { id } });
    if (!row || row.developerId !== userId) {
      return NextResponse.json(
        { ok: false, error: 'Plugin not found' },
        { status: 404 },
      );
    }
    if (row.status !== 'draft') {
      return NextResponse.json(
        {
          ok: false,
          error: `Cannot delete a plugin in status "${row.status}". Archive it instead.`,
        },
        { status: 400 },
      );
    }
    await db.extension.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/developer/publish/[id] DELETE] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
