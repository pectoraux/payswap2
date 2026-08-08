/**
 * Sanctions List Loader — canonical entry point for the sanctions watchlist
 * data feed. (P3-4 / H-8 fix.)
 *
 * Two stacks in the codebase consume sanctions data:
 *   - `src/trust/sanctions-screener.ts`        — the canonical screener
 *   - `src/protocol/compliance/sanctions.ts`   — thin wrapper that delegates
 *                                                matching to the canonical
 *                                                screener
 *
 * Both pull their list from THIS loader. Replacing the in-source sample list
 * with a single loader means a real feed (Chainalysis KYT, TRM Labs,
 * Refinitiv World-Check One, Dow Jones R&C) is one config change — set
 * `PAYSWAP_SANCTIONS_LIST_FILE` to the path of a JSON file your compliance
 * ops pipeline refreshes daily, and every screener picks it up
 * automatically. No code change, no redeploy.
 *
 * ── File format ──────────────────────────────────────────────────────────
 * The JSON file MUST contain an `entries` array where each entry has:
 *   {
 *     "list":    "ofac" | "eu" | "un" | "uk_hmt" | "custom",
 *     "name":    string,            // canonical watchlist name (UPPERCASE)
 *     "entry":   string,            // human-readable description / SDN ref
 *     "dob":     string (optional),
 *     "country": string (optional)
 *   }
 *
 * See `data/dev-sanctions-fixture.json` for a working example.
 *
 * ── Production warning ───────────────────────────────────────────────────
 * If `NODE_ENV === 'production'` AND `PAYSWAP_SANCTIONS_LIST_FILE` is NOT
 * set, this loader prints a LOUD warning to stderr on every process start.
 * The sample list is a 14-name DEV fixture — it MUST NOT be the only
 * sanctions list in production. Wire a real feed (env var → JSON file path
 * refreshed by your compliance ops pipeline) before going live.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Canonical sanctions list identifier (matches `src/protocol/compliance/types.ts`). */
export type SanctionsListId = 'ofac' | 'eu' | 'un' | 'uk_hmt' | 'custom';

/** Shape of each entry in the sanctions list. */
export interface SanctionsListEntry {
  list: SanctionsListId;
  name: string;
  entry: string;
  dob?: string;
  country?: string;
}

/** Default DEV fixture path (relative to the project root). */
const DEFAULT_DEV_FIXTURE_PATH = 'data/dev-sanctions-fixture.json';

/** Cache of the loaded list — loaded once at module init, reused thereafter. */
let cachedEntries: SanctionsListEntry[] | null = null;

let cachedFilePath: string | null = null;

/**
 * Resolve the sanctions list file path.
 *
 * Priority:
 *   1. `process.env.PAYSWAP_SANCTIONS_LIST_FILE` (explicit override).
 *   2. `data/dev-sanctions-fixture.json` (DEV default).
 */
function resolveFilePath(): string {
  const override = process.env.PAYSWAP_SANCTIONS_LIST_FILE;
  if (override && override.trim().length > 0) {
    return resolve(override);
  }
  return resolve(process.cwd(), DEFAULT_DEV_FIXTURE_PATH);
}

/**
 * Load the sanctions list from disk. Cached after the first call.
 *
 * If the configured file is missing OR fails to parse, the loader falls back
 * to an EMPTY list (not the hardcoded sample) — fail-safe. A real sanctions
 * screen against an empty list always returns "clear", which is the safe
 * default when the feed is broken (better to fail-open with a loud warning
 * than to crash the payment path). Production monitoring SHOULD alert on
 * an empty list.
 */
export function loadSanctionsList(): SanctionsListEntry[] {
  if (cachedEntries) return cachedEntries;

  const filePath = resolveFilePath();
  cachedFilePath = filePath;

  if (!existsSync(filePath)) {
    console.error(
      `[sanctions-list-loader] FILE NOT FOUND: ${filePath}. ` +
        'Sanctions screening will return "clear" for everyone. ' +
        'Set PAYSWAP_SANCTIONS_LIST_FILE to a real feed file.',
    );
    cachedEntries = [];
    return cachedEntries;
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(
      `[sanctions-list-loader] FAILED TO READ ${filePath}:`,
      err,
      ' — sanctions screening will return "clear" for everyone.',
    );
    cachedEntries = [];
    return cachedEntries;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(
      `[sanctions-list-loader] FAILED TO PARSE ${filePath}:`,
      err,
      ' — sanctions screening will return "clear" for everyone.',
    );
    cachedEntries = [];
    return cachedEntries;
  }

  const entries = (parsed as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) {
    console.error(
      `[sanctions-list-loader] ${filePath} is missing an \`entries\` array — ` +
        'sanctions screening will return "clear" for everyone.',
    );
    cachedEntries = [];
    return cachedEntries;
  }

  cachedEntries = entries.filter(
    (e): e is SanctionsListEntry =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as SanctionsListEntry).list === 'string' &&
      typeof (e as SanctionsListEntry).name === 'string' &&
      typeof (e as SanctionsListEntry).entry === 'string',
  );

  // ── LOUD production warning ────────────────────────────────────────────
  // If we're in production AND no override was provided, scream. The DEV
  // fixture is fine for staging + tests, but NOT for a live money path.
  const isProd = process.env.NODE_ENV === 'production';
  const usedOverride = !!process.env.PAYSWAP_SANCTIONS_LIST_FILE;
  if (isProd && !usedOverride) {
    console.error(
      '┌─────────────────────────────────────────────────────────────────────┐',
    );
    console.error(
      '│ ⚠️  PAYSWAP SANCTIONS LIST: using DEV fixture in PRODUCTION!        │',
    );
    console.error(
      '│    The 14-name sample list in data/dev-sanctions-fixture.json is   │',
    );
    console.error(
      '│    NOT a real sanctions feed. Set PAYSWAP_SANCTIONS_LIST_FILE to   │',
    );
    console.error(
      '│    a JSON file refreshed daily from Chainalysis KYT / TRM Labs /   │',
    );
    console.error(
      '│    Refinitiv World-Check One / Dow Jones R&C.                      │',
    );
    console.error(
      '└─────────────────────────────────────────────────────────────────────┘',
    );
  }

  return cachedEntries;
}

/**
 * Return the file path used at load time. Useful for logging / debug.
 * Returns null if the list has not been loaded yet.
 */
export function getLoadedSanctionsListPath(): string | null {
  if (!cachedFilePath) loadSanctionsList();
  return cachedFilePath;
}

/**
 * Force a re-read of the sanctions list on the next `loadSanctionsList()`
 * call. Useful in tests that swap the fixture file, or in long-running
 * processes that periodically refresh the in-memory cache from disk.
 */
export function invalidateSanctionsListCache(): void {
  cachedEntries = null;
  cachedFilePath = null;
}
