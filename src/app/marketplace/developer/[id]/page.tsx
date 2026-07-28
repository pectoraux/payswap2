import { notFound } from 'next/navigation';
import Link from 'next/link';
import { pluginCatalog } from '@/marketplace';
import { MarketplaceHeader, MarketplaceFooter } from '../../_components/marketplace-header';
import { DeveloperPageClient } from '../../_components/developer-page';
import type { PublicPlugin, DeveloperProfile } from '@/marketplace';

export const dynamic = 'force-dynamic';

/**
 * /marketplace/developer/[id]
 *
 * Public developer profile + their published plugins.
 */
export default async function DeveloperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile, plugins } = await pluginCatalog.getDeveloper(id);
  if (!profile) notFound();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <MarketplaceHeader />
      <main className="flex-1">
        <DeveloperPageClient profile={profile} plugins={plugins as PublicPlugin[]} />
      </main>
      <MarketplaceFooter />
    </div>
  );
}
