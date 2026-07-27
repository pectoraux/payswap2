import { NextResponse } from 'next/server';
import { kycService, sanctionsService, amlService, riskScoringService, pepService, caseService } from '@/protocol/compliance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/compliance/status — compliance framework status */
export async function GET() {
  const kycAny = kycService as any;
  const riskAny = riskScoringService as any;
  const pepAny = pepService as any;
  return NextResponse.json({
    kyc: { totalEntities: kycAny.getAllStatuses?.()?.length ?? 0 },
    sanctions: { activeHits: sanctionsService.getHits?.()?.filter((h: any) => !h.isFalsePositive)?.length ?? 0 },
    aml: { openAlerts: amlService.getAlerts({ status: 'open' })?.length ?? 0 },
    riskScoring: { totalAssessed: riskAny.getAllScores?.()?.length ?? 0 },
    pep: { totalScreened: pepAny.getAllStatuses?.()?.length ?? 0 },
    cases: {
      open: caseService.listCases({ status: 'open' })?.length ?? 0,
      investigating: caseService.listCases({ status: 'investigating' })?.length ?? 0,
      escalated: caseService.listCases({ status: 'escalated' })?.length ?? 0,
    },
    ts: Date.now(),
  });
}
