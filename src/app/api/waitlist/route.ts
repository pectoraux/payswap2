import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { email, name, company, phone, country, businessType } = await req.json();
  if (!email || !name || !country) return NextResponse.json({ error: 'Email, name, and country required' }, { status: 400 });
  try {
    const entry = await db.waitlistEntry.upsert({ where: { email: email.toLowerCase() }, update: { name, company, phone, country, businessType }, create: { email: email.toLowerCase(), name, company, phone, country, businessType } });
    return NextResponse.json({ ok: true, id: entry.id, status: entry.status });
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
