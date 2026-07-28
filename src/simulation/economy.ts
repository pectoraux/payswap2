/**
 * Economy Generator — creates a synthetic economy for simulation. (M-SIM.)
 *
 * Generates:
 *   - 30 countries with currencies, reserves, and corridors
 *   - 500 LPs with random positions, bandwidth, fees
 *   - 150 corridors between countries
 *   - Wallets (simplified — IDs + balances, not all persisted to DB)
 *
 * The economy is set up in the runtime's Digital Twin via the control plane.
 */

import type { LiquidityDigitalTwin } from '@/runtime/control-plane/types';

// Use a permissive type for the simulation twin — the runtime's
// LiquidityDigitalTwin has stricter fields that don't match our
// simulation shape. We only need the twin for display, not for
// runtime calls.
type SimDigitalTwin = {
  countries: SimCountry[];
  corridors: SimCorridor[];
  totalReserves: number;
  totalBandwidth: number;
  networkDensity: number;
};

export interface SimCountry {
  code: string;
  currency: string;
  name: string;
  region: string;
  fiatReserves: number;
  stablecoinReserves: number;
  maturity: 'stablecoin_only' | 'hybrid' | 'mostly_fiat';
}

export interface SimCorridor {
  id: string;
  from: string;
  to: string;
  currency: string;
  lpCount: number;
  volume: number;
  costBps: number;
}

export interface SimLP {
  id: string;
  name: string;
  country: string;
  currencies: string[];
  tier: 1 | 2 | 3;
  stake: number;
  capacity: number;
  feeBps: number;
  reputation: number;
  status: 'active' | 'suspended' | 'slashed';
}

export interface SimWallet {
  id: string;
  country: string;
  currency: string;
  balance: number;
}

export interface SimEconomy {
  countries: SimCountry[];
  corridors: SimCorridor[];
  lps: SimLP[];
  wallets: SimWallet[];
  digitalTwin: SimDigitalTwin;
  generatedAt: number;
}

const COUNTRIES: SimCountry[] = [
  { code: 'GH', currency: 'GHS', name: 'Ghana', region: 'West Africa', fiatReserves: 500_000, stablecoinReserves: 200_000, maturity: 'hybrid' },
  { code: 'NG', currency: 'NGN', name: 'Nigeria', region: 'West Africa', fiatReserves: 800_000, stablecoinReserves: 300_000, maturity: 'hybrid' },
  { code: 'KE', currency: 'KES', name: 'Kenya', region: 'East Africa', fiatReserves: 600_000, stablecoinReserves: 250_000, maturity: 'hybrid' },
  { code: 'UG', currency: 'UGX', name: 'Uganda', region: 'East Africa', fiatReserves: 200_000, stablecoinReserves: 150_000, maturity: 'stablecoin_only' },
  { code: 'TZ', currency: 'TZS', name: 'Tanzania', region: 'East Africa', fiatReserves: 250_000, stablecoinReserves: 180_000, maturity: 'stablecoin_only' },
  { code: 'RW', currency: 'RWF', name: 'Rwanda', region: 'East Africa', fiatReserves: 150_000, stablecoinReserves: 120_000, maturity: 'stablecoin_only' },
  { code: 'SN', currency: 'XOF', name: 'Senegal', region: 'West Africa', fiatReserves: 300_000, stablecoinReserves: 200_000, maturity: 'hybrid' },
  { code: 'CI', currency: 'XOF', name: "Côte d'Ivoire", region: 'West Africa', fiatReserves: 350_000, stablecoinReserves: 220_000, maturity: 'hybrid' },
  { code: 'CM', currency: 'XAF', name: 'Cameroon', region: 'Central Africa', fiatReserves: 200_000, stablecoinReserves: 150_000, maturity: 'stablecoin_only' },
  { code: 'EG', currency: 'EGP', name: 'Egypt', region: 'North Africa', fiatReserves: 1_000_000, stablecoinReserves: 400_000, maturity: 'mostly_fiat' },
  { code: 'ZA', currency: 'ZAR', name: 'South Africa', region: 'Southern Africa', fiatReserves: 1_200_000, stablecoinReserves: 500_000, maturity: 'mostly_fiat' },
  { code: 'ET', currency: 'ETB', name: 'Ethiopia', region: 'East Africa', fiatReserves: 400_000, stablecoinReserves: 180_000, maturity: 'hybrid' },
  { code: 'BR', currency: 'BRL', name: 'Brazil', region: 'South America', fiatReserves: 1_500_000, stablecoinReserves: 600_000, maturity: 'mostly_fiat' },
  { code: 'IN', currency: 'INR', name: 'India', region: 'South Asia', fiatReserves: 2_000_000, stablecoinReserves: 800_000, maturity: 'mostly_fiat' },
  { code: 'US', currency: 'USD', name: 'United States', region: 'North America', fiatReserves: 5_000_000, stablecoinReserves: 2_000_000, maturity: 'mostly_fiat' },
  { code: 'GB', currency: 'GBP', name: 'United Kingdom', region: 'Europe', fiatReserves: 3_000_000, stablecoinReserves: 1_200_000, maturity: 'mostly_fiat' },
  { code: 'EU', currency: 'EUR', name: 'European Union', region: 'Europe', fiatReserves: 4_000_000, stablecoinReserves: 1_500_000, maturity: 'mostly_fiat' },
  { code: 'SG', currency: 'SGD', name: 'Singapore', region: 'Southeast Asia', fiatReserves: 1_800_000, stablecoinReserves: 700_000, maturity: 'mostly_fiat' },
  { code: 'AE', currency: 'AED', name: 'UAE', region: 'Middle East', fiatReserves: 1_600_000, stablecoinReserves: 650_000, maturity: 'mostly_fiat' },
  { code: 'TH', currency: 'THB', name: 'Thailand', region: 'Southeast Asia', fiatReserves: 900_000, stablecoinReserves: 350_000, maturity: 'hybrid' },
  { code: 'PH', currency: 'PHP', name: 'Philippines', region: 'Southeast Asia', fiatReserves: 700_000, stablecoinReserves: 280_000, maturity: 'hybrid' },
  { code: 'VN', currency: 'VND', name: 'Vietnam', region: 'Southeast Asia', fiatReserves: 650_000, stablecoinReserves: 260_000, maturity: 'hybrid' },
  { code: 'BD', currency: 'BDT', name: 'Bangladesh', region: 'South Asia', fiatReserves: 450_000, stablecoinReserves: 200_000, maturity: 'hybrid' },
  { code: 'PK', currency: 'PKR', name: 'Pakistan', region: 'South Asia', fiatReserves: 400_000, stablecoinReserves: 180_000, maturity: 'hybrid' },
  { code: 'ID', currency: 'IDR', name: 'Indonesia', region: 'Southeast Asia', fiatReserves: 1_100_000, stablecoinReserves: 420_000, maturity: 'mostly_fiat' },
  { code: 'MY', currency: 'MYR', name: 'Malaysia', region: 'Southeast Asia', fiatReserves: 850_000, stablecoinReserves: 340_000, maturity: 'hybrid' },
  { code: 'NG', currency: 'NGN', name: 'Nigeria (Lagos)', region: 'West Africa', fiatReserves: 900_000, stablecoinReserves: 350_000, maturity: 'hybrid' },
  { code: 'MA', currency: 'MAD', name: 'Morocco', region: 'North Africa', fiatReserves: 500_000, stablecoinReserves: 200_000, maturity: 'hybrid' },
  { code: 'TN', currency: 'TND', name: 'Tunisia', region: 'North Africa', fiatReserves: 350_000, stablecoinReserves: 150_000, maturity: 'hybrid' },
  { code: 'JM', currency: 'JMD', name: 'Jamaica', region: 'Caribbean', fiatReserves: 200_000, stablecoinReserves: 100_000, maturity: 'stablecoin_only' },
];

const LP_NAMES = [
  'Acacia Liquidity', 'Sahara Capital', 'Victoria Partners', 'Baobab Fund',
  'Savannah LP', 'Delta Liquidity', 'Highland Capital', 'Coastal Partners',
  'Rift Valley LP', 'Mango Tree Capital', 'Cedar Liquidity', 'Ebony Fund',
  'Acacia Prime', 'Nile Liquidity', 'Atlas Partners', 'Zambezi Capital',
];

/**
 * Generate a synthetic economy.
 */
export function generateEconomy(): SimEconomy {
  const countries = COUNTRIES.slice(0, 30);

  // Generate 150 corridors (random pairs, no duplicates)
  const corridors: SimCorridor[] = [];
  const corridorSet = new Set<string>();
  while (corridors.length < 150) {
    const from = countries[Math.floor(Math.random() * countries.length)];
    let to = countries[Math.floor(Math.random() * countries.length)];
    while (to.code === from.code) {
      to = countries[Math.floor(Math.random() * countries.length)];
    }
    const key = `${from.code}:${to.code}`;
    if (corridorSet.has(key)) continue;
    corridorSet.add(key);
    corridors.push({
      id: `corridor_${key}`,
      from: from.code,
      to: to.code,
      currency: from.currency,
      lpCount: Math.max(1, Math.floor(Math.random() * 5) + 1),
      volume: Math.floor(Math.random() * 100_000) + 10_000,
      costBps: Math.floor(Math.random() * 200) + 50,
    });
  }

  // Generate 500 LPs
  const lps: SimLP[] = [];
  for (let i = 0; i < 500; i++) {
    const country = countries[Math.floor(Math.random() * countries.length)];
    const numCurrencies = Math.floor(Math.random() * 3) + 1;
    const currencies: string[] = [country.currency];
    for (let j = 0; j < numCurrencies - 1; j++) {
      const c = countries[Math.floor(Math.random() * countries.length)].currency;
      if (!currencies.includes(c)) currencies.push(c);
    }
    const tier = (Math.random() < 0.1 ? 1 : Math.random() < 0.4 ? 2 : 3) as 1 | 2 | 3;
    const stake = tier === 1 ? 500_000 + Math.random() * 500_000 : tier === 2 ? 100_000 + Math.random() * 200_000 : 10_000 + Math.random() * 50_000;
    lps.push({
      id: `lp_sim_${i}`,
      name: `${LP_NAMES[i % LP_NAMES.length]} ${i + 1}`,
      country: country.code,
      currencies,
      tier,
      stake: Math.round(stake),
      capacity: Math.round(stake * (1 + Math.random())),
      feeBps: Math.floor(Math.random() * 150) + 30,
      reputation: Math.round((Math.random() * 40 + 60) * 10) / 10,
      status: Math.random() < 0.95 ? 'active' : 'suspended',
    });
  }

  // Generate simplified wallets (just stats, not 2M individual records)
  const walletCount = 2_000_000;
  const wallets: SimWallet[] = [];
  const walletDistribution = countries.map((c) => ({
    country: c.code,
    currency: c.currency,
    count: Math.floor(walletCount / countries.length),
  }));
  for (const w of walletDistribution) {
    wallets.push({
      id: `wallets_${w.country}`,
      country: w.country,
      currency: w.currency,
      balance: w.count * (100 + Math.random() * 900), // average balance per wallet
    });
  }

  // Build the Digital Twin (simulation shape)
  const totalReserves = countries.reduce((s, c) => s + c.fiatReserves + c.stablecoinReserves, 0);
  const totalBandwidth = lps.filter((l) => l.status === 'active').reduce((s, l) => s + l.capacity, 0);
  const digitalTwin: SimDigitalTwin = {
    countries,
    corridors,
    totalReserves,
    totalBandwidth,
    networkDensity: corridors.length / (countries.length * (countries.length - 1)),
  };

  return {
    countries,
    corridors,
    lps,
    wallets,
    digitalTwin,
    generatedAt: Date.now(),
  };
}

/**
 * Get economy stats for display.
 */
export function getEconomyStats(economy: SimEconomy) {
  return {
    countries: economy.countries.length,
    corridors: economy.corridors.length,
    lps: economy.lps.length,
    activeLPs: economy.lps.filter((l) => l.status === 'active').length,
    wallets: 2_000_000,
    totalReserves: economy.digitalTwin.totalReserves,
    totalBandwidth: economy.digitalTwin.totalBandwidth,
    networkDensity: Math.round(economy.digitalTwin.networkDensity * 1000) / 10,
    byMaturity: {
      stablecoin_only: economy.countries.filter((c) => c.maturity === 'stablecoin_only').length,
      hybrid: economy.countries.filter((c) => c.maturity === 'hybrid').length,
      mostly_fiat: economy.countries.filter((c) => c.maturity === 'mostly_fiat').length,
    },
  };
}
