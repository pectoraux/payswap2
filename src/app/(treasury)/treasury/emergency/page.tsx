import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { PageHeader, EmptyState } from '@/components/role-ui';
import { EmergencyFreezeConsole, type ActiveFreeze } from '@/components/treasury/emergency-freeze-console';
import { Card, CardContent } from '@/components/ui/card';
import { ShieldAlert } from 'lucide-react';

export const dynamic = 'force-dynamic';

const FREEZE_ACTIONS = new Set([
  'TREASURY.FREEZE_ACCOUNT',
  'TREASURY.FREEZE_ASSET',
  'TREASURY.FREEZE_CORRIDOR',
]);

export default async function TreasuryEmergencyPage() {
  const session = await getServerSession(authOptions);
  const roles = ((session?.user as any)?.roles as string[] | undefined) ?? [];
  const isAdmin = roles.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r));

  // --- Distinct corridors (from payments) --------------------------------
  const corridorAgg = await db.payment.groupBy({
    by: ['corridor'],
    where: { NOT: { corridor: null } },
    _count: { _all: true },
    orderBy: { _count: { id: 'desc' } },
    take: 50,
  });
  const corridors = corridorAgg
    .map((c) => c.corridor)
    .filter((c): c is string => !!c);

  // --- Active freezes (derived from AuditLog) ----------------------------
  // Pull every TREASURY.FREEZE_* and TREASURY.UNFREEZE entry, then keep only
  // freezes whose freezeId has no later UNFREEZE entry.
  const [freezeLogs, unfreezeLogs] = await Promise.all([
    db.auditLog.findMany({
      where: { action: { in: [...FREEZE_ACTIONS] } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: true },
    }),
    db.auditLog.findMany({
      where: { action: 'TREASURY.UNFREEZE' },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { details: true, createdAt: true },
    }),
  ]);

  // Build a map of freezeId → latest unfreeze timestamp (if any).
  const liftedAt = new Map<string, number>();
  for (const u of unfreezeLogs) {
    try {
      const d = JSON.parse(u.details ?? '{}');
      if (typeof d.freezeId === 'string') {
        const ts = new Date(u.createdAt).getTime();
        const prev = liftedAt.get(d.freezeId);
        if (prev === undefined || ts > prev) liftedAt.set(d.freezeId, ts);
      }
    } catch {
      /* ignore */
    }
  }

  const activeFreezes: ActiveFreeze[] = [];
  const seen = new Set<string>();
  for (const l of freezeLogs) {
    let d: any = {};
    try {
      d = JSON.parse(l.details ?? '{}');
    } catch {
      d = {};
    }
    const freezeId = d.freezeId ?? l.id;
    if (seen.has(freezeId)) continue;
    seen.add(freezeId);
    const liftedTs = liftedAt.get(freezeId);
    const freezeTs = new Date(l.createdAt).getTime();
    // If an UNFREEZE exists for this freezeId AND it's later than the freeze
    // entry, the freeze is no longer active.
    if (liftedTs !== undefined && liftedTs >= freezeTs) continue;

    activeFreezes.push({
      id: freezeId,
      scope: d.scope ?? l.resourceType,
      target: d.target ?? l.resourceId ?? '',
      reason: d.reason ?? '',
      initiatedBy: d.initiatedBy ?? l.user?.email ?? '',
      initiatedAt: freezeTs,
      expiresAt: d.expiresAt ?? undefined,
      source: 'audit',
      actorEmail: d.actorEmail ?? l.user?.email ?? undefined,
      createdAt: l.createdAt.toISOString(),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Emergency freeze"
        description="Halt assets, accounts or corridors in a single, fully-audited console."
      />

      {activeFreezes.length > 0 && (
        <Card className="border-rose-500/30 bg-rose-500/[0.03]">
          <CardContent className="flex items-center gap-3 p-4">
            <ShieldAlert className="h-5 w-5 shrink-0 text-rose-500" />
            <div className="text-sm">
              <span className="font-semibold text-rose-600 dark:text-rose-400">
                {activeFreezes.length} active freeze
                {activeFreezes.length === 1 ? '' : 's'}
              </span>{' '}
              <span className="text-muted-foreground">
                in effect. Review and lift below when the situation is resolved.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {activeFreezes.length === 0 && corridors.length === 0 && !isAdmin && (
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6" />}
          title="No emergencies in progress"
          description="No active freezes and no corridor activity yet. The console is ready when you need it."
        />
      )}

      <EmergencyFreezeConsole
        activeFreezes={activeFreezes}
        corridors={corridors}
        isAdmin={isAdmin}
      />
    </div>
  );
}
