/**
 * Live connector types — shared across all real API integrations.
 *
 * Every live test returns a `LiveTestResult` so the UI can render them
 * uniformly. All connectors are server-side only (never 'use client').
 */

export interface LiveTestResult<T = Record<string, unknown>> {
  provider: string;
  operation: string;
  success: boolean;
  /** HTTP status code (or synthetic code for SDK calls). */
  status: number;
  /** Round-trip latency in milliseconds. */
  latencyMs: number;
  /** The sandbox/test environment used. */
  environment: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Structured payload returned by the provider. */
  data?: T;
  /** Human-readable summary of what happened. */
  summary: string;
  /** Error message when success=false. */
  error?: string;
  /** The raw provider response (redacted of sensitive data). */
  rawResponse?: unknown;
  /** A redacted request preview (no full secrets). */
  requestPreview?: Record<string, unknown>;
}

/** Read an env var, throwing a clear error if missing. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/** Redact a key for display — show only first 8 + last 4 chars. */
export function redactKey(key: string): string {
  if (!key || key.length < 16) return '****';
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/** Time a promise and return { result, latencyMs }. */
export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - start };
}
