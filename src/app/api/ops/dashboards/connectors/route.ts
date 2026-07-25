import { NextResponse } from 'next/server';
import { connectorDashboard } from '@/protocol/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { return NextResponse.json(connectorDashboard()); }
