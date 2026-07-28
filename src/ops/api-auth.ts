/**
 * Shared auth + audit helpers for Operations OS API routes.
 *
 * Every M-OPS-42 endpoint under `/api/ops/*` enforces the same role gate:
 * the caller must hold OPERATIONS, ADMIN or SUPER_ADMIN. Centralizing it
 * here keeps the route handlers short and consistent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

const OPS_ROLES = new Set(['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']);

export interface OpsAuthContext {
  userId: string;
  userEmail?: string;
  roles: string[];
}

export type OpsAuthResult =
  | { ok: true; ctx: OpsAuthContext }
  | { ok: false; response: NextResponse };

/**
 * Resolve + authorize the session for an ops endpoint. Returns either a
 * successful auth context or a ready-to-return error response.
 */
export async function requireOpsAuth(): Promise<OpsAuthResult> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  if (!roles.some((r) => OPS_ROLES.has(r))) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Session missing user id' },
        { status: 400 },
      ),
    };
  }
  return {
    ok: true,
    ctx: {
      userId,
      userEmail: (session.user as any)?.email as string | undefined,
      roles,
    },
  };
}

/**
 * Best-effort audit log. Failures are swallowed because they should never
 * break the user-facing operation that just succeeded.
 */
export async function auditOps(
  ctx: OpsAuthContext,
  action: string,
  details: Record<string, unknown>,
  resourceId?: string,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: ctx.userId,
        action,
        resourceType: 'Ops',
        resourceId: resourceId ?? null,
        result: 'SUCCESS',
        details: JSON.stringify({
          ...details,
          actorEmail: ctx.userEmail ?? null,
        }),
      },
    });
  } catch {
    // best-effort
  }
}

/** Parse a JSON request body, returning a 400 response on failure. */
export async function parseJsonBody<T = Record<string, unknown>>(
  req: NextRequest,
): Promise<{ ok: true; body: T } | { ok: false; response: NextResponse }> {
  try {
    const body = (await req.json()) as T;
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      ),
    };
  }
}
