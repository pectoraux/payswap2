/**
 * P3-5 (H-9 fix) — Best-effort audit log helper.
 *
 * The audit log is **append-only** (zero update/delete call sites — keep it
 * that way). It is a forensic record of who did what to which money-moving
 * resource, not a guard. A failed audit write MUST NOT fail the request —
 * the underlying transaction (payout, refund, admin state change) is
 * already committed by the time this is called.
 *
 * Every entry includes:
 *   - userId       (from the session — nullable for system actors)
 *   - action       (e.g. `PAYOUT_CREATE`, `EXTENSION_APPROVE`)
 *   - resourceType (e.g. `Payout`, `Extension`, `Wallet`)
 *   - resourceId   (the id of the affected row — nullable for collection-level ops)
 *   - result       (`SUCCESS` | `FAILURE` | `DENIED`)
 *   - details      (JSON string with relevant fields)
 *
 * The IP + userAgent fields on the AuditLog model are left null here —
 * extracting them from the NextRequest requires a `headers()` call that
 * the route already does, and the route layer is the right place to attach
 * them if we later decide to. Keeping this helper request-shape-agnostic
 * means we can call it from non-HTTP contexts (scheduled jobs, webhooks)
 * too.
 */
import { db } from '@/lib/db';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  result: 'SUCCESS' | 'FAILURE' | 'DENIED';
  details?: Record<string, unknown> | null;
}

/**
 * Write an audit log entry. Best-effort: failures are logged to
 * console.error (so ops sees them) but DO NOT throw. The caller's
 * transaction is already committed by the time this runs.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        result: entry.result,
        details: entry.details ? JSON.stringify(entry.details) : null,
      },
    });
  } catch (err) {
    console.error(
      '[audit-log] db.auditLog.create failed (action=%s, resourceType=%s, resourceId=%s):',
      entry.action,
      entry.resourceType,
      entry.resourceId ?? '(none)',
      err,
    );
  }
}
