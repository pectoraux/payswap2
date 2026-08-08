/**
 * PaySwap Protocol — Production Connectors v2 — Attestation Evidence Builder.
 *
 * `buildAttestationEvidence` is the convenience factory connectors call from
 * their `buildEvidence()` override to produce a kernel-grade `Evidence` of
 * type `attestation`. It centralises the common fields every connector
 * needs (source, verification level, attester identity, reputation, TTL)
 * so individual rail adapters don't repeat the boilerplate.
 *
 * The signature/HMAC stamping is applied later by `ProductionConnector`
 * (see `base.ts`) once it has the assembled Evidence in hand — that way the
 * signature covers the connector-specific payload too.
 */
import type { Evidence, EvidenceSource, VerificationLevel } from '@/kernel/evidence';
import { createEvidence } from '@/kernel/evidence';

/** Parameters accepted by `buildAttestationEvidence`. */
export interface BuildAttestationEvidenceParams {
  /** Where the attestation came from (open_banking, lp_attestation, …). */
  source: EvidenceSource;
  /** How strongly the source verifies the claim. */
  verificationLevel: VerificationLevel;
  /** The entity this evidence is about (account id, address, …). */
  entityId: string;
  /** Who is making the attestation (connector id). */
  attester: string;
  /** 0..1 — reputation of the attester. */
  reputation?: number;
  /** Optional attested amount (fiat/liquidity). */
  attestedAmount?: number;
  /** Optional currency for the attested amount. */
  currency?: string;
  /** Optional jurisdiction tag (e.g. 'EU', 'US-CA'). */
  jurisdiction?: string;
  /** Optional type-specific payload. */
  payload?: Record<string, unknown>;
  /** Optional TTL override (ms). */
  ttlMs?: number;
}

/**
 * Build an `attestation`-type `Evidence` from connector-supplied fields.
 * The returned object is a plain Evidence — `ProductionConnector.query`
 * will stamp the HMAC-SHA256 signature into `payload.signature` and
 * overwrite `evidenceHash` with the signature string after this returns.
 */
export function buildAttestationEvidence(
  params: BuildAttestationEvidenceParams,
): Evidence {
  return createEvidence({
    type: 'attestation',
    source: params.source,
    verificationLevel: params.verificationLevel,
    entityId: params.entityId,
    attester: params.attester,
    reputation: params.reputation ?? 0.5,
    attestedAmount: params.attestedAmount,
    currency: params.currency,
    jurisdiction: params.jurisdiction,
    ttlMs: params.ttlMs,
    payload: params.payload ?? {},
  });
}
