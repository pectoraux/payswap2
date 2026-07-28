import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/role-ui';
import {
  TreasuryEmergencyConsole,
  type EmergencyStatusData,
} from '@/components/treasury/treasury-emergency-console';
import { treasuryEmergencyService } from '@/treasury/emergency-store';
import { db } from '@/lib/db';
import { ShieldAlert } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Treasury Emergency Freeze page.
 *
 * Combines:
 *   1. Active freezes (in-memory store + AuditLog-derived)
 *   2. Freeze form (target type, target ID, reason, optional duration)
 *   3. Quick freeze actions (country / corridor / reserve / wallet)
 *   4. Lifted history + audit trail
 *
 * Server-side data is fetched from the in-memory treasury emergency store
 * and the AuditLog; the client console handles freeze + unfreeze interactions.
 */
export default async function TreasuryEmergencyPage() {
  const session = await getServerSession(authOptions);
  const roles = ((session?.user as any)?.roles as string[] | undefined) ?? [];
  const isAdmin = roles.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r));

  const now = Date.now();
  const all = treasuryEmergencyService.list();
  const active = all
    .filter(
      (f) =>
        f.status === 'active' &&
        (f.expiresAt === undefined || f.expiresAt > now),
    )
    .sort((a, b) => b.frozenAt - a.frozenAt);
  const expired = all.filter(
    (f) =>
      f.status === 'active' &&
      f.expiresAt !== undefined &&
      f.expiresAt <= now,
  );
  const lifted = all
    .filter((f) => f.status === 'lifted')
    .sort((a, b) => (b.liftedAt ?? 0) - (a.liftedAt ?? 0));

  // Audit trail — fetch recent freeze/unfreeze events from AuditLog.
  let auditTrail: EmergencyStatusData['auditTrail'] = [];
  try {
    const logs = await db.auditLog.findMany({
      where: {
        OR: [
          { action: { startsWith: 'TREASURY.EMERGENCY_FREEZE_' } },
          { action: 'TREASURY.EMERGENCY_UNFREEZE' },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: true },
    });
    auditTrail = logs.map((l) => {
      let d: any = {};
      try {
        d = JSON.parse(l.details ?? '{}');
      } catch {
        d = {};
      }
      return {
        id: l.id,
        action: l.action,
        target: d.target ?? l.resourceType,
        targetId: d.targetId ?? l.resourceId,
        reason: d.reason,
        actorEmail: d.actorEmail ?? l.user?.email ?? undefined,
        createdAt: l.createdAt.toISOString(),
      };
    });
  } catch {
    // ignore
  }

  const serialize = (f: (typeof all)[number]) => ({
    ...f,
    frozenAt: new Date(f.frozenAt).toISOString(),
    expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null,
    liftedAt: f.liftedAt ? new Date(f.liftedAt).toISOString() : null,
    durationMs: f.durationMs ?? null,
  });

  const initial: EmergencyStatusData = {
    active: active.map(serialize),
    expired: expired.map(serialize),
    lifted: lifted.map(serialize),
    auditTrail,
    summary: {
      active: active.length,
      expired: expired.length,
      lifted: lifted.length,
    },
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Emergency freeze"
        description="Halt countries, corridors, reserves, or wallets in a single, fully-audited console."
      />

      {active.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.03] p-4">
          <ShieldAlert className="h-5 w-5 shrink-0 text-rose-500" />
          <div className="text-sm">
            <span className="font-semibold text-rose-600 dark:text-rose-400">
              {active.length} active freeze{active.length === 1 ? '' : 's'}
            </span>{' '}
            <span className="text-muted-foreground">
              in effect. Review and lift below when the situation is resolved.
            </span>
          </div>
        </div>
      )}

      <TreasuryEmergencyConsole initial={initial} isAdmin={isAdmin} />
    </div>
  );
}
