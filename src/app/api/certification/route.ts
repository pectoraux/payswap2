import { NextRequest, NextResponse } from 'next/server';
import { certifyExtension, verifyBadge, listCertifications, getCertification, getLatestCertification, type CertificationBadge } from '@/certification';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';
import type { ExtensionPackage } from '@/extension-platform/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const action = body.action as string;

  if (action === 'certify') {
    const pkg = body.package as ExtensionPackage;
    if (!pkg) return NextResponse.json({ error: 'package is required' }, { status: 400 });
    const report = certifyExtension(pkg);
    return NextResponse.json({
      ...report,
      message: report.level === 'CERTIFIED'
        ? `✓ CERTIFIED — ${report.passed}/${report.totalChecks} checks passed. Score: ${report.score}/100. Badge issued.`
        : report.level === 'CONDITIONAL'
        ? `⚠ CONDITIONAL — ${report.passed}/${report.totalChecks} passed, ${report.failed} failed. Extension can publish with warnings.`
        : `✗ REJECTED — ${report.failed} critical checks failed. Extension cannot publish.`,
    }, { status: report.level === 'REJECTED' ? 422 : 201 });
  }

  if (action === 'verifyBadge') {
    const badge = body.badge as CertificationBadge;
    if (!badge) return NextResponse.json({ error: 'badge is required' }, { status: 400 });
    const result = verifyBadge(badge);
    return NextResponse.json({
      ...result,
      message: result.valid ? '✓ Badge signature valid — issued by PaySwap' : '✗ Badge signature invalid — may be forged',
    });
  }

  return NextResponse.json({ error: 'Unknown action (use "certify" or "verifyBadge")' }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const extensionId = sp.get('extensionId');
  const certId = sp.get('certId');

  if (certId) {
    const cert = getCertification(certId);
    if (!cert) return NextResponse.json({ error: 'Certification not found' }, { status: 404 });
    return NextResponse.json(cert);
  }

  if (extensionId) {
    const latest = getLatestCertification(extensionId);
    return NextResponse.json({ certification: latest });
  }

  const certs = listCertifications(20);
  return NextResponse.json({ certifications: certs, count: certs.length });
}
