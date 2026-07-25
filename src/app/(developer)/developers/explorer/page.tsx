import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireMerchantId } from '@/lib/api-auth';
import { ApiExplorer } from './api-explorer';

export const dynamic = 'force-dynamic';

/**
 * API Explorer page.
 *
 * The page is a thin server wrapper that resolves the caller's merchantId (so
 * we can prefill the `/api/merchant/state` path) and hands off to the
 * interactive client component, which makes real same-origin fetch() calls.
 */
export default async function DeveloperExplorerPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const merchantId = await requireMerchantId();

  return <ApiExplorer merchantId={merchantId} />;
}
