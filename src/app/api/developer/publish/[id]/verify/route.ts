import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  unauthorized,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import {
  parseMarketplaceMeta,
  serializeMarketplaceMeta,
} from '@/marketplace';
import { pluginVerifier } from '@/marketplace';
import type { PluginManifest } from '@/sdk/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/developer/publish/[id]/verify
 *
 * Run the verification pipeline on the plugin's manifest. Developer-only
 * (the plugin's owner). Useful for catching manifest issues before
 * submitting for review.
 *
 * Body (optional): { manifest?: PluginManifest }
 *   - If provided, runs against this manifest (used by the wizard's
 *     "Validate manifest" step before the manifest is persisted).
 *   - Otherwise, runs against the manifest stored in the plugin's config.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id' }, { status: 400 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const row = await db.extension.findUnique({ where: { id } });
    if (!row || row.developerId !== userId) {
      return NextResponse.json(
        { ok: false, error: 'Plugin not found' },
        { status: 404 },
      );
    }
    const meta = parseMarketplaceMeta(row.config);
    const manifest: PluginManifest | undefined =
      body.manifest ?? meta.manifest ?? ({
        name: row.name,
        version: row.version,
        description: row.description,
        author: row.developerId,
        capabilities: meta.capabilities ?? [],
        permissions: (meta.permissions ?? []) as any,
        commands: [],
        events: [],
        views: [],
        policies: [],
        dependencies: (meta.dependencies ?? []).map((d) => ({
          pluginName: d.slug,
          minVersion: d.minVersion,
        })),
        migrations: [],
      } as PluginManifest);

    const published = await db.extension.findMany({
      where: { status: 'published' },
      select: { slug: true, version: true },
    });
    if (!manifest) {
      return NextResponse.json(
        { ok: false, error: 'No manifest available to verify' },
        { status: 400 },
      );
    }
    const result = await pluginVerifier.verify(manifest, undefined, published);

    // Persist the verification result back to the plugin's config.
    meta.verification = result;
    await db.extension.update({
      where: { id },
      data: { config: serializeMarketplaceMeta(meta) },
    });

    return NextResponse.json({ ok: true, verification: result });
  } catch (err) {
    console.error('[api/developer/publish/[id]/verify POST] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
