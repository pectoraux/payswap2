import { NextRequest, NextResponse } from 'next/server';
import { storefront } from '@/extension-ecosystem';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const section = sp.get('section') ?? 'FEATURED';
  const search = sp.get('q');
  if (search) return NextResponse.json({ results: storefront.search(search) });
  const listings = storefront.browse(section);
  return NextResponse.json({ section, listings, count: listings.length });
}
