import { NextRequest, NextResponse } from 'next/server';
import { submitToMarketplace, listMarketplace, approveSubmission, rejectSubmission } from '@/extension-platform';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const submissions = listMarketplace();
  return NextResponse.json({ submissions, count: submissions.length });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const action = typeof body?.action === 'string' ? body.action : 'submit';

  if (action === 'submit') {
    const pkg = body?.package;
    if (!pkg) return NextResponse.json({ error: 'package is required' }, { status: 400 });
    const submission = submitToMarketplace(pkg as Parameters<typeof submitToMarketplace>[0]);
    return NextResponse.json({ submission, message: `Submitted — ${submission.reviewStages.filter((s) => s.result === 'PASS').length}/${submission.reviewStages.length} automated stages passed` }, { status: 201 });
  }

  if (action === 'approve') {
    const submissionId = typeof body?.submissionId === 'string' ? body.submissionId : '';
    const reviewerId = typeof body?.reviewerId === 'string' ? body.reviewerId : 'admin';
    const sub = approveSubmission(submissionId, reviewerId);
    if (!sub) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    return NextResponse.json({ submission: sub, message: `✓ Published — ${sub.extensionId}@${sub.version}` });
  }

  if (action === 'reject') {
    const submissionId = typeof body?.submissionId === 'string' ? body.submissionId : '';
    const reviewerId = typeof body?.reviewerId === 'string' ? body.reviewerId : 'admin';
    const reason = typeof body?.reason === 'string' ? body.reason : 'No reason provided';
    const sub = rejectSubmission(submissionId, reviewerId, reason);
    if (!sub) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    return NextResponse.json({ submission: sub, message: `✗ Rejected: ${reason}` });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
