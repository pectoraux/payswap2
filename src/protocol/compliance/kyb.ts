/**
 * PaySwap Protocol — KYB (Know-Your-Business) Verification Service.
 *
 * Responsibilities:
 *  - Accept business verification records (`submitKYB`) covering legal
 *    name, registration number, jurisdiction, directors, and UBOs.
 *  - Verify businesses (`verifyKYB`) once every Ultimate Beneficial
 *    Owner with >25% ownership has an associated KYC dossier that
 *    passes the `requireLevel(2)` gate.
 *  - Provide a hard gate `requireVerified(companyId)` that throws
 *    `ComplianceError` when a business attempts to operate without a
 *    verified KYB dossier.
 *
 * Events emitted:
 *  - `compliance.kyb_submitted`
 *  - `compliance.kyb_verified`
 *  - `compliance.kyb_rejected`
 *
 * Provider integration (e.g. LexisNexis Bridger, Refinitiv World-Check
 * KYB, Hummingbird) replaces the inner checks of `verifyKYB` — the
 * public contract stays the same.
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { kycService } from './kyc';
import {
  ComplianceError,
  HIGH_RISK_COUNTRIES,
  type KYBRecord,
  type KYCLevel,
  type KYCStatus,
} from './types';

/** UBO ownership threshold above which individual KYC is mandatory. */
const UBO_KYC_THRESHOLD_PCT = 25;

/** Input shape for `submitKYB`. */
export interface SubmitKYBInput {
  legalName: string;
  registrationNumber: string;
  jurisdiction: string;
  directors: string[];
  beneficialOwners: { name: string; ownershipPct: number }[];
  registeredAddress: string;
  /** UBO → KYC entity id cross-reference. */
  uboKycRefs?: { name: string; kycEntityId: string }[];
}

/** Result of `verifyKYB`. */
export interface VerifyKYBResult {
  companyId: string;
  verified: boolean;
  status: KYCStatus;
  /** UBOs lacking a Level-2 KYC dossier — blocking verification. */
  missingKycUBOs: string[];
  reasons: string[];
}

export class KYBService {
  private records = new Map<string, KYBRecord>();

  // ------------------------------------------------------- submitKYB
  submitKYB(companyId: string, input: SubmitKYBInput): KYBRecord {
    const existing = this.records.get(companyId);
    const record: KYBRecord = {
      companyId,
      legalName: input.legalName,
      registrationNumber: input.registrationNumber,
      jurisdiction: input.jurisdiction,
      directors: [...input.directors],
      beneficialOwners: input.beneficialOwners.map((b) => ({ ...b })),
      registeredAddress: input.registeredAddress,
      status: existing?.status === 'verified' ? 'verified' : 'pending',
      verifiedAt: existing?.verifiedAt,
      uboKycRefs: input.uboKycRefs?.map((r) => ({ ...r })),
      updatedAt: nowTs(),
    };
    this.records.set(companyId, record);

    // Auto-flag for review if jurisdiction is high-risk.
    if (HIGH_RISK_COUNTRIES.includes(input.jurisdiction)) {
      record.status = 'review';
      record.reviewNotes = `Auto-escalated: jurisdiction ${input.jurisdiction} is FATF high-risk.`;
    }

    eventEngine.emit('compliance.kyb_submitted', {
      companyId,
      legalName: input.legalName,
      jurisdiction: input.jurisdiction,
    });
    return record;
  }

  // ------------------------------------------------------- verifyKYB
  verifyKYB(companyId: string): VerifyKYBResult {
    const record = this.records.get(companyId);
    if (!record) {
      throw new ComplianceError('kyb.not_found', `KYB record for ${companyId} not found`);
    }

    const reasons: string[] = [];
    const missingKycUBOs: string[] = [];

    if (!record.registrationNumber) reasons.push('missing registration number');
    if (!record.jurisdiction) reasons.push('missing jurisdiction');
    if (record.directors.length === 0) reasons.push('no directors declared');
    if (record.beneficialOwners.length === 0) {
      reasons.push('no beneficial owners declared');
    }

    // Verify each UBO above 25% ownership has a Level-2 KYC dossier.
    const requiredLevel: KYCLevel = HIGH_RISK_COUNTRIES.includes(record.jurisdiction) ? 3 : 2;
    for (const ubo of record.beneficialOwners) {
      if (ubo.ownershipPct > UBO_KYC_THRESHOLD_PCT) {
        const ref = record.uboKycRefs?.find((r) => r.name === ubo.name);
        if (!ref) {
          missingKycUBOs.push(ubo.name);
          reasons.push(`UBO ${ubo.name} (${ubo.ownershipPct}%) has no KYC dossier ref`);
          continue;
        }
        try {
          kycService.requireLevel(ref.kycEntityId, requiredLevel);
        } catch (e) {
          missingKycUBOs.push(ubo.name);
          const msg = e instanceof Error ? e.message : 'unknown';
          reasons.push(`UBO ${ubo.name} KYC insufficient: ${msg}`);
        }
      }
    }

    const verified = reasons.length === 0;
    if (verified) {
      record.status = 'verified';
      record.verifiedAt = nowTs();
      eventEngine.emit('compliance.kyb_verified', {
        companyId,
        legalName: record.legalName,
        jurisdiction: record.jurisdiction,
      });
    } else {
      record.status = HIGH_RISK_COUNTRIES.includes(record.jurisdiction) ? 'review' : 'rejected';
      record.reviewNotes = reasons.join('; ');
      eventEngine.emit('compliance.kyb_rejected', { companyId, reasons });
    }
    record.updatedAt = nowTs();

    return { companyId, verified, status: record.status, missingKycUBOs, reasons };
  }

  // ------------------------------------------------------- getKYB
  getKYB(companyId: string): KYBRecord | undefined {
    return this.records.get(companyId);
  }

  // ------------------------------------------------------- requireVerified
  /** Hard gate: throws `ComplianceError` if the business is not verified. */
  requireVerified(companyId: string): void {
    const record = this.records.get(companyId);
    if (!record) {
      throw new ComplianceError(
        'kyb.not_found',
        `KYB record for ${companyId} not found — cannot operate`,
        { companyId },
      );
    }
    if (record.status !== 'verified') {
      throw new ComplianceError(
        'kyb.not_verified',
        `Business ${companyId} KYB status is ${record.status}`,
        { companyId, status: record.status },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForKYB = globalThis as unknown as { __PAYSWAP_KYB_SERVICE?: KYBService };
export const kybService = _globalForKYB.__PAYSWAP_KYB_SERVICE ?? new KYBService();
if (!_globalForKYB.__PAYSWAP_KYB_SERVICE) _globalForKYB.__PAYSWAP_KYB_SERVICE = kybService;
