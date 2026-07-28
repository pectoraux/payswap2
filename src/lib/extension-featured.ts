/**
 * Featured-extensions store.
 *
 * The Prisma schema does NOT have a `featured` boolean on `Extension`.
 * We track featured IDs in an in-memory Set. This avoids using Node.js
 * `fs`/`path` modules (which break client-side bundling).
 *
 * The data is process-scoped — it resets on server restart. For production
 * persistence, this should be moved to a DB column or Redis.
 */

// Use globalThis to survive HMR in dev mode
const globalForFeatured = globalThis as unknown as {
  __featuredExtensions?: Set<string>;
};

const cache: Set<string> = globalForFeatured.__featuredExtensions ?? new Set<string>();
globalForFeatured.__featuredExtensions = cache;

// Seed with some defaults on first access
if (cache.size === 0) {
  // Mark a few extensions as featured by default (based on seed data slugs)
  cache.add('slack-notifications');
  cache.add('quickbooks-sync');
  cache.add('advanced-analytics');
}

export async function getFeaturedIds(): Promise<Set<string>> {
  return cache;
}

export async function isFeatured(id: string): Promise<boolean> {
  return cache.has(id);
}

export async function setFeatured(id: string, value: boolean): Promise<boolean> {
  if (value) cache.add(id);
  else cache.delete(id);
  return value;
}

export async function toggleFeatured(id: string): Promise<boolean> {
  const next = !cache.has(id);
  return setFeatured(id, next);
}
