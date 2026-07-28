import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { resolveDeveloperMerchantId } from '@/lib/developer-context';
import { ApiExplorer } from './api-explorer';

export const dynamic = 'force-dynamic';

/**
 * API Explorer page.
 *
 * The page is a thin server wrapper that resolves the caller's merchantId (so
 * we can prefill the `/api/merchant/state` path) and hands off to the
 * interactive client component, which makes real same-origin fetch() calls.
 *
 * Developers don't carry a MERCHANT role — they get the developer sandbox
 * merchant via `resolveDeveloperMerchantId` so they can exercise the full
 * merchant API surface (create payment, list payouts, etc.) from the
 * explorer without first being promoted to a MERCHANT.
 */
export default async function DeveloperExplorerPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) redirect('/login');
  const merchantId = await resolveDeveloperMerchantId(userId);

  return <ApiExplorer merchantId={merchantId} />;
}
