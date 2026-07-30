import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { economicEngine } from '@/economic';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const userId = (session.user as { id?: string })?.id as string | undefined;
  const actorEmail = (session.user as { email?: string })?.email as string | undefined;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const id = typeof body?.id === 'string' ? body.id : '';
  const payload = body?.payload && typeof body.payload === 'object'
    ? body.payload as Record<string, unknown>
    : {};

  if (!id) return NextResponse.json({ error: 'pipeline id is required' }, { status: 400 });

  const exec = economicEngine.triggerPipeline(id, payload);
  if (!exec) {
    return NextResponse.json({ error: 'Pipeline not found or not active' }, { status: 404 });
  }

  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: 'ECONOMIC.PIPELINE_TRIGGERED',
        resourceType: 'Pipeline',
        resourceId: id,
        result: exec.status === 'COMPLETED' ? 'SUCCESS' : 'ERROR',
        details: JSON.stringify({
          executionId: exec.id,
          pipelineName: exec.pipelineName,
          status: exec.status,
          stepCount: exec.steps.length,
          durationMs: exec.durationMs,
          cascadeDepth: exec.cascadeDepth,
          actorEmail: actorEmail ?? null,
        }),
      },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({
    execution: {
      id: exec.id, pipelineId: exec.pipelineId, pipelineName: exec.pipelineName,
      trigger: exec.trigger, triggerEvent: exec.triggerEvent,
      steps: exec.steps.map((s) => ({ ...s, ts: new Date(s.ts).toISOString() })),
      status: exec.status,
      startedAt: new Date(exec.startedAt).toISOString(),
      completedAt: exec.completedAt ? new Date(exec.completedAt).toISOString() : null,
      durationMs: exec.durationMs,
      cascadeDepth: exec.cascadeDepth,
    },
  }, { status: 201 });
}
