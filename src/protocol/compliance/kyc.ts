/**
 * PaySwap Protocol — KYC (Know-Your-Customer) Verification Service.
 *
 * Responsibilities:
 *  - Accept identity documents (`submitDocument`) and verify them
 *    (`verifyDocument`).
 *  - Auto-compute the entity's KYC level (0–3) from the verified document
 *    set:
 *      0  unverified       — no documents
 *      1  basic             — 1 verified government-issued ID
 *      2  full              — ID + address-proof document
 *      3  enhanced (EDD)    — manually escalated for high-risk entities
 *  - Auto-escalate dossiers to `review` when documents are issued by a
 *    FATF high-risk jurisdiction.
 *  - Provide hard gates `requireLevel(entityId, requiredLevel)` that
 *    throw `ComplianceError` when the entity is below the required tier.
 *  - Expire stale dossiers (default 24 months without re-verification).
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `compliance.kyc_doc_submitted`
 *  - `compliance.kyc_verified`
 *  - `compliance.kyc_rejected`
 *  - `compliance.kyc_escalated`
 *  - `compliance.kyc_expired`
 *
 * The service is intentionally provider-agnostic: real integrations
 * (Onfido, Jumio, Persona, Smile Identity) replace `verifyDocument()`'s
 * inner check; the rest of the contract stays the same.
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import {
  ComplianceError,
  HIGH_RISK_COUNTRIES,
  KYC_STALE_MS,
  type KYCDossier,
  type KYCDocument,
  type KYCDocumentType,
  type KYCLevel,
  type KYCStatus,
} from './types';

/** Document categories considered government-issued IDs. */
const ID_DOCUMENT_TYPES: KYCDocumentType[] = ['passport', 'national_id', 'drivers_license'];

/** Document categories accepted as address proof. */
const ADDRESS_PROOF_TYPES: KYCDocumentType[] = ['utility_bill', 'bank_statement'];

/** Input shape for `submitDocument`. */
export interface SubmitDocumentInput {
  type: KYCDocumentType;
  holder: string;
  country: string;
  evidenceId?: string;
}

/** Result of `verifyDocument`. */
export interface VerifyDocumentResult {
  docId: string;
  verified: boolean;
  newLevel: KYCLevel;
  status: KYCStatus;
}

export class KYCService {
  private dossiers = new Map<string, KYCDossier>();
  private documents = new Map<string, KYCDocument>();
  /** Entities manually flagged for enhanced due diligence (level 3). */
  private enhancedFlags = new Set<string>();

  // ------------------------------------------------------- submitDocument
  submitDocument(entityId: string, doc: SubmitDocumentInput): KYCDocument {
    const id = uid('kycdoc');
    const document: KYCDocument = {
      id,
      type: doc.type,
      holder: doc.holder,
      country: doc.country,
      uploadedAt: nowTs(),
      evidenceId: doc.evidenceId,
    };
    this.documents.set(id, document);

    let dossier = this.dossiers.get(entityId);
    if (!dossier) {
      dossier = {
        entityId,
        level: 0,
        status: 'pending',
        documents: [],
        country: doc.country,
        updatedAt: nowTs(),
      };
      this.dossiers.set(entityId, dossier);
    }
    dossier.documents.push(document);
    dossier.country = dossier.country || doc.country;
    dossier.updatedAt = nowTs();

    // High-risk document country → escalate to review immediately.
    if (HIGH_RISK_COUNTRIES.includes(doc.country) && dossier.status !== 'review') {
      dossier.status = 'review';
      dossier.reviewNotes = `Auto-escalated: document country ${doc.country} is on the FATF high-risk list.`;
      eventEngine.emit('compliance.kyc_escalated', {
        entityId,
        docId: id,
        country: doc.country,
        reason: 'high_risk_country',
      });
    }

    eventEngine.emit('compliance.kyc_doc_submitted', {
      entityId,
      docId: id,
      type: doc.type,
      country: doc.country,
    });
    return document;
  }

  // ------------------------------------------------------- verifyDocument
  verifyDocument(docId: string, verified: boolean, reason?: string): VerifyDocumentResult {
    const doc = this.documents.get(docId);
    if (!doc) {
      throw new ComplianceError('kyc.doc_not_found', `KYC document ${docId} not found`);
    }
    const dossier = this.findDossierByDoc(docId);
    if (!dossier) {
      throw new ComplianceError('kyc.dossier_missing', `Dossier for document ${docId} not found`);
    }

    if (verified) {
      doc.verifiedAt = nowTs();
      eventEngine.emit('compliance.kyc_verified', {
        entityId: dossier.entityId,
        docId,
        type: doc.type,
      });
    } else {
      doc.verifiedAt = undefined;
      doc.rejectionReason = reason || 'rejected_by_reviewer';
      eventEngine.emit('compliance.kyc_rejected', {
        entityId: dossier.entityId,
        docId,
        reason: doc.rejectionReason,
      });
    }

    const newLevel = this.computeLevel(dossier);
    const newStatus = this.computeStatus(dossier, verified);
    dossier.level = newLevel;
    dossier.status = newStatus;
    if (verified && newStatus === 'verified') {
      dossier.verifiedAt = nowTs();
      dossier.expiresAt = nowTs() + KYC_STALE_MS;
    }
    dossier.updatedAt = nowTs();

    return { docId, verified, newLevel, status: newStatus };
  }

  // ------------------------------------------------------- getKYCStatus
  getKYCStatus(entityId: string): KYCStatus {
    return this.dossiers.get(entityId)?.status ?? 'pending';
  }

  // ------------------------------------------------------- getKYCLevel
  getKYCLevel(entityId: string): KYCLevel {
    return this.dossiers.get(entityId)?.level ?? 0;
  }

  // ------------------------------------------------------- getDossier
  getDossier(entityId: string): KYCDossier | undefined {
    return this.dossiers.get(entityId);
  }

  // ------------------------------------------------------- escalateToEnhanced
  escalateToEnhanced(entityId: string, reason: string): void {
    const dossier = this.dossiers.get(entityId);
    if (!dossier) {
      throw new ComplianceError('kyc.dossier_missing', `KYC dossier for ${entityId} not found`);
    }
    this.enhancedFlags.add(entityId);
    dossier.level = Math.max(dossier.level, 3) as KYCLevel;
    dossier.status = 'review';
    dossier.reviewNotes = reason;
    dossier.updatedAt = nowTs();
    eventEngine.emit('compliance.kyc_escalated', { entityId, reason, level: 3 });
  }

  // ------------------------------------------------------- requireLevel
  /**
   * Hard gate: throws `ComplianceError` if the entity is below the required
   * KYC level. Payment flow calls this before executing settlement.
   */
  requireLevel(entityId: string, requiredLevel: KYCLevel): void {
    const dossier = this.dossiers.get(entityId);
    const current = dossier?.level ?? 0;
    if (current < requiredLevel) {
      throw new ComplianceError(
        'kyc.level_insufficient',
        `Entity ${entityId} KYC level ${current} below required ${requiredLevel}`,
        { entityId, current, required: requiredLevel },
      );
    }
    if (dossier && (dossier.status === 'rejected' || dossier.status === 'expired')) {
      throw new ComplianceError(
        'kyc.status_blocked',
        `Entity ${entityId} KYC status is ${dossier.status}`,
        { entityId, status: dossier.status },
      );
    }
  }

  // ------------------------------------------------------- expireIfStale
  /** Mark any dossier past its `expiresAt` as `expired`. */
  expireIfStale(entityId: string): boolean {
    const dossier = this.dossiers.get(entityId);
    if (!dossier || !dossier.expiresAt) return false;
    if (nowTs() < dossier.expiresAt) return false;
    dossier.status = 'expired';
    dossier.updatedAt = nowTs();
    eventEngine.emit('compliance.kyc_expired', { entityId, expiredAt: dossier.expiresAt });
    return true;
  }

  /** Sweep every dossier and expire stale ones. Returns count expired. */
  expireAllStale(): number {
    let n = 0;
    for (const entityId of this.dossiers.keys()) {
      if (this.expireIfStale(entityId)) n += 1;
    }
    return n;
  }

  // ------------------------------------------------------- helpers
  /** Compute KYC level from verified documents + enhanced flag. */
  private computeLevel(dossier: KYCDossier): KYCLevel {
    const verified = dossier.documents.filter((d) => d.verifiedAt);
    if (this.enhancedFlags.has(dossier.entityId)) return 3;

    const hasId = verified.some((d) => ID_DOCUMENT_TYPES.includes(d.type));
    const hasAddress = verified.some((d) => ADDRESS_PROOF_TYPES.includes(d.type));

    if (hasId && hasAddress) return 2;
    if (hasId) return 1;
    return 0;
  }

  /** Compute dossier status from documents + escalation. */
  private computeStatus(dossier: KYCDossier, lastActionVerified: boolean): KYCStatus {
    if (HIGH_RISK_COUNTRIES.includes(dossier.country)) return 'review';
    if (dossier.status === 'review') return 'review';
    const verified = dossier.documents.filter((d) => d.verifiedAt);
    if (verified.length === 0) {
      return lastActionVerified ? 'verified' : 'pending';
    }
    return 'verified';
  }

  private findDossierByDoc(docId: string): KYCDossier | undefined {
    for (const d of this.dossiers.values()) {
      if (d.documents.some((doc) => doc.id === docId)) return d;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Singleton (globalThis pattern, same as eventEngine)
// ---------------------------------------------------------------------------

const _globalForKYC = globalThis as unknown as { __PAYSWAP_KYC_SERVICE?: KYCService };
export const kycService = _globalForKYC.__PAYSWAP_KYC_SERVICE ?? new KYCService();
if (!_globalForKYC.__PAYSWAP_KYC_SERVICE) _globalForKYC.__PAYSWAP_KYC_SERVICE = kycService;
