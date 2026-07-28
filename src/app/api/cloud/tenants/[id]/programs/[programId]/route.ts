/**
 * PATCH /api/cloud/tenants/[id]/programs/[programId] — program lifecycle.
 *
 * Body: { action: 'pause' | 'resume' | 'archive' | 'complete' | 'update',
 *         name?, description?, config? }
 *
 * - 'pause'    → active → paused
 * - 'resume'   → paused → active
 * - 'archive'  → any → archived
 * - 'complete' → active/paused → completed
 * - 'update'   → updates name / description / config
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized, forbidden } from '@/lib/api-auth';
import { cloudEngine, tenantManager } from '@/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ACTIONS = ['pause', 'resume', 'archive', 'complete', 'update'] as const;
type Action = (typeof VALID_ACTIONS)[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; programId: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const userId = (session.user as { id?: string }).id ?? '';
  const roles = ((session.user as { roles?: string[] }).roles) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  const { id, programId } = await params;
  const tenant = await tenantManager.get(id);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const member = tenant.members.find((m) => m.userId === userId);
  const canManage = isAdmin ||
    (member && (member.role === 'owner' || member.role === 'admin' || member.role === 'developer'));
  if (!canManage) return forbidden();

  const program = await cloudEngine.programs.get(programId);
  if (!program || program.tenantId !== id) {
    return NextResponse.json({ error: 'Program not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = body?.action as Action;
  if (!action || !VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'invalid action' }, { status: 400 });
  }

  switch (action) {
    case 'pause':
      await cloudEngine.programs.pause(programId, userId);
      break;
    case 'resume':
      await cloudEngine.programs.resume(programId, userId);
      break;
    case 'archive':
      await cloudEngine.programs.archive(programId, userId);
      break;
    case 'complete':
      await cloudEngine.programs.complete(programId, userId);
      break;
    case 'update':
      await cloudEngine.programs.update(
        programId,
        {
          name: typeof body?.name === 'string' ? body.name : undefined,
          description: typeof body?.description === 'string' ? body.description : undefined,
          config: body?.config as Record<string, unknown> | undefined,
        },
        userId,
      );
      break;
  }

  const updated = await cloudEngine.programs.get(programId);
  return NextResponse.json({ program: updated });
}
