/**
 * Simulation Scenarios — stress events for the economic simulation. (M-SIM.)
 *
 * Each scenario defines a stress event that occurs at a specific day
 * during the 120-day simulation. The runner injects these events and
 * verifies the system survives them.
 */

export type ScenarioType =
  | 'normal_operation'
  | 'reserve_growth'
  | 'lp_failures'
  | 'stablecoin_depeg'
  | 'bank_outage'
  | 'fx_shock'
  | 'mass_redemption'
  | 'regulatory_freeze';

export interface SimulationScenario {
  type: ScenarioType;
  name: string;
  description: string;
  triggerDay: number;       // day in the 120-day simulation
  severity: 'low' | 'medium' | 'high' | 'critical';
  params: Record<string, unknown>;
}

export const SCENARIO_LIBRARY: SimulationScenario[] = [
  {
    type: 'reserve_growth',
    name: 'Gradual Reserve Growth',
    description: 'Reserves grow by 2% per day for 30 days',
    triggerDay: 10,
    severity: 'low',
    params: { dailyGrowthRate: 0.02, durationDays: 30 },
  },
  {
    type: 'lp_failures',
    name: 'LP Failures Wave',
    description: '5% of LPs go offline simultaneously',
    triggerDay: 25,
    severity: 'high',
    params: { failureRate: 0.05 },
  },
  {
    type: 'stablecoin_depeg',
    name: 'Stablecoin Depeg',
    description: 'Stablecoin price drops 15% from peg',
    triggerDay: 40,
    severity: 'critical',
    params: { depegPercent: 0.15 },
  },
  {
    type: 'bank_outage',
    name: 'Bank Outage (Nigeria)',
    description: 'Nigerian banking rail goes down for 3 days',
    triggerDay: 55,
    severity: 'high',
    params: { country: 'NG', durationDays: 3 },
  },
  {
    type: 'fx_shock',
    name: 'FX Shock (GHS)',
    description: 'Ghanaian Cedi depreciates 20% vs USD',
    triggerDay: 70,
    severity: 'medium',
    params: { currency: 'GHS', devaluationPercent: 0.20 },
  },
  {
    type: 'mass_redemption',
    name: 'Mass Redemption Event',
    description: '10% of twin tokens redeemed simultaneously',
    triggerDay: 85,
    severity: 'critical',
    params: { redemptionRate: 0.10 },
  },
  {
    type: 'regulatory_freeze',
    name: 'Regulatory Freeze (Ethiopia)',
    description: 'Ethiopia frozen — no transactions in/out',
    triggerDay: 100,
    severity: 'high',
    params: { country: 'ET', durationDays: 20 },
  },
];

/**
 * Generate a random set of transactions for a day.
 */
export function generateDailyTransactions(
  economy: { countries: { code: string; currency: string }[]; corridors: { from: string; to: string; currency: string }[] },
  day: number,
  count: number = 1000,
): { from: string; to: string; amount: number; currency: string }[] {
  const txns: { from: string; to: string; amount: number; currency: string }[] = [];
  for (let i = 0; i < count; i++) {
    // Pick a random corridor
    const corridor = economy.corridors[Math.floor(Math.random() * economy.corridors.length)];
    if (!corridor) continue;
    txns.push({
      from: corridor.from,
      to: corridor.to,
      amount: Math.round((Math.random() * 5000 + 10) * 100) / 100,
      currency: corridor.currency,
    });
  }
  return txns;
}

/**
 * Check if a scenario should trigger on a given day.
 */
export function shouldTrigger(scenario: SimulationScenario, day: number): boolean {
  return day === scenario.triggerDay;
}
