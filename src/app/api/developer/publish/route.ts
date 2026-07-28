import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  unauthorized,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import {
  MARKETPLACE_CATEGORIES,
  parseMarketplaceMeta,
  serializeMarketplaceMeta,
  pluginVerifier,
  type MarketplaceMeta,
  type MarketplaceCategory,
  type PricingPlan,
  type VerificationResult,
} from '@/marketplace';
import type { PluginManifest, Permission } from '@/sdk/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = new Set<string>(MARKETPLACE_CATEGORIES);

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

/**
 * GET /api/developer/publish
 *
 * List the developer's marketplace plugins (any status).
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id' }, { status: 400 });
  }

  try {
    const rows = await db.extension.findMany({
      where: { developerId: userId },
      orderBy: { updatedAt: 'desc' },
    });
    // Filter to marketplace plugins only.
    const marketplaceRows = rows.filter((r) => {
      const meta = parseMarketplaceMeta(r.config);
      return meta.marketplace === true;
    });
    return NextResponse.json({
      ok: true,
      plugins: marketplaceRows.map((r) => {
        const meta = parseMarketplaceMeta(r.config);
        return {
          id: r.id,
          slug: r.slug,
          name: r.name,
          description: r.description,
          category: r.category,
          iconUrl: r.iconUrl,
          version: r.version,
          status: r.status,
          pricing: meta.pricing ?? { model: 'free', summary: 'Free' },
          capabilities: meta.capabilities ?? [],
          permissions: meta.permissions ?? [],
          tags: meta.tags ?? [],
          verification: meta.verification ?? null,
          installCount: r.installCount,
          rating: r.rating,
          reviewCount: r.reviewCount,
          submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
          publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
    });
  } catch (err) {
    console.error('[api/developer/publish GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/developer/publish
 *
 * Create a new marketplace plugin (draft). Body:
 *   { name, description, category, longDescription?, iconUrl?, version?,
 *     manifest?: PluginManifest, capabilities?, permissions?, pricing?, tags?,
 *     documentationUrl?, screenshots?, dependencies? }
 *
 * The manifest is validated by the PluginVerifier before persisting. If
 * validation fails, the plugin is still created (in 'draft' status) but the
 * verification result is stored so the developer can see what to fix.
 */
export async function POST(req: NextRequest) {
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

  const name = isString(body.name) ? body.name.trim() : '';
  const description = isString(body.description) ? body.description.trim() : '';
  const category = isString(body.category) ? body.category.toLowerCase().trim() : '';
  const longDescription = isString(body.longDescription) ? body.longDescription.trim() : '';
  const version = isString(body.version) && body.version.trim() ? body.version.trim() : '1.0.0';
  const iconUrl = isString(body.iconUrl) && body.iconUrl.trim() ? body.iconUrl.trim() : null;
  const documentationUrl = isString(body.documentationUrl) ? body.documentationUrl.trim() : '';
  const tags = Array.isArray(body.tags) ? body.tags.filter(isString) : [];

  if (!name || name.length < 2) {
    return NextResponse.json({ ok: false, error: 'Name must be at least 2 characters' }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ ok: false, error: 'Name must be 80 characters or fewer' }, { status: 400 });
  }
  if (!description || description.length < 10) {
    return NextResponse.json({ ok: false, error: 'Description must be at least 10 characters' }, { status: 400 });
  }
  if (!VALID_CATEGORIES.has(category)) {
    return NextResponse.json(
      { ok: false, error: `Invalid category. Must be one of: ${MARKETPLACE_CATEGORIES.join(', ')}` },
      { status: 400 },
    );
  }

  // Build the manifest from the body (or accept a pre-built one).
  const manifest: PluginManifest | undefined = body.manifest
    ? (body.manifest as PluginManifest)
    : undefined;

  // Capabilities + permissions (may come from manifest or top-level body).
  const capabilities = Array.isArray(body.capabilities)
    ? body.capabilities
    : manifest?.capabilities ?? [];
  const permissions = Array.isArray(body.permissions)
    ? body.permissions
    : manifest?.permissions ?? [];

  // Pricing plan.
  const pricing: PricingPlan = body.pricing ?? { model: 'free', summary: 'Free' };
  if (!['free', 'one-time', 'subscription', 'usage-based'].includes(pricing.model)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid pricing model' },
      { status: 400 },
    );
  }

  // Screenshots.
  const screenshots = Array.isArray(body.screenshots)
    ? body.screenshots.filter(
        (s: any) => s && typeof s.url === 'string' && typeof s.caption === 'string',
      )
    : [];

  // Dependencies.
  const dependencies = Array.isArray(body.dependencies)
    ? body.dependencies.filter(
        (d: any) => d && typeof d.slug === 'string',
      )
    : [];

  // Verify the manifest (if provided).
  let verification: VerificationResult | undefined;
  if (manifest) {
    try {
      verification = await pluginVerifier.verify(manifest);
    } catch (err) {
      console.error('[api/developer/publish POST] verify failed:', err);
    }
  }

  // Build the marketplace meta.
  const meta: MarketplaceMeta = {
    marketplace: true,
    longDescription: longDescription || undefined,
    manifest,
    capabilities,
    permissions: permissions as Permission[],
    pricing,
    documentationUrl: documentationUrl || undefined,
    screenshots,
    tags,
    dependencies,
    verification,
  };

  try {
    // Generate a unique slug.
    const slug = await generateUniqueSlug(name);
    const extension = await db.extension.create({
      data: {
        slug,
        name,
        description,
        developerId: userId,
        category: category as MarketplaceCategory,
        iconUrl,
        version,
        status: 'draft',
        permissions: JSON.stringify(permissions),
        pricing: pricing.model === 'free' ? 'free' : 'paid',
        price: pricing.price ?? 0,
        config: serializeMarketplaceMeta(meta),
        changelog: JSON.stringify([
          { version, date: new Date().toISOString(), changes: 'Initial draft' },
        ]),
      },
    });
    return NextResponse.json({ ok: true, plugin: extension }, { status: 201 });
  } catch (err) {
    console.error('[api/developer/publish POST] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

async function generateUniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'plugin';
  let slug = base;
  let attempt = 1;
  while (await db.extension.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${base}-${attempt}`;
    attempt += 1;
    if (attempt > 50) {
      slug = `${base}-${Date.now().toString(36)}`;
      break;
    }
  }
  return slug;
}
