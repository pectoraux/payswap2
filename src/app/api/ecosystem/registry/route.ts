import { NextRequest, NextResponse } from 'next/server';
import { registry, quality } from '@/extension-ecosystem';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';
import type { ExtensionManifestV2 } from '@/extension-platform/types';
import type { ReleaseChannel } from '@/extension-ecosystem';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const extId = sp.get('extensionId');
  if (extId) {
    const entry = registry.get(extId);
    return NextResponse.json({ entry, versionHistory: registry.versionHistory(extId), qualityScore: quality.get(extId) });
  }
  const entries = registry.list({ category: sp.get('category') ?? undefined, channel: sp.get('channel') as ReleaseChannel | undefined });
  return NextResponse.json({ extensions: entries, count: entries.length });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const manifest = body.manifest as ExtensionManifestV2;
  const publisherId = body.publisherId as string;
  const channel = (body.channel as ReleaseChannel) ?? 'STABLE';
  const changelog = (body.changelog as string) ?? '';
  if (!manifest || !publisherId) return NextResponse.json({ error: 'manifest and publisherId are required' }, { status: 400 });
  const entry = registry.publish(manifest, publisherId, channel, changelog);
  const qs = quality.compute(entry.extensionId);
  return NextResponse.json({ entry, qualityScore: qs, message: `✓ Published ${manifest.id}@${manifest.version} on ${channel} channel (quality score: ${qs.overall})` }, { status: 201 });
}
