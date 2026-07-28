import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { resolveDeveloperMerchantId } from '@/lib/developer-context';
import { PageHeader } from '@/components/role-ui';
import { ApiKeysManager, type ApiKeyView } from './api-keys-manager';

export const dynamic = 'force-dynamic';

export default async function DeveloperApiKeysPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) redirect('/login');

  const merchantId = await resolveDeveloperMerchantId(userId);
  const rows = merchantId
    ? await db.apiKey.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  const apiKeys: ApiKeyView[] = rows.map((k) => ({
    id: k.id,
    label: k.label,
    keyPrefix: k.keyPrefix,
    scopes: k.scopes,
    status: k.status,
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    createdAt: k.createdAt.toISOString(),
    expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Keys"
        description="Authenticate every API request. Test keys never move real money — use them in your dev environment."
      />
      <ApiKeysManager initialKeys={apiKeys} />
    </div>
  );
}
