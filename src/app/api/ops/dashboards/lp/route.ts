import { NextResponse } from 'next/server';
import { lpDashboard } from '@/protocol/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { return NextResponse.json(lpDashboard()); }
