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
 * GET /api/extensions/[id]
 *
 * Returns a single extension. Visible to anyone for published extensions;
 * for non-public statuses, requires the caller to be the developer or an admin.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const extension = await db.extension.findUnique({ where: { id } });
  if (!extension) {
    return NextResponse.json({ error: 'Extension not found' }, { status: 404 });
  }

  // Public extensions are visible to everyone.
  if (extension.status !== 'published') {
    const session = await requireSession();
    if (!session) return unauthorized();
    const userId = (session.user as any)?.id as string | undefined;
    const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
    const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
    if (extension.developerId !== userId && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  return NextResponse.json({ extension });
}

/**
 * PATCH /api/extensions/[id]
 *
 * Update an extension. Only the developer who owns the extension may edit it,
 * and only when it is in the draft / rejected state (so submitted / published
 * versions can't be silently mutated). Admins can also edit any extension.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  if (!session) return unauthorized();

  const userId = (session.user as any)?.id as string | undefined;
  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  const existing = await db.extension.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Extension not found' }, { status: 404 });
  }

  if (existing.developerId !== userId && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Non-admins can only edit drafts or rejected extensions.
  if (!isAdmin && !['draft', 'rejected'].includes(existing.status)) {
    return NextResponse.json(
      { error: 'Only draft or rejected extensions can be edited' },
      { status: 400 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (typeof body.name === 'string' && body.name.trim()) {
    const name = body.name.trim();
    if (name.length < 2 || name.length > 80) {
      return NextResponse.json(
        { error: 'Name must be 2-80 characters' },
        { status: 400 },
      );
    }
    patch.name = name;
  }
  if (typeof body.description === 'string' && body.description.trim()) {
    if (body.description.trim().length < 10) {
      return NextResponse.json(
        { error: 'Description must be at least 10 characters' },
        { status: 400 },
      );
    }
    patch.description = body.description.trim();
  }
  if (typeof body.category === 'string' && body.category.trim()) {
    const cat = body.category.toLowerCase().trim();
    if (!VALID_CATEGORIES.has(cat)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }
    patch.category = cat;
  }
  if (typeof body.pricing === 'string' && body.pricing.trim()) {
    const p = body.pricing.toLowerCase().trim();
    if (!VALID_PRICING.has(p)) {
      return NextResponse.json({ error: 'Invalid pricing' }, { status: 400 });
    }
    patch.pricing = p;
    if (p === 'free') patch.price = 0;
  }
  if (typeof body.price === 'number' && !Number.isNaN(body.price)) {
    patch.price = body.price;
  }
  if (typeof body.version === 'string' && body.version.trim()) {
    patch.version = body.version.trim();
  }
  if (typeof body.iconUrl === 'string') {
    patch.iconUrl = body.iconUrl.trim() || null;
  }

  if (Array.isArray(body.permissions)) {
    const perms = body.permissions
      .filter((p: unknown) => typeof p === 'string' && VALID_PERMISSIONS.has(p as string))
      .map((p: unknown) => p as string);
    patch.permissions = JSON.stringify(Array.from(new Set(perms)));
  }

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
        return NextResponse.json({ error: 'config must be valid JSON object' }, { status: 400 });
      }
    }
  }

  // When a developer edits a rejected extension, reset it to draft so they
  // can re-submit for review.
  if (!isAdmin && existing.status === 'rejected') {
    patch.status = 'draft';
    patch.reviewNotes = null;
  }

  const updated = await db.extension.update({
    where: { id },
    data: patch as any,
  });

  return NextResponse.json({ extension: updated });
}
