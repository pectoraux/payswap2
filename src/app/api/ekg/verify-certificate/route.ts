import { NextRequest, NextResponse } from 'next/server';
import { verifyCertificate, getCertificate, type FormalProofCertificate } from '@/ekg';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PHASE 3: Independent verification. Anyone can call this to re-verify a
 * formal proof certificate without trusting the issuer.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const certificateId = typeof body?.certificateId === 'string' ? body.certificateId : '';

  let certificate = certificateId ? getCertificate(certificateId) : undefined;
  // If a full certificate is passed inline, verify it directly
  if (!certificate && body?.certificate && typeof body.certificate === 'object') {
    certificate = body.certificate as FormalProofCertificate;
  }

  if (!certificate) return NextResponse.json({ error: 'Certificate not found — pass certificateId or a full certificate object' }, { status: 404 });

  const result = verifyCertificate(certificate);

  return NextResponse.json({
    ...result,
    certificateId: certificate.id,
    internallyConsistent: result.discrepancies.length === 0,
    message: result.discrepancies.length === 0
      ? (result.valid
        ? '✓ Certificate is VALID — internally consistent AND all invariants hold'
        : `✓ Certificate is internally consistent (not tampered) — but ${certificate.invariants.filter((i) => !i.holds).length} invariants do not hold`)
      : `✗ Certificate TAMPERED — ${result.discrepancies.length} discrepancies found`,
  });
}
