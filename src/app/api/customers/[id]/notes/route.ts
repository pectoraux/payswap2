import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_NOTES = 10000;

/**
 * PATCH /api/customers/[id]/notes
 *
 * Persist free-form merchant notes against a CustomerRecord. Notes are
 * stored inside the record's `metadata` JSON blob under a `notes` key so
 * we don't need a schema migration. Existing metadata keys are preserved.
 *
 * Body:
 *   { notes: string }  — empty string clears the notes field.
 *
 * The customer record must belong to the authenticated merchant and the
 * active environment.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const env = await getEnvironment();
  const userId = (session.user as any)?.id as string | undefined;

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: 'Customer ID is required' },
      { status: 400 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawNotes =
    typeof body?.notes === 'string' ? body.notes : String(body?.notes ?? '');
  const notes = rawNotes.slice(0, MAX_NOTES);

  const customer = await db.customerRecord.findUnique({ where: { id } });
  if (!customer) {
    return NextResponse.json(
      { error: 'Customer not found' },
      { status: 404 },
    );
  }
  if (customer.merchantId !== merchantId || customer.environment !== env) {
    return NextResponse.json(
      { error: 'Customer does not belong to this merchant' },
      { status: 403 },
    );
  }

  // Merge into the existing metadata JSON, preserving other keys.
  let meta: Record<string, unknown> = {};
  if (customer.metadata) {
    try {
      const parsed = JSON.parse(customer.metadata);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      // Existing metadata is garbage — start fresh but keep it safe.
      meta = {};
    }
  }
  meta.notes = notes;
  meta.notesUpdatedAt = new Date().toISOString();
  if (userId) meta.notesUpdatedBy = userId;

  const updated = await db.customerRecord.update({
    where: { id },
    data: { metadata: JSON.stringify(meta) },
  });

  // Best-effort audit log.
  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: 'CUSTOMER.NOTES_UPDATE',
        resourceType: 'CustomerRecord',
        resourceId: id,
        result: 'SUCCESS',
        details: JSON.stringify({ length: notes.length }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({
    customer: updated,
    notes,
    updatedAt: meta.notesUpdatedAt,
  });
}
