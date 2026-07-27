import { cookies } from 'next/headers';

/**
 * Get the current environment (sandbox/live) from the cookie.
 *
 * Defaults to `'sandbox'` when the cookie is absent or holds an unknown
 * value — this matches the client-side default in
 * `src/components/env-switcher.tsx` (`readStoredMode` + `getServerSnapshot`)
 * and the RuntimeHost's initial `activeEnvironment` in
 * `src/runtime/host/runtime-host.ts`. Sandbox is the safe default: no real
 * funds move until the user explicitly opts into Live.
 *
 * The EnvSwitcher component sets this cookie client-side via document.cookie
 * whenever the user toggles environments (and also POSTs to
 * `/api/runtime/host` so the in-memory RuntimeHost follows along).
 */
export async function getEnvironment(): Promise<string> {
  const cookieStore = await cookies();
  const envCookie = cookieStore.get('payswap-env-mode');
  return envCookie?.value === 'live' ? 'live' : 'sandbox';
}
