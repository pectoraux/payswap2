import { NextRequest, NextResponse } from 'next/server';
import { runFullValidationSuite, runPropertyTests, runEvidenceFailureTests, runReplayDeterminismTests, runFaultInjectionTests } from '@/protocol/validation-suite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/validation — run the full operational validation suite */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const propertyCount = Math.min(body?.propertyCount ?? 200, 1000);
  const replayCount = Math.min(body?.replayCount ?? 100, 500);
  const testType = body?.testType ?? 'full';

  if (testType === 'property') {
    return NextResponse.json({ result: runPropertyTests(propertyCount) });
  }
  if (testType === 'evidence') {
    return NextResponse.json({ result: runEvidenceFailureTests() });
  }
  if (testType === 'replay') {
    return NextResponse.json({ result: runReplayDeterminismTests(replayCount) });
  }
  if (testType === 'fault') {
    return NextResponse.json({ result: runFaultInjectionTests() });
  }

  // Full suite
  const result = runFullValidationSuite(propertyCount, replayCount);
  return NextResponse.json(result);
}
