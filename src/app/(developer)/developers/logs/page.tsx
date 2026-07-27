import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { resolveDeveloperMerchantId } from '@/lib/developer-context';
import { PageHeader } from '@/components/role-ui';
import { LogsViewer, type LogEntry } from './logs-viewer';

export const dynamic = 'force-dynamic';

export default async function DeveloperLogsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) redirect('/login');

  const merchantId = await resolveDeveloperMerchantId(userId);

  const where: any = {
    OR: [
      { userId },
      ...(merchantId ? [{ details: { contains: merchantId } }] : []),
    ],
  };

  const rows = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const logs: LogEntry[] = rows.map((l) => ({
    id: l.id,
    level:
      l.result === 'SUCCESS' ? 'INFO' : l.result === 'ERROR' ? 'ERROR' : 'WARN',
    source: l.resourceType || l.action,
    action: l.action,
    message: l.details ?? l.action,
    result: l.result,
    ip: l.ip ?? null,
    userAgent: l.userAgent ?? null,
    createdAt: l.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logs"
        description="Audit trail of every authenticated action — filter by level or search the message."
      />
      <LogsViewer initialLogs={logs} />
    </div>
  );
}
