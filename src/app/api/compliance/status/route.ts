import { NextResponse } from 'next/server';
import { kycService, sanctionsService, amlService, riskScoringService, pepService, caseService } from '@/protocol/compliance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/compliance/status — compliance framework status */
export async function GET() {
  return NextResponse.json({
    kyc: { totalEntities: kycService.getAllStatuses?.()?.length ?? 0 },
    sanctions: { activeHits: sanctionsService.getHits()?.filter((h: any) => !h.isFalsePositive)?.length ?? 0 },
    aml: { openAlerts: amlService.getAlerts({ status: 'open' })?.length ?? 0 },
    riskScoring: { totalAssessed: riskScoringService.getAllScores?.()?.length ?? 0 },
    pep: { totalScreened: pepService.getAllStatuses?.()?.length ?? 0 },
    cases: {
      open: caseService.listCases({ status: 'open' })?.length ?? 0,
      investigating: caseService.listCases({ status: 'investigating' })?.length ?? 0,
      escalated: caseService.listCases({ status: 'escalated' })?.length ?? 0,
    },
    ts: Date.now(),
  });
}
