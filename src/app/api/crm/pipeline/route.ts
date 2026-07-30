import { NextResponse } from 'next/server';
import { crmService } from '@/extensions/crm/store';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const pipeline = crmService.getPipeline();
  const stages = crmService.listStages();
  return NextResponse.json({ stages, pipeline, stats: crmService.stats() });
}
