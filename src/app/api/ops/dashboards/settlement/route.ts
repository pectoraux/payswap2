import { NextResponse } from 'next/server';
import { settlementDashboard } from '@/protocol/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { return NextResponse.json(settlementDashboard()); }
