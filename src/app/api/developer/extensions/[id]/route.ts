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
 * PATCH /api/developer/extensions/[id]
 *
 * Update an extension. Only the developer who owns it may edit, and only
 * when in draft or rejected status.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  const { id } = await params;
  const existing = await db.extension.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'Extension not found' }, { status: 404 });
  }
  if (existing.developerId !== userId) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }
  if (!['draft', 'rejected'].includes(existing.status)) {
    return NextResponse.json(
      { ok: false, error: 'Only draft or rejected extensions can be edited' },
      { status: 400 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (typeof body.name === 'string' && body.name.trim()) {
    const name = body.name.trim();
    if (name.length < 2 || name.length > 80) {
      return NextResponse.json({ ok: false, error: 'Name must be 2-80 characters' }, { status: 400 });
    }
    patch.name = name;
  }
  if (typeof body.description === 'string' && body.description.trim()) {
    if (body.description.trim().length < 10) {
      return NextResponse.json({ ok: false, error: 'Description must be at least 10 characters' }, { status: 400 });
    }
    patch.description = body.description.trim();
  }
  if (typeof body.category === 'string' && body.category.trim()) {
    const cat = body.category.toLowerCase().trim();
    if (!VALID_CATEGORIES.has(cat)) {
      return NextResponse.json({ ok: false, error: 'Invalid category' }, { status: 400 });
    }
    patch.category = cat;
  }
  if (typeof body.pricing === 'string' && body.pricing.trim()) {
    const p = body.pricing.toLowerCase().trim();
    if (!VALID_PRICING.has(p)) {
      return NextResponse.json({ ok: false, error: 'Invalid pricing' }, { status: 400 });
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
        return NextResponse.json({ ok: false, error: 'config must be valid JSON object' }, { status: 400 });
      }
    }
  }

  // Reset a rejected extension to draft on edit.
  if (existing.status === 'rejected') {
    patch.status = 'draft';
    patch.reviewNotes = null;
  }

  try {
    const updated = await db.extension.update({
      where: { id },
      data: patch as any,
    });
    return NextResponse.json({ ok: true, extension: updated });
  } catch (err) {
    console.error('[api/developer/extensions PATCH] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
