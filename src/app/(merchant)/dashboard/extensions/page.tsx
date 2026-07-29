import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { safeJson, normalizeInstallStatus } from '@/lib/extension-catalog';
import { getFeaturedIds } from '@/lib/extension-featured';
import { Badge } from '@/components/ui/badge';
import { Boxes } from 'lucide-react';
import { MerchantMarketplace, type MerchantExtension } from './extensions-grid';

export const dynamic = 'force-dynamic';

export default async function ExtensionsPage() {
  // Validates session + merchant role.
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const merchantId = ctx.merchant.id;

  // Fetch published extensions directly from the DB (server-side) — same
  // shape as the public /api/extensions endpoint.
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
          status: normalizeInstallStatus(i.status),
          config: safeJson<Record<string, unknown>>(i.config),
          installedAt: i.installedAt.toISOString(),
        },
      ]),
  );

  const featuredSet = await getFeaturedIds();

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
      price: Number(e.price),
      config: safeJson<Record<string, unknown>>(e.config),
      changelog:
        safeJson<Array<{ version: string; date: string; changes: string }>>(e.changelog) ??
        [],
      installCount: e.installCount,
      rating: Number(e.rating),
      reviewCount: e.reviewCount,
      developerId: e.developerId,
      publishedAt: e.publishedAt ? e.publishedAt.toISOString() : null,
      featured: featuredSet.has(e.id),
      install: install ?? null,
    };
  });

  const installedCount = extensions.filter((e) => e.install).length;
  const featuredCount = extensions.filter((e) => e.featured).length;
  const popularCount = extensions.filter((e) => e.installCount >= 500).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Extensions</h1>
          <p className="text-sm text-muted-foreground">
            Connect PaySwap to the tools your business already uses. Browse,
            install, and manage integrations across your merchant account.
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

      <MerchantMarketplace
        extensions={extensions}
        installedCount={installedCount}
        featuredCount={featuredCount}
        popularCount={popularCount}
      />
    </div>
  );
}
