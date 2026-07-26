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

/**
 * Convert a free-form name into a URL-safe slug. Falls back to a random
 * suffix when the slug already exists.
 */
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
 * POST /api/extensions/create
 *
 * Create a new extension owned by the authenticated developer.
 *
 * Body:
 *   { name, description, category, pricing?, price?, permissions: string[],
 *     config?, changelog?, iconUrl?, version? }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: 'No user id in session' }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = typeof body.category === 'string' ? body.category.toLowerCase().trim() : '';
  const pricing = typeof body.pricing === 'string' ? body.pricing.toLowerCase().trim() : 'free';
  const price = typeof body.price === 'number' && !Number.isNaN(body.price) ? body.price : 0;
  const version = typeof body.version === 'string' && body.version.trim() ? body.version.trim() : '1.0.0';
  const iconUrl = typeof body.iconUrl === 'string' && body.iconUrl.trim() ? body.iconUrl.trim() : null;

  if (!name || name.length < 2) {
    return NextResponse.json({ error: 'Name must be at least 2 characters' }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ error: 'Name must be 80 characters or fewer' }, { status: 400 });
  }
  if (!description || description.length < 10) {
    return NextResponse.json(
      { error: 'Description must be at least 10 characters' },
      { status: 400 },
    );
  }
  if (!VALID_CATEGORIES.has(category)) {
    return NextResponse.json(
      { error: `Invalid category. Allowed: ${Array.from(VALID_CATEGORIES).join(', ')}` },
      { status: 400 },
    );
  }
  if (!VALID_PRICING.has(pricing)) {
    return NextResponse.json(
      { error: `Invalid pricing. Allowed: ${Array.from(VALID_PRICING).join(', ')}` },
      { status: 400 },
    );
  }

  // Permissions must be a string array with only the allowed scopes.
  let permissions: string[] = [];
  if (Array.isArray(body.permissions)) {
    permissions = body.permissions
      .filter((p: unknown) => typeof p === 'string' && VALID_PERMISSIONS.has(p as string))
      .map((p: unknown) => p as string);
  }
  // De-dupe permissions while preserving order.
  permissions = Array.from(new Set(permissions));

  // Validate config JSON. Optional — when provided must be a parseable object.
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
      return NextResponse.json({ error: 'config must be valid JSON object' }, { status: 400 });
    }
  }

  // Validate changelog JSON. Optional — first version changes from the form.
  let changelogJson: string | null = null;
  const firstChange =
    typeof body.changelog === 'string' ? body.changelog.trim() : '';
  if (firstChange) {
    changelogJson = JSON.stringify([
      {
        version,
        date: new Date().toISOString(),
        changes: firstChange,
      },
    ]);
  }

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

  return NextResponse.json({ extension }, { status: 201 });
}
