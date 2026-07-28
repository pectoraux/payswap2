import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import {
  parseMarketplaceMeta,
  serializeMarketplaceMeta,
  pluginVerifier,
} from '@/marketplace';
import type { PluginManifest } from '@/sdk/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/marketplace/[id]/verify
 *
 * Run the verification pipeline on a marketplace plugin (admin).
 *
 * Body (optional): { manifest?: PluginManifest }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const extension = await db.extension.findUnique({ where: { id } });
    if (!extension) {
      return NextResponse.json(
        { ok: false, error: 'Plugin not found' },
        { status: 404 },
      );
    }
    const meta = parseMarketplaceMeta(extension.config);
    const manifest: PluginManifest | undefined =
      body.manifest ?? meta.manifest ?? ({
        name: extension.name,
        version: extension.version,
        description: extension.description,
        author: extension.developerId,
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

    meta.verification = result;
    await db.extension.update({
      where: { id },
      data: { config: serializeMarketplaceMeta(meta) },
    });

    return NextResponse.json({ ok: true, verification: result });
  } catch (err) {
    console.error('[api/admin/marketplace/[id]/verify POST] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
