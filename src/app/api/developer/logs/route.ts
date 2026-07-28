import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { resolveDeveloperMerchantId } from '@/lib/developer-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/developer/logs
 *
 * Returns recent log entries for the developer. We use `auditLog` as the
 * source of truth — it captures every authenticated action across the
 * platform. Optional query params:
 *   - level: filter by result (SUCCESS, DENIED, ERROR → INFO/WARN/ERROR)
 *   - q: search by action or details
 *   - limit: max rows (default 50, capped at 200)
 */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  const url = new URL(req.url);
  const levelParam = url.searchParams.get('level') ?? '';
  const q = url.searchParams.get('q') ?? '';
  const limitParam = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Number.isFinite(limitParam) ? Math.min(200, Math.max(1, limitParam)) : 50;

  // Map UI level → auditLog.result.
  // INFO = SUCCESS, WARN = DENIED, ERROR = ERROR
  const resultFilter: string[] = [];
  if (levelParam === 'INFO') resultFilter.push('SUCCESS');
  else if (levelParam === 'WARN') resultFilter.push('DENIED');
  else if (levelParam === 'ERROR') resultFilter.push('ERROR');

  try {
    const merchantId = await resolveDeveloperMerchantId(userId);

    // Pull logs for this developer user OR for their merchant's resources.
    const where: any = {
      OR: [
        { userId },
        ...(merchantId ? [{ details: { contains: merchantId } }] : []),
      ],
    };
    if (resultFilter.length > 0) {
      where.result = { in: resultFilter };
    }
    if (q) {
      where.AND = [
        {
          OR: [
            { action: { contains: q } },
            { details: { contains: q } },
            { resourceType: { contains: q } },
          ],
        },
      ];
    }

    const logs = await db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({
      ok: true,
      logs: logs.map((l) => ({
        id: l.id,
        // Map result back to a log level.
        level:
          l.result === 'SUCCESS' ? 'INFO' : l.result === 'ERROR' ? 'ERROR' : 'WARN',
        source: l.resourceType || l.action,
        action: l.action,
        message: l.details ?? l.action,
        result: l.result,
        ip: l.ip ?? null,
        userAgent: l.userAgent ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[api/developer/logs] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
