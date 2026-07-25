import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { Badge } from '@/components/ui/badge';
import { Boxes } from 'lucide-react';
import { MerchantExtensionsGrid, type MerchantExtension } from './extensions-grid';

export const dynamic = 'force-dynamic';

function safeJson<T = unknown>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default async function ExtensionsPage() {
  // Validates session + merchant role.
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const { merchantId } = ctx;

  // Fetch published extensions directly from the DB (server-side) — same
  // shape as the public /api/extensions/list endpoint.
  const rows = await db.extension.findMany({
    where: { status: 'published' },
    orderBy: [{ installCount: 'desc' }, { publishedAt: 'desc' }],
  });

  // Fetch the merchant's installed extensions and their per-merchant config.
  const installs = await db.extensionInstall.findMany({
    where: { merchantId },
    include: { extension: true },
  });

  const installMap = new Map(
    installs
      .filter((i) => i.extension.status === 'published')
      .map((i) => [
        i.extensionId,
        {
          installId: i.id,
          status: i.status,
          config: safeJson<Record<string, unknown>>(i.config),
          installedAt: i.installedAt.toISOString(),
        },
      ]),
  );

  const extensions: MerchantExtension[] = rows.map((e) => {
    const install = installMap.get(e.id);
    return {
      id: e.id,
      slug: e.slug,
      name: e.name,
      description: e.description,
      category: e.category,
      iconUrl: e.iconUrl,
      version: e.version,
      permissions: safeJson<string[]>(e.permissions) ?? [],
      pricing: e.pricing,
      price: e.price,
      config: safeJson<Record<string, unknown>>(e.config),
      installCount: e.installCount,
      rating: e.rating,
      reviewCount: e.reviewCount,
      developerId: e.developerId,
      publishedAt: e.publishedAt ? e.publishedAt.toISOString() : null,
      install: install ?? null,
    };
  });

  const categories = Array.from(new Set(extensions.map((e) => e.category)));
  const installedCount = extensions.filter((e) => e.install).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Extensions</h1>
          <p className="text-sm text-muted-foreground">
            Connect PaySwap to the tools your business already uses.
          </p>
        </div>
        <Badge
          variant="secondary"
          className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        >
          <Boxes className="mr-1.5 h-3 w-3" />
          {installedCount} installed · {extensions.length} available
        </Badge>
      </div>

      <MerchantExtensionsGrid
        extensions={extensions}
        categories={categories}
        installedCount={installedCount}
      />
    </div>
  );
}
