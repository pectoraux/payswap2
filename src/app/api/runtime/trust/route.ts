/**
 * GET /api/runtime/trust — Global Audit & Transparency report.
 * POST /api/runtime/trust — trigger an action (publish proof, run stress tests, etc.)
 *
 * M-TRUST: 10 capabilities accessible via this endpoint.
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const view = url.searchParams.get('view');

    if (view === 'health') {
      return NextResponse.json({ ok: true, ...runtime.trust.getNetworkHealth() });
    }
    if (view === 'audit') {
      return NextResponse.json({ ok: true, ...runtime.trust.getAuditReport() });
    }
    if (view === 'verify') {
      return NextResponse.json({ ok: true, ...runtime.trust.verifyInvariants() });
    }
    if (view === 'public') {
      return NextResponse.json({ ok: true, ...runtime.trust.getPublicEconomicState() });
    }
    if (view === 'proofs') {
      return NextResponse.json({ ok: true, proofs: runtime.trust.getPublishedProofs() });
    }
    if (view === 'regulatory') {
      return NextResponse.json({ ok: true, ...runtime.trust.getRegulatoryConfig() });
    }

    // Default: full transparency report.
    return NextResponse.json({
      ok: true,
      networkHealth: runtime.trust.getNetworkHealth(),
      publicEconomicState: runtime.trust.getPublicEconomicState(),
      formalVerification: runtime.trust.verifyInvariants(),
      regulatoryConfig: runtime.trust.getRegulatoryConfig(),
      auditReport: runtime.trust.getAuditReport(10),
      publishedProofs: runtime.trust.getPublishedProofs().slice(-5),
      generatedAt: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action;

    if (action === 'publish_proof') {
      const proof = runtime.trust.publishProof(body.type || 'reserve');
      return NextResponse.json({ ok: true, proof });
    }
    if (action === 'stress_test') {
      const report = runtime.trust.runNightlyStressTests();
      return NextResponse.json({ ok: true, ...report });
    }
    if (action === 'set_jurisdiction') {
      const config = runtime.trust.setJurisdiction(body.jurisdiction || 'DEFAULT');
      return NextResponse.json({ ok: true, config });
    }
    if (action === 'merkle_proof') {
      const proof = await runtime.trust.computeMerkleProof();
      return NextResponse.json({ ok: true, proof });
    }
    if (action === 'replay_explorer') {
      const explorer = await runtime.trust.buildReplayExplorer();
      return NextResponse.json({ ok: true, ...explorer });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
