/**
 * Travel Rule Service — FATF Recommendation 16 compliance. (M-TRUST-40.)
 *
 * The Travel Rule requires that financial institutions transmit
 * originator and beneficiary information for transactions above a
 * threshold (typically $1,000 USD for cross-border).
 *
 * This service:
 *   - Checks if a transaction requires travel rule info
 *   - Creates travel rule records
 *   - Transmits info to the beneficiary institution (mock)
 */

import type { TravelRuleRecord } from './types';
import { uid } from '@/runtime/types';

const TRAVEL_RULE_THRESHOLD_USD = 1000; // $1,000 for cross-border

interface Transaction {
  id: string;
  amount: number;
  currency: string;
  sourceCountry: string;
  destCountry: string;
  originator?: { name: string; account: string; address?: string; country?: string };
  beneficiary?: { name: string; account: string; address?: string; country?: string };
}

export class TravelRuleService {
  private records: Map<string, TravelRuleRecord> = new Map();

  /**
   * Check if a transaction requires travel rule compliance.
   */
  requiresTravelRule(tx: Transaction): boolean {
    // Cross-border transactions above the threshold
    if (tx.sourceCountry === tx.destCountry) return false;
    // Convert amount to USD (mock — use 1:1 for USD, estimate for others)
    const usdAmount = this.toUSD(tx.amount, tx.currency);
    return usdAmount >= TRAVEL_RULE_THRESHOLD_USD;
  }

  /**
   * Create a travel rule record for a transaction.
   */
  async createRecord(tx: Transaction): Promise<TravelRuleRecord> {
    const record: TravelRuleRecord = {
      id: uid('tr'),
      transactionId: tx.id,
      originator: tx.originator ?? { name: 'Unknown', account: 'Unknown' },
      beneficiary: tx.beneficiary ?? { name: 'Unknown', account: 'Unknown' },
      amount: tx.amount,
      currency: tx.currency,
      threshold: TRAVEL_RULE_THRESHOLD_USD,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.records.set(record.id, record);
    return record;
  }

  /**
   * Transmit travel rule info to the beneficiary institution.
   */
  async transmit(recordId: string): Promise<TravelRuleRecord | null> {
    const record = this.records.get(recordId);
    if (!record) return null;

    // Mock transmission — in production, this calls the beneficiary institution's API
    await new Promise((resolve) => setTimeout(resolve, 100)); // simulate network

    record.status = 'transmitted';
    record.transmittedAt = Date.now();
    return record;
  }

  /**
   * List travel rule records.
   */
  list(filter?: { status?: string; limit?: number }): TravelRuleRecord[] {
    let results = Array.from(this.records.values());
    if (filter?.status) {
      results = results.filter((r) => r.status === filter.status);
    }
    results.sort((a, b) => b.createdAt - a.createdAt);
    return results.slice(0, filter?.limit ?? 100);
  }

  /**
   * Get a single record.
   */
  get(recordId: string): TravelRuleRecord | null {
    return this.records.get(recordId) ?? null;
  }

  /**
   * Get stats.
   */
  getStats(): {
    total: number;
    pending: number;
    transmitted: number;
    failed: number;
  } {
    const all = Array.from(this.records.values());
    return {
      total: all.length,
      pending: all.filter((r) => r.status === 'pending').length,
      transmitted: all.filter((r) => r.status === 'transmitted').length,
      failed: all.filter((r) => r.status === 'failed').length,
    };
  }

  /**
   * Mock FX conversion to USD.
   */
  private toUSD(amount: number, currency: string): number {
    const rates: Record<string, number> = {
      USD: 1,
      EUR: 1.08,
      GBP: 1.27,
      GHS: 0.083,
      NGN: 0.00067,
      KES: 0.0078,
      UGX: 0.00027,
      TZS: 0.00040,
      RWF: 0.00078,
      XOF: 0.0017,
      XAF: 0.0017,
      ZAR: 0.054,
      EGP: 0.021,
      BRL: 0.20,
      INR: 0.012,
      CNY: 0.14,
      JPY: 0.0067,
    };
    const rate = rates[currency] ?? 1;
    return amount * rate;
  }
  /**
   * Mark a record as failed.
   */
  async markFailed(recordId: string): Promise<TravelRuleRecord | null> {
    const record = this.records.get(recordId);
    if (!record) return null;
    record.status = 'failed';
    return record;
  }

  /**
   * Get a record by transaction ID.
   */
  getByTransaction(transactionId: string): TravelRuleRecord | null {
    for (const record of this.records.values()) {
      if (record.transactionId === transactionId) return record;
    }
    return null;
  }

  /**
   * Alias for getStats (backward compat).
   */
  stats(): { total: number; pending: number; transmitted: number; failed: number } {
    return this.getStats();
  }
}

export const travelRuleService = new TravelRuleService();
