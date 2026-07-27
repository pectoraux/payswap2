import { promises as fs } from 'fs';
import path from 'path';

/**
 * Featured-extensions store.
 *
 * The Prisma schema (added by Task 2-prisma-fix) does NOT have a `featured`
 * boolean on `Extension`. The schema is frozen for this task, so we track
 * featured IDs in a JSON file on disk. The data is hot-cached in memory for
 * fast read access on every request.
 *
 * File:  <project-root>/data/featured-extensions.json
 * Shape: { "extensionId": true, ... }
 */

const FILE_PATH = path.join(process.cwd(), 'data', 'featured-extensions.json');

let cache: Set<string> | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<Set<string>> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    cache = new Set(
      Object.entries(parsed)
        .filter(([, v]) => v === true)
        .map(([k]) => k),
    );
  } catch {
    cache = new Set();
  }
  return cache;
}

async function persist(next: Set<string>): Promise<void> {
  // Serialize writes so concurrent toggles don't clobber each other.
  writeChain = writeChain.then(async () => {
    try {
      const obj: Record<string, boolean> = {};
      for (const id of next) obj[id] = true;
      await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
      await fs.writeFile(FILE_PATH, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      // Non-fatal — the in-memory cache still works for this server process.
      console.error('[extension-featured] persist failed:', err);
    }
  });
  await writeChain;
}

export async function getFeaturedIds(): Promise<Set<string>> {
  return load();
}

export async function isFeatured(id: string): Promise<boolean> {
  const set = await load();
  return set.has(id);
}

export async function setFeatured(id: string, value: boolean): Promise<boolean> {
  const set = await load();
  if (value) set.add(id);
  else set.delete(id);
  await persist(set);
  return value;
}

export async function toggleFeatured(id: string): Promise<boolean> {
  const set = await load();
  const next = !set.has(id);
  return setFeatured(id, next);
}
