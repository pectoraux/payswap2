/**
 * GET  /api/cloud/tenants/[id]/programs — list programs for a tenant.
 * POST /api/cloud/tenants/[id]/programs — create a new program.
 *
 * POST body: { name: string, description: string, config?: Record<string, unknown> }
 *
 * Optional query (GET): ?status=active|paused|completed|archived&q=<name>
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { cloudEngine, tenantManager } from '@/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUS = ['active', 'paused', 'completed', 'archived'] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const userId = (session.user as { id?: string }).id ?? '';
  const roles = ((session.user as { roles?: string[] }).roles) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  const { id } = await params;
  const tenant = await tenantManager.get(id);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const isMember = tenant.members.some((m) => m.userId === userId);
  if (!isAdmin && !isMember) return forbidden();

  let programs = await cloudEngine.programs.listForTenant(id);

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');
  const q = url.searchParams.get('q') ?? '';
  if (statusParam && (VALID_STATUS as readonly string[]).includes(statusParam)) {
    programs = programs.filter((p) => p.status === statusParam);
  }
  if (q.trim()) {
    const lower = q.trim().toLowerCase();
    programs = programs.filter((p) =>
      p.name.toLowerCase().includes(lower) ||
      p.description.toLowerCase().includes(lower),
    );
  }

  return NextResponse.json({ count: programs.length, programs });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const userId = (session.user as { id?: string }).id ?? '';
  const roles = ((session.user as { roles?: string[] }).roles) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  const { id } = await params;
  const tenant = await tenantManager.get(id);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const member = tenant.members.find((m) => m.userId === userId);
  const canManage = isAdmin ||
    (member && (member.role === 'owner' || member.role === 'admin' || member.role === 'developer'));
  if (!canManage) return forbidden();

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const name = (body?.name as string)?.trim();
  const description = (body?.description as string)?.trim();

  if (!name || name.length < 2) {
    return NextResponse.json({ error: 'name is required (min 2 chars)' }, { status: 400 });
  }
  if (!description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }

  const program = await cloudEngine.programs.create(
    id,
    { name, description, config: body?.config as Record<string, unknown> | undefined },
    userId,
  );

  return NextResponse.json({ program }, { status: 201 });
}
