import { NextRequest, NextResponse } from 'next/server';
import { compileDSL } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PHASE 4: The Economic DSL. Developers declare goals in a YAML-like syntax;
 * the compiler parses + validates + compiles to a Goal object the planner can prove().
 *
 * Example DSL:
 *   goal EnrollStudent
 *     description Enroll a student in an accredited course
 *     category education
 *     requires
 *       identity.verified
 *       payment.completed
 *     produces
 *       education.enrollment
 *     inputs
 *       currency.usd 2000
 *       identity.verified 1
 *     constraints
 *       budget < 1000
 *       jurisdiction = GH
 *       deadline < 2h
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const source = typeof body?.source === 'string' ? body.source : '';

  if (!source.trim()) return NextResponse.json({ error: 'source is required (the DSL text)' }, { status: 400 });

  const result = compileDSL(source);

  if (result.parseErrors.length > 0 || result.compileErrors.length > 0) {
    return NextResponse.json({
      compiled: false,
      goal: null,
      parseErrors: result.parseErrors,
      compileErrors: result.compileErrors,
      warnings: result.warnings,
      resolvedAssets: result.resolvedAssets,
    }, { status: 422 });
  }

  return NextResponse.json({
    compiled: true,
    goal: result.goal,
    warnings: result.warnings,
    resolvedAssets: result.resolvedAssets,
    message: `✓ DSL compiled — goal "${result.goal?.name}" ready for prove()`,
  }, { status: 201 });
}
