/**
 * Runtime — core types. (M-RT-1 foundation.)
 *
 * These are the vocabulary types every runtime component uses.
 */

/** The execution environment. Sandbox is for testing/simulation; live is production. */
export type Environment = 'sandbox' | 'live';

/** Who is asking the runtime to do something. */
export interface Actor {
  id: string;
  role: string;
}

/** Where the request came from. */
export type IntentSource = 'dashboard' | 'api' | 'sdk' | 'cli' | 'webhook' | 'system' | 'extension';

/** The context surrounding a request (for tracing + auth). */
export interface RequestContext {
  actor: Actor;
  environment: Environment;
  source: IntentSource;
  correlationId: string;
  causationId?: string;
}

/** Generate a unique ID with a prefix. */
export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
