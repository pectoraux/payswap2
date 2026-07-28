import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { parseMarketplaceMeta } from '@/marketplace';
import { PublishWizard } from './publish-wizard';
import type { CapabilityDeclaration, Permission, PluginManifest } from '@/sdk/types';
import type {
  MarketplaceCategory,
  PricingPlan,
  VerificationResult,
  PluginScreenshot,
} from '@/marketplace';

export const dynamic = 'force-dynamic';

export interface WizardPluginData {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: MarketplaceCategory;
  iconUrl: string | null;
  version: string;
  status: string;
  longDescription: string;
  manifest: PluginManifest | null;
  capabilities: CapabilityDeclaration[];
  permissions: Permission[];
  pricing: PricingPlan;
  documentationUrl: string;
  supportUrl: string;
  privacyUrl: string;
  termsUrl: string;
  screenshots: PluginScreenshot[];
  tags: string[];
  dependencies: Array<{ slug: string; minVersion?: string }>;
  developerBio: string;
  verification: VerificationResult | null;
  reviewNotes: string | null;
}

export default async function PublishWizardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (
    !roles ||
    !roles.some((r) =>
      ['DEVELOPER', 'ADMIN', 'SUPER_ADMIN', 'MERCHANT', 'MERCHANT_STAFF'].includes(r),
    )
  ) {
    redirect('/unauthorized');
  }
  const userId = (session.user as any)?.id as string;
  if (!userId) redirect('/login');

  const { id } = await params;
  const row = await db.extension.findUnique({ where: { id } });
  if (!row || row.developerId !== userId) {
    redirect('/developers/publish');
  }

  const meta = parseMarketplaceMeta(row.config);
  const plugin: WizardPluginData = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category as MarketplaceCategory,
    iconUrl: row.iconUrl,
    version: row.version,
    status: row.status,
    longDescription: meta.longDescription ?? '',
    manifest: meta.manifest ?? null,
    capabilities: meta.capabilities ?? [],
    permissions: (meta.permissions ?? []) as Permission[],
    pricing: meta.pricing ?? { model: 'free', summary: 'Free' },
    documentationUrl: meta.documentationUrl ?? '',
    supportUrl: meta.supportUrl ?? '',
    privacyUrl: meta.privacyUrl ?? '',
    termsUrl: meta.termsUrl ?? '',
    screenshots: meta.screenshots ?? [],
    tags: meta.tags ?? [],
    dependencies: meta.dependencies ?? [],
    developerBio: meta.developerBio ?? '',
    verification: meta.verification ?? null,
    reviewNotes: row.reviewNotes,
  };

  return <PublishWizard plugin={plugin} />;
}
