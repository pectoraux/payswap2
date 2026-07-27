import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/waitlist — join the waitlist */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, name, company, phone, country, businessType } = body;

  if (!email || !name || !country) {
    return NextResponse.json({ error: 'Email, name, and country are required' }, { status: 400 });
  }

  try {
    const entry = await db.waitlistEntry.upsert({
      where: { email: email.toLowerCase() },
      update: { name, company, phone, country, businessType },
      create: { email: email.toLowerCase(), name, company, phone, country, businessType },
    });
    return NextResponse.json({ ok: true, id: entry.id, status: entry.status });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to join waitlist' }, { status: 500 });
  }
}
