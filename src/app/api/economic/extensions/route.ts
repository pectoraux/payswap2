import { NextRequest, NextResponse } from 'next/server';
import { economicEngine } from '@/economic';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serialize(e: ReturnType<typeof economicEngine.listExtensions>[number]) {
  return {
    id: e.id, name: e.name, version: e.version, status: e.status,
    category: e.category, description: e.description, reputation: e.reputation,
    treasury: e.treasury,
    eventsPublished: e.eventsPublished, eventsConsumed: e.eventsConsumed,
    tokensMinted: e.tokensMinted, tokensConsumed: e.tokensConsumed,
    registeredAt: new Date(e.registeredAt).toISOString(),
    manifest: e.manifest,
  };
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const extensions = economicEngine.listExtensions().map(serialize);
  return NextResponse.json({ extensions, count: extensions.length });
}
