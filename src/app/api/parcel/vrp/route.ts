import { NextRequest, NextResponse } from 'next/server';
import { solveVRP, type VRPStop, type VRPVehicle, type OptimizationObjective } from '@/extensions/parcel-delivery/vrp-solver';
import { requireSession, unauthorized } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const stops = body.stops as VRPStop[];
  const vehicles = body.vehicles as VRPVehicle[];
  const objectives = (body.objectives as OptimizationObjective[]) ?? ['MINIMIZE_COST'];
  if (!stops || !vehicles) return NextResponse.json({ error: 'stops and vehicles are required' }, { status: 400 });
  const solution = solveVRP(stops, vehicles, objectives);
  return NextResponse.json({ solution, message: `✓ VRP solved: ${solution.routes.length} routes, ${solution.totalDistanceKm.toFixed(0)}km, $${solution.totalCost.toNumber().toFixed(2)}, ${solution.totalCarbon.toFixed(2)}kg CO2, ${solution.solverTimeMs}ms, ${solution.iterations} iterations` }, { status: 201 });
}
