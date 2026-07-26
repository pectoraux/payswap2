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

function normalizeCorridor(c: string): string | null {
  // Accept "GHS→KES", "GHS->KES", "GHS>KES", "GHS-KES", "GHS/KES".
  // Canonical form is "GHS→KES" (uppercase, arrow separator).
  if (typeof c !== 'string') return null;
  const trimmed = c.trim().toUpperCase();
  if (!trimmed) return null;
  const m = trimmed.match(/^([A-Z]{3})\s*(?:→|->|>|-|\/)\s*([A-Z]{3})$/);
  if (!m) return null;
  return `${m[1]}→${m[2]}`;
}

function currenciesFromCorridor(corridor: string): string[] {
  const parts = corridor.split('→');
  return parts.length === 2 ? parts : [];
}

/**
 * POST /api/lp/corridors
 *
 * Body:
 *   add:     { action: 'add',     corridor: 'GHS→KES', feeBps?: 50, capacity?: 50000 }
 *   remove:  { action: 'remove',  corridor: 'GHS→KES' }
 *   adjust:  { action: 'adjust',  corridor: 'GHS→KES', feeBps?: 75, capacity?: 60000 }
 *
 * Updates LPProfile.currencies, LPProfile.capacity (JSON map), and
 * LPProfile.feeBps (JSON map). Refuses to remove a corridor that has
 * active (non-completed) settlements.
 */
export async function POST(req: NextRequest) {
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

  const action = typeof body.action === 'string' ? body.action.toLowerCase() : '';
  if (!['add', 'remove', 'adjust'].includes(action)) {
    return NextResponse.json(
      { error: "action must be 'add', 'remove', or 'adjust'" },
      { status: 400 },
    );
  }

  const corridor = normalizeCorridor(body.corridor);
  if (!corridor) {
    return NextResponse.json(
      { error: 'corridor must be a currency pair like "GHS→KES"' },
      { status: 400 },
    );
  }

  const currencies = parseList(lp.currencies);
  const capacityMap = parseStringMap(lp.capacity);
  const feeMap = parseStringMap(lp.feeBps);

  // Parse optional feeBps / capacity for add & adjust.
  let feeBps: number | undefined;
  let capacity: number | undefined;
  if (body.feeBps !== undefined && body.feeBps !== null) {
    const n = typeof body.feeBps === 'string' ? parseFloat(body.feeBps) : (body.feeBps as number);
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      return NextResponse.json(
        { error: 'feeBps must be between 0 and 1000' },
        { status: 400 },
      );
    }
    feeBps = Math.round(n);
  }
  if (body.capacity !== undefined && body.capacity !== null) {
    const n = typeof body.capacity === 'string' ? parseFloat(body.capacity) : (body.capacity as number);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json(
        { error: 'capacity must be ≥ 0' },
        { status: 400 },
      );
    }
    capacity = n;
  }

  if (action === 'add') {
    if (capacityMap[corridor] !== undefined) {
      return NextResponse.json(
        { error: `Corridor ${corridor} already exists. Use 'adjust' instead.` },
        { status: 409 },
      );
    }
    capacityMap[corridor] = capacity ?? 0;
    if (feeBps !== undefined) feeMap[corridor] = feeBps;
    // Make sure both currencies are in the supported list.
    for (const c of currenciesFromCorridor(corridor)) {
      if (!currencies.includes(c)) currencies.push(c);
    }
  } else if (action === 'remove') {
    if (capacityMap[corridor] === undefined) {
      return NextResponse.json(
        { error: `Corridor ${corridor} is not active` },
        { status: 404 },
      );
    }
    // Refuse removal if there are any in-flight settlements for this corridor.
    const activeCount = await db.payment.count({
      where: {
        lpId: lp.id,
        corridor,
        status: { in: ['PENDING', 'PROCESSING', 'AUTHORIZED'] },
      },
    });
    if (activeCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot remove corridor ${corridor}: ${activeCount} active settlement(s) still in flight`,
        },
        { status: 409 },
      );
    }
    delete capacityMap[corridor];
    delete feeMap[corridor];
    // Note: we deliberately do NOT prune the currencies list — the LP may
    // still want those currencies for other corridors.
  } else {
    // adjust
    if (capacityMap[corridor] === undefined) {
      return NextResponse.json(
        { error: `Corridor ${corridor} is not active. Use 'add' first.` },
        { status: 404 },
      );
    }
    if (feeBps !== undefined) feeMap[corridor] = feeBps;
    if (capacity !== undefined) capacityMap[corridor] = capacity;
    if (feeBps === undefined && capacity === undefined) {
      return NextResponse.json(
        { error: 'adjust requires at least one of feeBps or capacity' },
        { status: 400 },
      );
    }
  }

  const updated = await db.lpProfile.update({
    where: { id: lp.id },
    data: {
      currencies: JSON.stringify(currencies),
      capacity: JSON.stringify(capacityMap),
      feeBps: JSON.stringify(feeMap),
    },
  });

  await db.auditLog.create({
    data: {
      userId,
      action: `LP_CORRIDOR_${action.toUpperCase()}`,
      resourceType: 'LPProfile',
      resourceId: lp.id,
      result: 'SUCCESS',
      details: JSON.stringify({
        corridor,
        feeBps,
        capacity,
      }),
    },
  });

  return NextResponse.json({
    lp: {
      id: updated.id,
      currencies: parseList(updated.currencies),
      capacity: parseStringMap(updated.capacity),
      feeBps: parseStringMap(updated.feeBps),
    },
  });
}
