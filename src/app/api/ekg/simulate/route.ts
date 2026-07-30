import { NextRequest, NextResponse } from 'next/server';
import { simulate, getProof, type Proof } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const proofId = typeof body?.proofId === 'string' ? body.proofId : '';
  if (!proofId) return NextResponse.json({ error: 'proofId is required' }, { status: 400 });

  const proof = getProof(proofId);
  if (!proof) return NextResponse.json({ error: 'Proof not found' }, { status: 404 });

  const sim = simulate(proof as Proof);
  proof.simulation = sim;
  proof.status = 'simulated';

  return NextResponse.json({ simulation: { ...sim, simulatedAt: new Date(sim.simulatedAt).toISOString() } }, { status: 201 });
}
