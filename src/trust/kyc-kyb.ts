/**
 * KYC / KYB Service — identity verification workflow. (M-TRUST-40.)
 *
 * Manages the lifecycle of identity verifications:
 *   initiate → submit documents → run verifications → review → approve/reject
 *
 * KYC = Know Your Customer (individuals)
 * KYB = Know Your Business (organizations)
 */

import type {
  KYCVerification, KYCType, KYCStatus, KYCDocument, VerificationResult,
} from './types';
import { db } from '@/lib/db';
import { uid } from '@/runtime/types';

const KYC_VALIDITY_DAYS = 365; // KYC expires after 1 year

export class KYCService {
  /**
   * Initiate a KYC verification for an individual.
   */
  async initiateKYC(entityId: string, entityName: string): Promise<KYCVerification> {
    return this.initiate(entityId, entityName, 'kyc');
  }

  /**
   * Initiate a KYB verification for a business.
   */
  async initiateKYB(entityId: string, entityName: string): Promise<KYCVerification> {
    return this.initiate(entityId, entityName, 'kyb');
  }

  private async initiate(
    entityId: string,
    entityName: string,
    type: KYCType,
  ): Promise<KYCVerification> {
    const verification: KYCVerification = {
      id: uid('kyc'),
      entityId,
      entityName,
      type,
      status: 'pending',
      documents: [],
      verifications: type === 'kyc'
        ? [
            { type: 'identity', status: 'pending', detail: 'Identity verification required', checkedAt: Date.now() },
            { type: 'address', status: 'pending', detail: 'Proof of address required', checkedAt: Date.now() },
            { type: 'liveness', status: 'pending', detail: 'Liveness check required', checkedAt: Date.now() },
            { type: 'sanctions', status: 'pending', detail: 'Sanctions screening', checkedAt: Date.now() },
            { type: 'pep', status: 'pending', detail: 'PEP screening', checkedAt: Date.now() },
          ]
        : [
            { type: 'business_registry', status: 'pending', detail: 'Business registry verification', checkedAt: Date.now() },
            { type: 'address', status: 'pending', detail: 'Registered address verification', checkedAt: Date.now() },
            { type: 'sanctions', status: 'pending', detail: 'Sanctions screening of beneficial owners', checkedAt: Date.now() },
            { type: 'pep', status: 'pending', detail: 'PEP screening of beneficial owners', checkedAt: Date.now() },
          ],
      submittedAt: Date.now(),
    };

    // Persist to DB
    try {
      await db.complianceReview.create({
        data: {
          id: verification.id,
          entityType: type === 'kyc' ? 'CUSTOMER' : 'MERCHANT',
          entityId,
          type: type.toUpperCase(),
          status: 'PENDING',
          data: JSON.stringify(verification),
        },
      });
    } catch (err) {
      console.error('[KYC] Failed to persist:', err);
    }

    return verification;
  }

  /**
   * Submit a document for a verification.
   */
  async submitDocument(
    verificationId: string,
    doc: Omit<KYCDocument, 'uploadedAt' | 'verified'>,
  ): Promise<void> {
    const document: KYCDocument = {
      ...doc,
      uploadedAt: Date.now(),
      verified: false,
    };

    try {
      const review = await db.complianceReview.findUnique({
        where: { id: verificationId },
      });
      if (!review) return;

      const data = review.data ? JSON.parse(review.data) : {};
      const documents = data.documents || [];
      documents.push(document);
      data.documents = documents;

      await db.complianceReview.update({
        where: { id: verificationId },
        data: { data: JSON.stringify(data) },
      });
    } catch (err) {
      console.error('[KYC] Failed to submit document:', err);
    }
  }

  /**
   * Run a verification check (identity, address, sanctions, etc.).
   */
  async runVerification(
    verificationId: string,
    type: VerificationResult['type'],
  ): Promise<VerificationResult> {
    // Mock verification — in production, this calls external services
    const result: VerificationResult = {
      type,
      status: Math.random() > 0.1 ? 'pass' : 'fail', // 90% pass rate
      detail: `${type} verification ${Math.random() > 0.1 ? 'passed' : 'failed'}`,
      checkedAt: Date.now(),
    };

    try {
      const review = await db.complianceReview.findUnique({
        where: { id: verificationId },
      });
      if (!review) return result;

      const data = review.data ? JSON.parse(review.data) : {};
      const verifications = data.verifications || [];
      const idx = verifications.findIndex((v: VerificationResult) => v.type === type);
      if (idx >= 0) {
        verifications[idx] = result;
      } else {
        verifications.push(result);
      }
      data.verifications = verifications;

      await db.complianceReview.update({
        where: { id: verificationId },
        data: { data: JSON.stringify(data) },
      });
    } catch (err) {
      console.error('[KYC] Failed to run verification:', err);
    }

    return result;
  }

  /**
   * Review a verification (approve/reject/request review).
   */
  async review(
    verificationId: string,
    decision: 'approved' | 'rejected' | 'in_review',
    reviewerId: string,
    notes?: string,
  ): Promise<void> {
    try {
      await db.complianceReview.update({
        where: { id: verificationId },
        data: {
          status: decision.toUpperCase().replace('_', '_'),
          reviewerId,
          reviewedAt: new Date(),
          notes,
        },
      });
    } catch (err) {
      console.error('[KYC] Failed to review:', err);
    }
  }

  /**
   * List verifications.
   */
  async list(filter?: {
    status?: KYCStatus;
    type?: KYCType;
    entityId?: string;
    limit?: number;
  }): Promise<KYCVerification[]> {
    try {
      const where: Record<string, unknown> = {};
      if (filter?.status) where.status = filter.status.toUpperCase();
      if (filter?.type) where.type = filter.type.toUpperCase();
      if (filter?.entityId) where.entityId = filter.entityId;

      const rows = await db.complianceReview.findMany({
        where: { ...where, type: { in: ['KYC', 'KYB'] } },
        orderBy: { createdAt: 'desc' },
        take: filter?.limit ?? 100,
      });

      return rows.map((r) => {
        const data = r.data ? JSON.parse(r.data) : {};
        return {
          id: r.id,
          entityId: r.entityId,
          entityName: data.entityName || r.entityId,
          type: r.type.toLowerCase() as KYCType,
          status: r.status.toLowerCase().replace('_', '_') as KYCStatus,
          documents: data.documents || [],
          verifications: data.verifications || [],
          submittedAt: r.createdAt.getTime(),
          reviewedAt: r.reviewedAt?.getTime(),
          reviewedBy: r.reviewerId ?? undefined,
          notes: r.notes ?? undefined,
        } satisfies KYCVerification;
      });
    } catch {
      return [];
    }
  }

  /**
   * Get a single verification.
   */
  async get(verificationId: string): Promise<KYCVerification | null> {
    try {
      const r = await db.complianceReview.findUnique({
        where: { id: verificationId },
      });
      if (!r) return null;

      const data = r.data ? JSON.parse(r.data) : {};
      return {
        id: r.id,
        entityId: r.entityId,
        entityName: data.entityName || r.entityId,
        type: r.type.toLowerCase() as KYCType,
        status: r.status.toLowerCase().replace('_', '_') as KYCStatus,
        documents: data.documents || [],
        verifications: data.verifications || [],
        submittedAt: r.createdAt.getTime(),
        reviewedAt: r.reviewedAt?.getTime(),
        reviewedBy: r.reviewerId ?? undefined,
        notes: r.notes ?? undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * Expire verifications that have passed their validity period.
   */
  async expireStale(): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - KYC_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
      const result = await db.complianceReview.updateMany({
        where: {
          type: { in: ['KYC', 'KYB'] },
          status: 'APPROVED',
          createdAt: { lt: cutoff },
        },
        data: { status: 'EXPIRED' },
      });
      return result.count;
    } catch {
      return 0;
    }
  }
  /**
   * Request additional review (alias for review with 'in_review' status).
   */
  async requestReview(verificationId: string, reviewerId: string, notes?: string): Promise<void> {
    return this.review(verificationId, 'in_review', reviewerId, notes);
  }

  /**
   * Get KYC stats.
   */
  async stats(): Promise<{
    total: number;
    pending: number;
    inReview: number;
    approved: number;
    rejected: number;
    expired: number;
  }> {
    try {
      const all = await db.complianceReview.findMany({ where: { type: { in: ['KYC', 'KYB'] } } });
      return {
        total: all.length,
        pending: all.filter((k) => k.status === 'PENDING').length,
        inReview: all.filter((k) => k.status === 'IN_REVIEW').length,
        approved: all.filter((k) => k.status === 'APPROVED').length,
        rejected: all.filter((k) => k.status === 'REJECTED').length,
        expired: all.filter((k) => k.status === 'EXPIRED').length,
      };
    } catch {
      return { total: 0, pending: 0, inReview: 0, approved: 0, rejected: 0, expired: 0 };
    }
  }
}

export const kycService = new KYCService();
