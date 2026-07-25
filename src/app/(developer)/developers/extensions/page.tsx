import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { PageHeader } from '@/components/role-ui';
import { Boxes, Puzzle } from 'lucide-react';
import { DeveloperExtensionsManager } from './extensions-manager';

export const dynamic = 'force-dynamic';

/**
 * Best-effort JSON parse — returns null on bad input.
 */
function safeJson<T = unknown>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export interface DeveloperExtension {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  iconUrl: string | null;
  version: string;
  status: string;
  permissions: string[];
  pricing: string;
  price: number;
  config: Record<string, unknown> | null;
  changelog: Array<{ version: string; date: string; changes: string }>;
  installCount: number;
  rating: number;
  reviewCount: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export default async function DeveloperExtensionsPage() {
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

  // Pull every extension this developer has created, newest first.
  const rows = await db.extension.findMany({
    where: { developerId: userId },
    orderBy: { updatedAt: 'desc' },
  });

  const extensions: DeveloperExtension[] = rows.map((e) => ({
    id: e.id,
    slug: e.slug,
    name: e.name,
    description: e.description,
    category: e.category,
    iconUrl: e.iconUrl,
    version: e.version,
    status: e.status,
    permissions: safeJson<string[]>(e.permissions) ?? [],
    pricing: e.pricing,
    price: e.price,
    config: safeJson<Record<string, unknown>>(e.config),
    changelog:
      safeJson<Array<{ version: string; date: string; changes: string }>>(e.changelog) ??
      [],
    installCount: e.installCount,
    rating: e.rating,
    reviewCount: e.reviewCount,
    submittedAt: e.submittedAt ? e.submittedAt.toISOString() : null,
    reviewedAt: e.reviewedAt ? e.reviewedAt.toISOString() : null,
    reviewNotes: e.reviewNotes,
    publishedAt: e.publishedAt ? e.publishedAt.toISOString() : null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  }));

  const stats = {
    total: extensions.length,
    published: extensions.filter((e) => e.status === 'published').length,
    inReview: extensions.filter((e) =>
      ['submitted', 'review', 'approved'].includes(e.status),
    ).length,
    drafts: extensions.filter((e) => e.status === 'draft').length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Extension builder"
        description="Build, submit and manage the extensions you publish to the PaySwap marketplace."
      />

      {extensions.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/50 p-10">
          <div className="mx-auto flex max-w-md flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Puzzle className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-base font-semibold">No extensions yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first extension to publish it to the PaySwap marketplace
              and reach thousands of merchants across Africa.
            </p>
            <div className="mt-5 w-full">
              <DeveloperExtensionsManager extensions={[]} stats={stats} />
            </div>
          </div>
        </div>
      ) : (
        <DeveloperExtensionsManager extensions={extensions} stats={stats} />
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-card/50 p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Boxes className="h-3.5 w-3.5" /> Total extensions
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{stats.total}</div>
        </div>
        <div className="rounded-lg border bg-card/50 p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Published
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {stats.published}
          </div>
        </div>
        <div className="rounded-lg border bg-card/50 p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            In review
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {stats.inReview}
          </div>
        </div>
      </div>
    </div>
  );
}
