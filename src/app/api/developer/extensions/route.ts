import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = new Set([
  'payments',
  'analytics',
  'compliance',
  'accounting',
  'crm',
  'marketing',
  'shipping',
  'other',
]);

const VALID_PRICING = new Set(['free', 'paid', 'freemium']);

const VALID_PERMISSIONS = new Set([
  'read_payments',
  'write_payments',
  'read_customers',
  'write_customers',
  'send_webhooks',
]);

function safeJson<T = unknown>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function generateUniqueSlug(name: string, ignoreId?: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'extension';
  let slug = base;
  let attempt = 1;
  while (
    await db.extension.findFirst({
      where: { slug, ...(ignoreId ? { NOT: { id: ignoreId } } : {}) },
      select: { id: true },
    })
  ) {
    slug = `${base}-${attempt}`;
    attempt += 1;
    if (attempt > 50) {
      slug = `${base}-${Date.now().toString(36)}`;
      break;
    }
  }
  return slug;
}

/**
 * GET /api/developer/extensions
 *
 * List the developer's extensions (all statuses).
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  try {
    const rows = await db.extension.findMany({
      where: { developerId: userId },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({
      ok: true,
      extensions: rows.map((e) => ({
        id: e.id,
        slug: e.slug,
        name: e.name,
        description: e.description,
        category: e.category,
        iconUrl: e.iconUrl,
        version: e.version,
        status: e.status,
        permissions: safeJson<string[]>(e.permissions) ?? [],
        pricing: e.pricing,
        price: e.price,
        installCount: e.installCount,
        rating: e.rating,
        reviewCount: e.reviewCount,
        submittedAt: e.submittedAt ? e.submittedAt.toISOString() : null,
        reviewedAt: e.reviewedAt ? e.reviewedAt.toISOString() : null,
        reviewNotes: e.reviewNotes,
        publishedAt: e.publishedAt ? e.publishedAt.toISOString() : null,
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[api/developer/extensions GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/developer/extensions
 *
 * Create a new extension owned by the authenticated developer. The new
 * extension starts in 'draft' status.
 *
 * Body: { name, description, category, pricing?, price?, permissions: string[],
 *        version?, iconUrl?, config?, changelog? }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = typeof body.category === 'string' ? body.category.toLowerCase().trim() : '';
  const pricing = typeof body.pricing === 'string' ? body.pricing.toLowerCase().trim() : 'free';
  const price = typeof body.price === 'number' && !Number.isNaN(body.price) ? body.price : 0;
  const version = typeof body.version === 'string' && body.version.trim() ? body.version.trim() : '1.0.0';
  const iconUrl = typeof body.iconUrl === 'string' && body.iconUrl.trim() ? body.iconUrl.trim() : null;

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
    return NextResponse.json({ ok: false, error: `Invalid category` }, { status: 400 });
  }
  if (!VALID_PRICING.has(pricing)) {
    return NextResponse.json({ ok: false, error: `Invalid pricing` }, { status: 400 });
  }

  let permissions: string[] = [];
  if (Array.isArray(body.permissions)) {
    permissions = body.permissions
      .filter((p: unknown) => typeof p === 'string' && VALID_PERMISSIONS.has(p as string))
      .map((p: unknown) => p as string);
  }
  permissions = Array.from(new Set(permissions));

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
      return NextResponse.json({ ok: false, error: 'config must be valid JSON object' }, { status: 400 });
    }
  }

  let changelogJson: string | null = null;
  const firstChange = typeof body.changelog === 'string' ? body.changelog.trim() : '';
  if (firstChange) {
    changelogJson = JSON.stringify([{ version, date: new Date().toISOString(), changes: firstChange }]);
  }

  try {
    const slug = await generateUniqueSlug(name);
    const extension = await db.extension.create({
      data: {
        slug,
        name,
        description,
        developerId: userId,
        category,
        iconUrl,
        version,
        status: 'draft',
        permissions: JSON.stringify(permissions),
        pricing,
        price: pricing === 'free' ? 0 : price,
        config: configJson,
        changelog: changelogJson,
      },
    });
    return NextResponse.json({ ok: true, extension }, { status: 201 });
  } catch (err) {
    console.error('[api/developer/extensions POST] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
