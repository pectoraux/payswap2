/**
 * Plugin Catalog Service.
 *
 * The catalog is the data-access layer for the public marketplace. It reads
 * from the existing Prisma `Extension` table (filtering by the
 * `marketplace: true` flag in the `config` JSON column), writes reviews +
 * installs via the existing `ExtensionReview` / `ExtensionInstall` tables,
 * and persists verification results back into the `config` JSON.
 *
 * Public methods (no auth required):
 *   - getFeatured()
 *   - getPopular(limit)
 *   - getNewest(limit)
 *   - getByCategory(category)
 *   - search(query, filters)
 *   - getPlugin(slug)
 *   - getDeveloper(developerId)
 *   - getReviews(pluginId)
 *
 * Authenticated methods:
 *   - install(pluginId, merchantId, permissionsGranted)
 *   - addReview(pluginId, userId, rating, comment)
 *
 * Internal methods (used by the API routes + admin UI):
 *   - toPublicPlugin(row, devMap?) — convert an Extension row to a PublicPlugin
 *   - listAllForAdmin() — list every marketplace plugin (any status)
 *   - listByDeveloper(developerId) — list a developer's plugins
 *   - saveVerification(pluginId, result) — persist a verification result
 */

import { db } from '@/lib/db';
import { getFeaturedIds, setFeatured } from '@/lib/extension-featured';
import type { Extension } from '@prisma/client';
import type {
  CapabilityDeclaration,
  CapabilityType,
  Permission,
} from '@/sdk/types';
import {
  MARKETPLACE_CATEGORIES,
  type MarketplaceCategory,
  type MarketplaceMeta,
  type PublicPlugin,
  type PluginReview,
  type DeveloperProfile,
  type InstallResult,
  type SearchFilters,
  type VerificationResult,
  type PluginVersionEntry,
  type PricingPlan,
  parseMarketplaceMeta,
  parseChangelog,
} from './types';

/** Default pricing plan when none is set. */
const DEFAULT_PRICING: PricingPlan = { model: 'free', summary: 'Free' };

/**
 * Convert an Extension DB row to a PublicPlugin.
 *
 * `devName`/`devVerified` are passed in to avoid N+1 queries when converting
 * a list of extensions.
 */
export function toPublicPlugin(
  row: Extension,
  opts?: { devName?: string; devVerified?: boolean; featuredSet?: Set<string> },
): PublicPlugin {
  const meta = parseMarketplaceMeta(row.config);
  const capabilities = (meta.capabilities ?? meta.manifest?.capabilities ?? []) as CapabilityDeclaration[];
  const permissions = (meta.permissions ?? meta.manifest?.permissions ?? []) as Permission[];
  const pricing = meta.pricing ?? DEFAULT_PRICING;
  const featured = opts?.featuredSet
    ? opts.featuredSet.has(row.id)
    : (meta.featured ?? false);
  const changelog = parseChangelog(row.changelog);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    longDescription: meta.longDescription ?? row.description,
    category: (row.category as MarketplaceCategory) ?? 'analytics-pack',
    iconUrl: row.iconUrl,
    version: row.version,
    developerId: row.developerId,
    developerName: opts?.devName ?? 'Unknown',
    developerVerified: opts?.devVerified ?? false,
    status: row.status,
    capabilities,
    capabilityTypes: Array.from(new Set(capabilities.map((c) => c.type))) as CapabilityType[],
    permissions,
    pricing,
    documentationUrl: meta.documentationUrl ?? '',
    screenshots: meta.screenshots ?? [],
    tags: meta.tags ?? [],
    dependencies: meta.dependencies ?? [],
    changelog,
    installCount: row.installCount,
    rating: row.rating,
    reviewCount: row.reviewCount,
    featured,
    verification: meta.verification ?? null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Batch-resolve developer name + verified status for a set of developer IDs.
 * Returns a Map keyed by developerId.
 *
 * "Verified" is determined by the developer having a DEVELOPER role + an
 * email ending in a non-public domain (not @gmail.com, @yahoo.com, etc.).
 * In a real platform this would be a KYC-style verification badge.
 */
async function resolveDevelopers(
  developerIds: string[],
): Promise<
  Map<string, { name: string; email: string; verified: boolean; avatarUrl: string | null; createdAt: Date }>
> {
  if (developerIds.length === 0) return new Map();
  const users = await db.user.findMany({
    where: { id: { in: developerIds } },
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      createdAt: true,
      roles: { select: { role: true } },
    },
  });
  const PUBLIC_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'];
  const map = new Map<string, { name: string; email: string; verified: boolean; avatarUrl: string | null; createdAt: Date }>();
  for (const u of users) {
    const hasDeveloperRole = u.roles.some((r) => r.role === 'DEVELOPER' || r.role === 'ADMIN' || r.role === 'SUPER_ADMIN');
    const domain = (u.email ?? '').split('@')[1]?.toLowerCase() ?? '';
    const verified = hasDeveloperRole && !PUBLIC_DOMAINS.includes(domain);
    map.set(u.id, {
      name: u.name ?? u.email.split('@')[0],
      email: u.email,
      verified,
      avatarUrl: u.avatarUrl,
      createdAt: u.createdAt,
    });
  }
  return map;
}

/**
 * Process-wide singleton catalog service. Uses Prisma directly (no in-memory
 * cache) so reads are always fresh — the marketplace has low read traffic
 * and SQLite is fast.
 */
export class PluginCatalog {
  // ── Public browse methods ───────────────────────────────────────────────

  /** Featured plugins (admin-curated). */
  async getFeatured(limit: number = 12): Promise<PublicPlugin[]> {
    const featuredSet = await getFeaturedIds();
    if (featuredSet.size === 0) return [];
    const rows = await db.extension.findMany({
      where: {
        id: { in: Array.from(featuredSet) },
        status: 'published',
      },
      take: limit,
      orderBy: { installCount: 'desc' },
    });
    return this.decorate(rows, featuredSet);
  }

  /** Most-installed plugins. */
  async getPopular(limit: number = 12): Promise<PublicPlugin[]> {
    const rows = await db.extension.findMany({
      where: { status: 'published' },
      orderBy: { installCount: 'desc' },
      take: limit,
    });
    return this.decorate(rows);
  }

  /** Newest published plugins. */
  async getNewest(limit: number = 12): Promise<PublicPlugin[]> {
    const rows = await db.extension.findMany({
      where: { status: 'published' },
      orderBy: { publishedAt: 'desc' },
      take: limit,
    });
    return this.decorate(rows);
  }

  /** All plugins in a category (published only). */
  async getByCategory(category: string, limit: number = 100): Promise<PublicPlugin[]> {
    const rows = await db.extension.findMany({
      where: { status: 'published', category },
      orderBy: { installCount: 'desc' },
      take: limit,
    });
    return this.decorate(rows);
  }

  /** Full-text search across name, description, capabilities, tags. */
  async search(query: string, filters: SearchFilters = {}): Promise<PublicPlugin[]> {
    const q = query.trim().toLowerCase();
    let rows = await db.extension.findMany({
      where: { status: 'published' },
    });

    // Text filter (across name + description; capabilities/tags are JSON so we
    // filter in-memory after parsing).
    if (q) {
      rows = rows.filter((r) => {
        const meta = parseMarketplaceMeta(r.config);
        const haystacks = [
          r.name.toLowerCase(),
          r.description.toLowerCase(),
          r.slug.toLowerCase(),
          ...(meta.tags ?? []).map((t) => t.toLowerCase()),
          ...(meta.capabilities ?? meta.manifest?.capabilities ?? []).map((c) =>
            `${c.id} ${c.name} ${c.type}`.toLowerCase(),
          ),
        ];
        return haystacks.some((h) => h.includes(q));
      });
    }

    // Category filter.
    if (filters.category && filters.category !== 'all') {
      rows = rows.filter((r) => r.category === filters.category);
    }

    // Pricing filter.
    if (filters.pricing && filters.pricing !== 'all') {
      rows = rows.filter((r) => {
        const meta = parseMarketplaceMeta(r.config);
        const plan = meta.pricing ?? DEFAULT_PRICING;
        if (filters.pricing === 'free') return plan.model === 'free';
        return plan.model === filters.pricing;
      });
    }
    if (filters.free) {
      rows = rows.filter((r) => {
        const meta = parseMarketplaceMeta(r.config);
        const plan = meta.pricing ?? DEFAULT_PRICING;
        return plan.model === 'free';
      });
    }

    // Min rating.
    if (typeof filters.minRating === 'number') {
      rows = rows.filter((r) => r.rating >= filters.minRating!);
    }

    // Capability type.
    if (filters.capabilityType && filters.capabilityType !== 'all') {
      rows = rows.filter((r) => {
        const meta = parseMarketplaceMeta(r.config);
        const caps = meta.capabilities ?? meta.manifest?.capabilities ?? [];
        return caps.some((c) => c.type === filters.capabilityType);
      });
    }

    // Default sort: popularity.
    rows.sort((a, b) => b.installCount - a.installCount);

    return this.decorate(rows.slice(0, 200));
  }

  /** Get a single plugin by slug (public). */
  async getPlugin(slug: string): Promise<PublicPlugin | null> {
    const row = await db.extension.findUnique({ where: { slug } });
    if (!row) return null;
    if (row.status !== 'published') return null;
    const [decorated] = await this.decorate([row]);
    return decorated ?? null;
  }

  /** Get a developer profile + their published plugins. */
  async getDeveloper(developerId: string): Promise<{
    profile: DeveloperProfile | null;
    plugins: PublicPlugin[];
  }> {
    const devMap = await resolveDevelopers([developerId]);
    const dev = devMap.get(developerId);
    if (!dev) return { profile: null, plugins: [] };

    const rows = await db.extension.findMany({
      where: { developerId, status: 'published' },
      orderBy: { installCount: 'desc' },
    });

    const plugins = await this.decorate(rows, undefined, devMap);
    const aggregateRating =
      plugins.length > 0
        ? Math.round(
            (plugins.reduce((s, p) => s + p.rating, 0) / plugins.length) * 10,
          ) / 10
        : 0;
    const totalInstalls = plugins.reduce((s, p) => s + p.installCount, 0);

    const profile: DeveloperProfile = {
      id: developerId,
      name: dev.name,
      email: dev.email,
      avatarUrl: dev.avatarUrl,
      bio: '',
      verified: dev.verified,
      aggregateRating,
      totalInstalls,
      pluginCount: plugins.length,
      joinedAt: dev.createdAt.toISOString(),
    };

    return { profile, plugins };
  }

  // ── Public review methods ───────────────────────────────────────────────

  /** List all reviews for a plugin (newest first). */
  async getReviews(pluginId: string): Promise<PluginReview[]> {
    const rows = await db.extensionReview.findMany({
      where: { extensionId: pluginId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true, email: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      pluginId: r.extensionId,
      userId: r.userId,
      userName: r.user?.name ?? r.user?.email ?? 'Anonymous',
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ── Authenticated methods ───────────────────────────────────────────────

  /**
   * Install a plugin for a merchant. The merchant must grant every permission
   * the plugin declares (consent gate).
   *
   * Returns an InstallResult with `ok: true` on success.
   */
  async install(
    pluginId: string,
    merchantId: string,
    permissionsGranted: string[],
  ): Promise<InstallResult> {
    const plugin = await db.extension.findUnique({ where: { id: pluginId } });
    if (!plugin) {
      return { ok: false, pluginId, merchantId, status: 'error', error: 'Plugin not found' };
    }
    if (plugin.status !== 'published') {
      return {
        ok: false,
        pluginId,
        merchantId,
        status: 'error',
        error: 'Only published plugins can be installed',
      };
    }

    const meta = parseMarketplaceMeta(plugin.config);
    const declaredPerms = (meta.permissions ?? meta.manifest?.permissions ?? []) as string[];

    // Consent gate: every declared permission must be granted (for new installs).
    const existing = await db.extensionInstall.findUnique({
      where: { extensionId_merchantId: { extensionId: pluginId, merchantId } },
    });
    if (!existing && declaredPerms.length > 0) {
      const missing = declaredPerms.filter((p) => !permissionsGranted.includes(p));
      if (missing.length > 0) {
        return {
          ok: false,
          pluginId,
          merchantId,
          status: 'error',
          error: 'Permissions consent required',
        };
      }
    }

    const installConfig: Record<string, unknown> = {};
    if (permissionsGranted.length > 0) {
      installConfig.__grantedPermissions = permissionsGranted;
    }
    const installConfigJson =
      Object.keys(installConfig).length > 0 ? JSON.stringify(installConfig) : null;

    let install;
    if (existing) {
      install = await db.extensionInstall.update({
        where: { id: existing.id },
        data: { status: 'enabled', config: installConfigJson },
      });
    } else {
      install = await db.extensionInstall.create({
        data: {
          extensionId: pluginId,
          merchantId,
          status: 'enabled',
          config: installConfigJson,
        },
      });
      await db.extension.update({
        where: { id: pluginId },
        data: { installCount: { increment: 1 } },
      });
    }

    return {
      ok: true,
      installId: install.id,
      pluginId,
      merchantId,
      status: install.status,
    };
  }

  /**
   * Add a review. The user must have installed the plugin (we don't enforce
   * this at the catalog level — the API route does). Recomputes the plugin's
   * aggregate rating + review count.
   */
  async addReview(
    pluginId: string,
    userId: string,
    rating: number,
    comment: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (rating < 1 || rating > 5) {
      return { ok: false, error: 'Rating must be between 1 and 5' };
    }
    if (!comment || comment.trim().length < 3) {
      return { ok: false, error: 'Comment must be at least 3 characters' };
    }

    const plugin = await db.extension.findUnique({ where: { id: pluginId } });
    if (!plugin) return { ok: false, error: 'Plugin not found' };

    await db.extensionReview.create({
      data: {
        extensionId: pluginId,
        userId,
        rating: Math.round(rating),
        comment: comment.trim(),
      },
    });

    // Recompute aggregate.
    const reviews = await db.extensionReview.findMany({
      where: { extensionId: pluginId },
      select: { rating: true },
    });
    const avg =
      reviews.length > 0
        ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
        : 0;
    await db.extension.update({
      where: { id: pluginId },
      data: { rating: avg, reviewCount: reviews.length },
    });

    return { ok: true };
  }

  // ── Internal: admin + developer helpers ─────────────────────────────────

  /** List ALL marketplace plugins (any status) — admin only. */
  async listAllForAdmin(): Promise<PublicPlugin[]> {
    const rows = await db.extension.findMany({
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    // Filter to marketplace plugins only.
    const marketplaceRows = rows.filter((r) => {
      const meta = parseMarketplaceMeta(r.config);
      return meta.marketplace === true;
    });
    return this.decorate(marketplaceRows);
  }

  /** List all marketplace plugins for a developer (any status). */
  async listByDeveloper(developerId: string): Promise<PublicPlugin[]> {
    const rows = await db.extension.findMany({
      where: { developerId },
      orderBy: { updatedAt: 'desc' },
    });
    const marketplaceRows = rows.filter((r) => {
      const meta = parseMarketplaceMeta(r.config);
      return meta.marketplace === true;
    });
    return this.decorate(marketplaceRows);
  }

  /** List plugins pending review (status = submitted | static_analysis | security_scan | review | approved). */
  async listPendingReview(): Promise<PublicPlugin[]> {
    const rows = await db.extension.findMany({
      where: {
        status: {
          in: ['submitted', 'static_analysis', 'security_scan', 'review', 'approved'],
        },
      },
      orderBy: { submittedAt: 'asc' },
    });
    const marketplaceRows = rows.filter((r) => {
      const meta = parseMarketplaceMeta(r.config);
      return meta.marketplace === true;
    });
    return this.decorate(marketplaceRows);
  }

  /**
   * Persist a verification result into the plugin's config JSON.
   * Returns the updated PublicPlugin.
   */
  async saveVerification(
    pluginId: string,
    result: VerificationResult,
  ): Promise<PublicPlugin | null> {
    const row = await db.extension.findUnique({ where: { id: pluginId } });
    if (!row) return null;
    const meta = parseMarketplaceMeta(row.config);
    meta.verification = result;
    await db.extension.update({
      where: { id: pluginId },
      data: { config: JSON.stringify(meta) },
    });
    const [updated] = await this.decorate([row.id === pluginId ? { ...row, config: JSON.stringify(meta) } : row]);
    return updated ?? null;
  }

  /** Toggle the featured flag for a plugin (admin only). */
  async setFeatured(pluginId: string, value: boolean): Promise<boolean> {
    return setFeatured(pluginId, value);
  }

  // ── Internals ───────────────────────────────────────────────────────────

  /**
   * Decorate a list of Extension rows into PublicPlugin[] with developer
   * info + featured flag resolved.
   */
  private async decorate(
    rows: Extension[],
    featuredSet?: Set<string>,
    devMap?: Map<string, { name: string; email: string; verified: boolean; avatarUrl: string | null; createdAt: Date }>,
  ): Promise<PublicPlugin[]> {
    if (rows.length === 0) return [];

    const devIds = Array.from(new Set(rows.map((r) => r.developerId)));
    const [resolvedDevs, featured] = await Promise.all([
      devMap ?? resolveDevelopers(devIds),
      featuredSet ?? getFeaturedIds(),
    ]);

    return rows.map((row) => {
      const dev = resolvedDevs.get(row.developerId);
      return toPublicPlugin(row, {
        devName: dev?.name,
        devVerified: dev?.verified,
        featuredSet: featured,
      });
    });
  }
}

/** Process-wide singleton. */
export const pluginCatalog = new PluginCatalog();

/** Convenience: list of all valid marketplace category keys. */
export const MARKETPLACE_CATEGORY_KEYS: string[] = [...MARKETPLACE_CATEGORIES];

/** Check whether a string is a valid marketplace category. */
export function isValidMarketplaceCategory(key: string): key is MarketplaceCategory {
  return (MARKETPLACE_CATEGORIES as readonly string[]).includes(key);
}

/** Convenience: parse a PricingPlan from a meta blob (with default fallback). */
export function pricingFromMeta(meta: MarketplaceMeta): PricingPlan {
  return meta.pricing ?? DEFAULT_PRICING;
}

/** Convenience: parse a PluginVersionEntry[] from a meta blob. */
export function changelogFromMeta(meta: MarketplaceMeta): PluginVersionEntry[] {
  return meta.manifest?.migrations?.map((m) => ({
    version: m.version,
    date: new Date().toISOString(),
    changes: m.description,
  })) ?? [];
}
