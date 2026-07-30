import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { economicEngine } from '@/economic';
import type { PipelineStep } from '@/economic';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializePipeline(p: ReturnType<typeof economicEngine.listPipelines>[number]) {
  return {
    id: p.id, name: p.name, description: p.description, trigger: p.trigger,
    filter: p.filter, steps: p.steps, status: p.status,
    executions: p.executions, successes: p.successes, failures: p.failures,
    lastExecutedAt: p.lastExecutedAt ? new Date(p.lastExecutedAt).toISOString() : null,
    createdAt: new Date(p.createdAt).toISOString(),
  };
}

function serializeExecution(e: ReturnType<typeof economicEngine.listExecutions>[number]) {
  return {
    id: e.id, pipelineId: e.pipelineId, pipelineName: e.pipelineName, trigger: e.trigger,
    triggerEvent: e.triggerEvent,
    steps: e.steps.map((s) => ({ ...s, ts: new Date(s.ts).toISOString() })),
    status: e.status,
    startedAt: new Date(e.startedAt).toISOString(),
    completedAt: e.completedAt ? new Date(e.completedAt).toISOString() : null,
    durationMs: e.durationMs,
    cascadeDepth: e.cascadeDepth,
  };
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const view = sp.get('view') ?? 'pipelines';
  if (view === 'executions') {
    const pipelineId = sp.get('pipelineId') ?? undefined;
    const limit = sp.get('limit') ? Number(sp.get('limit')) : 50;
    const execs = economicEngine.listExecutions({ pipelineId, limit }).map(serializeExecution);
    return NextResponse.json({ executions: execs, count: execs.length });
  }
  const pipelines = economicEngine.listPipelines().map(serializePipeline);
  return NextResponse.json({ pipelines, count: pipelines.length });
}

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
  const name = typeof body?.name === 'string' ? body.name.slice(0, 120) : '';
  const description = typeof body?.description === 'string' ? body.description.slice(0, 500) : '';
  const trigger = typeof body?.trigger === 'string' ? body.trigger : '';
  const steps = Array.isArray(body?.steps) ? (body.steps as PipelineStep[]) : [];
  const filter = body?.filter && typeof body.filter === 'object' ? body.filter as Record<string, unknown> : undefined;

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!trigger) return NextResponse.json({ error: 'trigger is required' }, { status: 400 });
  if (steps.length === 0) return NextResponse.json({ error: 'at least one step is required' }, { status: 400 });

  const pipeline = economicEngine.registerPipeline({ name, description, trigger, filter, steps });

  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: 'ECONOMIC.PIPELINE_REGISTERED',
        resourceType: 'Pipeline',
        resourceId: pipeline.id,
        result: 'SUCCESS',
        details: JSON.stringify({ name, trigger, stepCount: steps.length, actorEmail: actorEmail ?? null }),
      },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({ pipeline: serializePipeline(pipeline) }, { status: 201 });
}
