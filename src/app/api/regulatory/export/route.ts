import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { regulatorExportService } from '@/lib/regulator-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const url = new URL(req.url);
  const type = url.searchParams.get('type') || 'full';
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');

  const to = toStr ? new Date(toStr) : new Date();
  const from = fromStr ? new Date(fromStr) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  let exportData;
  switch (type) {
    case 'aml':
      exportData = await regulatorExportService.generateAMLExport(from, to);
      break;
    case 'travel_rule':
      exportData = await regulatorExportService.generateTravelRuleExport(from, to);
      break;
    case 'proof_of_reserves':
      exportData = await regulatorExportService.generateProofOfReservesExport();
      break;
    case 'audit_trail':
      exportData = await regulatorExportService.generateAuditTrailExport(from, to);
      break;
    default:
      exportData = await regulatorExportService.generateFullExport(from, to);
  }

  return NextResponse.json({ ok: true, export: exportData });
}
