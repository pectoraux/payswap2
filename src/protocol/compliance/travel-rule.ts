/**
 * PaySwap Protocol — Travel Rule Compliance Service (FATF Recommendation 16).
 *
 * The FATF Travel Rule requires VASPs (Virtual Asset Service Providers)
 * to exchange originator + beneficiary information for transactions at or
 * above USD 1,000 (or its equivalent in fiat).
 *
 * Responsibilities:
 *  - `createRecord(tx, originator, beneficiary)` builds the
 *    `TravelRuleRecord` if `tx.amount ≥ TRAVEL_RULE_THRESHOLD_USD`.
 *  - `transmit(record)` performs the VASP-to-VASP transmission (in
 *    production this is an API call to the beneficiary VASP, e.g. via
 *    TRP — Travel Rule Protocol, IVMS101 over Sygna Bridge, NOTABENE,
 *    Sumsub, etc.). Here it is simulated: status flips to
 *    'transmitted' and `transmittedAt` is set.
 *  - `getRecord(txId)` / `getPendingTransmissions()` drive operational
 *    queues.
 *  - Emits `compliance.travel_rule_triggered` on record creation and
 *    `compliance.travel_rule_transmitted` on successful transmission.
 *
 * The IVMS101 (InterVASP Messaging Standard) originator/beneficiary
 * shapes are simplified here to `{ name; account; address }` for
 * clarity — production deployments should expand them to the full
 * IVMS101 natural-person + legal-person structure.
 */
import { nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import {
  ComplianceError,
  TRAVEL_RULE_THRESHOLD_USD,
  type ComplianceTx,
  type TravelRuleRecord,
  type TravelRuleStatus,
} from './types';

/** Party shape (simplified IVMS101). */
export interface TravelRuleParty {
  name: string;
  account: string;
  address: string;
}

/** Input for `createRecord`. */
export interface CreateTravelRuleInput {
  tx: ComplianceTx;
  originator: TravelRuleParty;
  beneficiary: TravelRuleParty;
  originatorVASP: string;
  beneficiaryVASP: string;
}

/** Result of `createRecord` — note `not_required` status for sub-threshold tx. */
export interface CreateTravelRuleResult {
  record: TravelRuleRecord | null;
  status: TravelRuleStatus;
  reason?: string;
}

export class TravelRuleService {
  private records = new Map<string, TravelRuleRecord>();
  /** txId → recordId index for `getRecord(txId)`. */
  private byTx = new Map<string, string>();

  // ------------------------------------------------------- createRecord
  createRecord(input: CreateTravelRuleInput): CreateTravelRuleResult {
    const { tx, originator, beneficiary, originatorVASP, beneficiaryVASP } = input;

    if (tx.amount < TRAVEL_RULE_THRESHOLD_USD) {
      const result: CreateTravelRuleResult = {
        record: null,
        status: 'not_required',
        reason: `Amount $${tx.amount.toFixed(2)} below Travel Rule threshold $${TRAVEL_RULE_THRESHOLD_USD}`,
      };
      eventEngine.emit('compliance.travel_rule_triggered', {
        txId: tx.id,
        status: 'not_required',
        amount: tx.amount,
      });
      return result;
    }

    const record: TravelRuleRecord = {
      txId: tx.id,
      originator: { ...originator },
      beneficiary: { ...beneficiary },
      amount: tx.amount,
      currency: tx.currency,
      originatorVASP,
      beneficiaryVASP,
      status: 'pending',
      createdAt: nowTs(),
    };
    this.records.set(record.txId, record);
    this.byTx.set(tx.id, tx.id);

    eventEngine.emit('compliance.travel_rule_triggered', {
      txId: tx.id,
      status: 'pending',
      amount: tx.amount,
      currency: tx.currency,
      originatorVASP,
      beneficiaryVASP,
    });
    return { record, status: 'pending' };
  }

  // ------------------------------------------------------- transmit
  /**
   * Simulated VASP-to-VASP transmission. Returns the updated record.
   * In production this method delegates to the configured Travel-Rule
   * messaging provider (NOTABENE, Sygna Bridge, Sumsub, TRP, etc.).
   */
  transmit(record: TravelRuleRecord): TravelRuleRecord {
    if (record.status === 'not_required') {
      throw new ComplianceError(
        'travel_rule.not_required',
        `Travel Rule not required for tx ${record.txId}`,
      );
    }
    // Simulated success — production code calls the provider here.
    record.status = 'transmitted';
    record.transmittedAt = nowTs();
    eventEngine.emit('compliance.travel_rule_transmitted', {
      txId: record.txId,
      beneficiaryVASP: record.beneficiaryVASP,
      transmittedAt: record.transmittedAt,
    });
    return record;
  }

  // ------------------------------------------------------- getRecord
  getRecord(txId: string): TravelRuleRecord | undefined {
    return this.records.get(txId);
  }

  // ------------------------------------------------------- getPendingTransmissions
  getPendingTransmissions(): TravelRuleRecord[] {
    return [...this.records.values()].filter((r) => r.status === 'pending');
  }

  /** Mark a transmission as failed (e.g. beneficiary VASP unreachable). */
  markFailed(txId: string, reason: string): TravelRuleRecord {
    const record = this.records.get(txId);
    if (!record) {
      throw new ComplianceError('travel_rule.not_found', `Travel Rule record for tx ${txId} not found`);
    }
    record.status = 'failed';
    eventEngine.emit('compliance.travel_rule_failed', { txId, reason });
    return record;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForTravelRule = globalThis as unknown as { __PAYSWAP_TRAVEL_RULE_SERVICE?: TravelRuleService };
export const travelRuleService =
  _globalForTravelRule.__PAYSWAP_TRAVEL_RULE_SERVICE ?? new TravelRuleService();
if (!_globalForTravelRule.__PAYSWAP_TRAVEL_RULE_SERVICE) {
  _globalForTravelRule.__PAYSWAP_TRAVEL_RULE_SERVICE = travelRuleService;
}
