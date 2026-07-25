import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasLpRole(roles: string[] | undefined): boolean {
  return !!roles && roles.some((r) => ['LP', 'ADMIN', 'SUPER_ADMIN'].includes(r));
}

function parseStringMap(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * GET /api/lp/settings
 *
 * Returns the authenticated LP's editable configuration: capacity map,
 * per-corridor fee bps, settlement speed, and read-only reputation.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasLpRole((session.user as any)?.roles)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const account = await db.account.findFirst({
    where: { userId, type: 'LP' },
    include: { lpProfile: true },
  });
  const lp = account?.lpProfile;
  if (!lp) return NextResponse.json({ error: 'LP profile not found' }, { status: 404 });

  return NextResponse.json({
    lp: {
      id: lp.id,
      name: lp.name,
      country: lp.country,
      currencies: parseList(lp.currencies),
      tier: lp.tier,
      stake: lp.stake,
      collateral: lp.collateral,
      available: Math.max(0, lp.stake - lp.collateral),
      capacity: parseStringMap(lp.capacity),
      feeBps: parseStringMap(lp.feeBps),
      settlementSpeedMs: lp.settlementSpeedMs,
      reputation: lp.reputation, // read-only
      status: lp.status,
    },
  });
}

/**
 * PATCH /api/lp/settings
 *
 * Body:
 *   {
 *     feeBps: { "GHS→KES": 50, ... },          // per-corridor fees in bps
 *     settlementSpeedMs: 2000,                   // target settlement latency
 *     capacityAdjustments: { "GHS→KES": 50000 }  // per-corridor capacity overrides
 *   }
 *
 * Reputation is NEVER updated here — it stays read-only, computed by the
 * protocol from settlement outcomes.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasLpRole((session.user as any)?.roles)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const account = await db.account.findFirst({
    where: { userId, type: 'LP' },
    include: { lpProfile: true },
  });
  const lp = account?.lpProfile;
  if (!lp) return NextResponse.json({ error: 'LP profile not found' }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: { feeBps?: string; settlementSpeedMs?: number; capacity?: string } = {};

  // Per-corridor fee bps. Validate each entry is a non-negative number ≤ 1000 (10%).
  if (body.feeBps !== undefined && body.feeBps !== null) {
    if (typeof body.feeBps !== 'object' || Array.isArray(body.feeBps)) {
      return NextResponse.json({ error: 'feeBps must be an object' }, { status: 400 });
    }
    const feeMap: Record<string, number> = {};
    for (const [k, v] of Object.entries(body.feeBps)) {
      if (typeof k !== 'string' || !k.trim()) continue;
      const n = typeof v === 'string' ? parseFloat(v) : (v as number);
      if (!Number.isFinite(n) || n < 0 || n > 1000) {
        return NextResponse.json(
          { error: `Invalid feeBps for corridor ${k}: must be 0–1000` },
          { status: 400 },
        );
      }
      feeMap[k.trim()] = Math.round(n);
    }
    patch.feeBps = JSON.stringify(feeMap);
  }

  // Settlement speed preference, in milliseconds. Must be ≥ 100ms.
  if (body.settlementSpeedMs !== undefined && body.settlementSpeedMs !== null) {
    const ms = typeof body.settlementSpeedMs === 'string'
      ? parseInt(body.settlementSpeedMs, 10)
      : (body.settlementSpeedMs as number);
    if (!Number.isFinite(ms) || ms < 100 || ms > 60_000) {
      return NextResponse.json(
        { error: 'settlementSpeedMs must be between 100 and 60000' },
        { status: 400 },
      );
    }
    patch.settlementSpeedMs = Math.round(ms);
  }

  // Per-corridor capacity overrides (the only capacity knob LPs have here).
  if (body.capacityAdjustments !== undefined && body.capacityAdjustments !== null) {
    if (typeof body.capacityAdjustments !== 'object' || Array.isArray(body.capacityAdjustments)) {
      return NextResponse.json({ error: 'capacityAdjustments must be an object' }, { status: 400 });
    }
    const current = parseStringMap(lp.capacity);
    for (const [k, v] of Object.entries(body.capacityAdjustments)) {
      if (typeof k !== 'string' || !k.trim()) continue;
      const n = typeof v === 'string' ? parseFloat(v) : (v as number);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: `Invalid capacity for corridor ${k}: must be ≥ 0` },
          { status: 400 },
        );
      }
      current[k.trim()] = n;
    }
    patch.capacity = JSON.stringify(current);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const updated = await db.lpProfile.update({
    where: { id: lp.id },
    data: patch,
  });

  await db.auditLog.create({
    data: {
      userId,
      action: 'LP_SETTINGS_UPDATE',
      resourceType: 'LPProfile',
      resourceId: lp.id,
      result: 'SUCCESS',
      details: JSON.stringify({
        fields: Object.keys(patch),
        feeBps: patch.feeBps ? parseStringMap(patch.feeBps) : undefined,
        settlementSpeedMs: patch.settlementSpeedMs,
        capacityAdjustments: patch.capacity ? parseStringMap(patch.capacity) : undefined,
      }),
    },
  });

  return NextResponse.json({
    lp: {
      id: updated.id,
      feeBps: parseStringMap(updated.feeBps),
      settlementSpeedMs: updated.settlementSpeedMs,
      capacity: parseStringMap(updated.capacity),
      reputation: updated.reputation,
    },
  });
}
