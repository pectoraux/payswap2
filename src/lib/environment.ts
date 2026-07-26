import { cookies } from 'next/headers';

/**
 * Get the current environment (sandbox/live) from the cookie.
 * Defaults to 'live' if not set.
 * 
 * The EnvSwitcher component sets this cookie client-side via document.cookie
 * whenever the user toggles environments.
 */
export async function getEnvironment(): Promise<string> {
  const cookieStore = await cookies();
  const envCookie = cookieStore.get('payswap-env-mode');
  return envCookie?.value === 'sandbox' ? 'sandbox' : 'live';
}
