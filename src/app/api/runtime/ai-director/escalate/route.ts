import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/runtime/ai-director/escalate
 *
 * Body: {
 *   problem: string;           // what the admin spotted
 *   currentBehavior: string;   // what the kernel did
 *   reason: string;            // why this is a problem
 *   suggestedFix?: string;     // optional patch description
 *   files?: string[];          // files that would need changing
 *   tests?: string[];          // tests that should be added/updated
 *   expectedImpact?: string;   // what the fix accomplishes
 *   severity?: 'P1'|'P2'|'P3'|'P4';
 *   component?: string;        // api | payments | payouts | webhooks | connectors | blockchain | runtime
 *   scenarioName?: string;     // for the description header
 *   runId?: string;            // for the description header
 * }
 *
 * Creates an Incident row in the DB (using the existing `Incident` Prisma model)
 * and an IncidentUpdate with the structured report as a JSON-encoded message.
 *
 * Returns: { ok: true, incident: { id, title, severity, status, component, createdAt } }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  const body = await req.json().catch(() => ({} as any));
  const problem: string = (body?.problem ?? '').toString().trim();
  const currentBehavior: string = (body?.currentBehavior ?? '').toString().trim();
  const reason: string = (body?.reason ?? '').toString().trim();

  if (!problem) {
    return NextResponse.json(
      { ok: false, error: 'problem is required' },
      { status: 400 },
    );
  }

  const suggestedFix: string = (body?.suggestedFix ?? '').toString().trim();
  const files: string[] = Array.isArray(body?.files)
    ? body.files.filter((f: unknown) => typeof f === 'string').slice(0, 12)
    : [];
  const tests: string[] = Array.isArray(body?.tests)
    ? body.tests.filter((t: unknown) => typeof t === 'string').slice(0, 12)
    : [];
  const expectedImpact: string = (body?.expectedImpact ?? '').toString().trim();
  const severity: string = ['P1', 'P2', 'P3', 'P4'].includes(body?.severity)
    ? body.severity
    : 'P2';
  const component: string | null =
    typeof body?.component === 'string' && body.component.trim()
      ? body.component.trim().slice(0, 64)
      : 'runtime';
  const scenarioName: string | null =
    typeof body?.scenarioName === 'string' && body.scenarioName.trim()
      ? body.scenarioName.trim().slice(0, 200)
      : null;
  const runId: string | null =
    typeof body?.runId === 'string' && body.runId.trim()
      ? body.runId.trim().slice(0, 64)
      : null;

  const userId = (adminSession.user as { id?: string }).id ?? null;

  // Compose a readable title (truncated to fit the title column comfortably).
  const title =
    problem.length > 140 ? problem.slice(0, 137) + '...' : problem;

  // Compose the structured report as the description.
  const reportLines: string[] = [];
  if (scenarioName || runId) {
    reportLines.push(
      `Source: ${[scenarioName, runId].filter(Boolean).join(' · ')}`,
    );
  }
  reportLines.push('');
  reportLines.push('## Problem');
  reportLines.push(problem);
  reportLines.push('');
  reportLines.push('## Current behaviour');
  reportLines.push(currentBehavior || '(not specified)');
  reportLines.push('');
  reportLines.push('## Reason');
  reportLines.push(reason || '(not specified)');
  if (suggestedFix) {
    reportLines.push('');
    reportLines.push('## Suggested fix');
    reportLines.push(suggestedFix);
  }
  if (files.length > 0) {
    reportLines.push('');
    reportLines.push('## Files');
    files.forEach((f) => reportLines.push(`- ${f}`));
  }
  if (tests.length > 0) {
    reportLines.push('');
    reportLines.push('## Tests');
    tests.forEach((t) => reportLines.push(`- ${t}`));
  }
  if (expectedImpact) {
    reportLines.push('');
    reportLines.push('## Expected impact');
    reportLines.push(expectedImpact);
  }
  const description = reportLines.join('\n');

  // Persist as an Incident + first IncidentUpdate.
  const incident = await db.incident.create({
    data: {
      title,
      description,
      severity,
      status: 'open',
      component,
      createdBy: userId,
    },
  });

  const structuredReport = {
    problem,
    currentBehavior,
    reason,
    suggestedFix,
    files,
    tests,
    expectedImpact,
    scenarioName,
    runId,
  };

  await db.incidentUpdate.create({
    data: {
      incidentId: incident.id,
      authorId: userId,
      message: `AI Director escalation:\n${JSON.stringify(structuredReport, null, 2)}`,
      status: 'investigating',
    },
  });

  return NextResponse.json({
    ok: true,
    incident: {
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      component: incident.component,
      createdAt: incident.createdAt.toISOString(),
    },
  });
}
