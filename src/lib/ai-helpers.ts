import ZAI from 'z-ai-web-dev-sdk';

/**
 * Shared helpers for the PaySwap Intelligence Layer.
 *
 * Every AI endpoint (insights, lp-recommendations, treasury, compliance) wraps
 * the z-ai-web-dev-sdk LLM call + a 5-minute in-memory cache + defensive JSON
 * parsing through these helpers so that:
 *
 *   1. The kernel stays frozen (no edits to `src/kernel/`).
 *   2. A failing LLM call degrades gracefully to computed fallback insights.
 *   3. Repeated dashboard loads don't re-prompt the model inside the TTL.
 *
 * The SDK is only ever imported here (server-only) — client components fetch
 * the JSON-shaped results over HTTP instead.
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/** Return a cached value if it exists and is still fresh, else null. */
export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

/** Store a value in the cache with the current timestamp. */
export function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, ts: Date.now() });
}

/** Invalidate a single cache key (used by the `?refresh=1` query param). */
export function bustCache(key: string): void {
  cache.delete(key);
}

/**
 * Call the LLM with a system + user message pair and return the raw text.
 * Returns `null` if the SDK throws or the model returns empty content so
 * callers can fall back to computed insights without crashing.
 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      thinking: { type: 'disabled' },
    });
    const text = completion.choices[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    console.error('[ai-helpers] LLM call failed:', err);
    return null;
  }
}

/**
 * Best-effort parse of a JSON array from raw LLM output.
 *
 * Models occasionally wrap JSON in ```json fences or prefix it with prose, so
 * we try (1) a direct `JSON.parse`, then (2) stripping fences, then (3)
 * regex-extracting the first `[...]` block. Returns `null` when no valid
 * array can be recovered.
 */
export function parseJsonArray<T>(text: string | null): T[] | null {
  if (!text) return null;

  const tryParse = (snippet: string): T[] | null => {
    try {
      const parsed = JSON.parse(snippet);
      return Array.isArray(parsed) ? (parsed as T[]) : null;
    } catch {
      return null;
    }
  };

  // 1. Direct parse.
  const direct = tryParse(text.trim());
  if (direct) return direct;

  // 2. Strip markdown code fences.
  const fenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const stripped = tryParse(fenced);
  if (stripped) return stripped;

  // 3. Extract the first JSON array found anywhere in the text.
  const match = fenced.match(/\[[\s\S]*\]/);
  if (match) {
    const extracted = tryParse(match[0]);
    if (extracted) return extracted;
  }

  return null;
}

/**
 * Clamp a number into the `[lo, hi]` range. Used by fallback insight
 * computations that mirror the merchant health-score formula.
 */
export function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}
