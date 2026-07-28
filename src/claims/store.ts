/**
 * Claims OS — in-memory store for disputes / claims with evidence + voting.
 *
 * (Task FEATURES-1.)
 *
 * Three record kinds:
 *
 * 1. `Claim` — a user disputes a transaction. Created by a merchant (or any
 *    authenticated user). Has a type, description, status (open / under_review /
 *    approved / rejected / vetoed / resolved), and a list of evidence + votes.
 *
 * 2. `Evidence` — supporting material for a claim (text, file reference,
 *    screenshot URL, transaction log, etc.). Submitted by the claimant or
 *    community.
 *
 * 3. `Vote` — a community vote on a claim (support / reject) with an optional
 *    comment. The admin can veto (override) the community vote at any time.
 *
 * Records live on `globalThis.__PAYSWAP_CLAIMS_STORE__` so dev-mode module
 * re-instantiation does not lose data. The Prisma schema is NOT modified
 * (constraint: frozen).
 */

import { uid } from '@/runtime/types';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ClaimType =
  | 'unauthorized_transaction'
  | 'duplicate_charge'
  | 'product_not_received'
  | 'product_not_as_described'
  | 'incorrect_amount'
  | 'refund_not_processed'
  | 'fraud'
  | 'settlement_failure'
  | 'other';

export type ClaimStatus =
  | 'open'           // newly created, awaiting review
  | 'under_review'   // community voting / admin investigation
  | 'approved'       // community approved (claimant wins)
  | 'rejected'       // community rejected (claimant loses)
  | 'vetoed'         // admin overrode the community vote
  | 'resolved';      // closed (any reason) — terminal

export type EvidenceType =
  | 'text'
  | 'file_reference'
  | 'screenshot'
  | 'transaction_log'
  | 'communication'
  | 'other';

export interface Evidence {
  id: string;
  claimId: string;
  /** What kind of evidence this is. */
  type: EvidenceType;
  /** Human-readable description of what this evidence shows. */
  description: string;
  /** External reference (file URL, hash, log id, etc.). Optional. */
  reference?: string;
  /** User ID of the submitter. */
  submittedByUserId?: string;
  /** Email of the submitter. */
  submittedByEmail?: string;
  /** ISO timestamp (ms). */
  submittedAt: number;
}

export type VoteChoice = 'support' | 'reject';

export interface Vote {
  id: string;
  claimId: string;
  /** support or reject the claim. */
  vote: VoteChoice;
  /** Optional comment explaining the vote. */
  comment?: string;
  /** User ID of the voter. */
  voterUserId?: string;
  /** Email of the voter. */
  voterEmail?: string;
  /** ISO timestamp (ms). */
  votedAt: number;
}

export type ResolutionDecision =
  | 'approved'      // admin agrees with claimant
  | 'rejected'      // admin disagrees with claimant
  | 'vetoed';       // admin overrides the community vote (in either direction)

export interface Resolution {
  decision: ResolutionDecision;
  notes?: string;
  resolvedByUserId?: string;
  resolvedByEmail?: string;
  resolvedAt: number;
  /** Tally of community votes at the time of resolution. */
  communityTally: { support: number; reject: number };
}

export interface Claim {
  id: string;
  /** Transaction / payment being disputed. */
  transactionId: string;
  /** Type of dispute. */
  type: ClaimType;
  /** Free-text description. */
  description: string;
  /** Status. */
  status: ClaimStatus;
  /** User ID of the claimant. */
  claimantUserId?: string;
  /** Email of the claimant. */
  claimantEmail?: string;
  /** Merchant ID (if the claim is merchant-scoped). */
  merchantId?: string;
  /** ISO timestamp (ms) when the claim was created. */
  createdAt: number;
  /** ISO timestamp (ms) when the claim was last updated. */
  updatedAt: number;
  /** ISO timestamp (ms) when the claim was resolved. */
  resolvedAt?: number;
  /** Resolution record (if resolved/vetoed). */
  resolution?: Resolution;
  /** Evidence submitted for this claim. */
  evidence: Evidence[];
  /** Votes cast on this claim. */
  votes: Vote[];
}

// ─── Store shape ─────────────────────────────────────────────────────────────

export interface ClaimsStore {
  claims: Map<string, Claim>;
}

function createStore(): ClaimsStore {
  return { claims: new Map() };
}

const globalForClaims = globalThis as unknown as {
  __PAYSWAP_CLAIMS_STORE__?: ClaimsStore;
  __PAYSWAP_CLAIMS_SEEDED__?: boolean;
};

export const store: ClaimsStore =
  globalForClaims.__PAYSWAP_CLAIMS_STORE__ ?? createStore();

if (!globalForClaims.__PAYSWAP_CLAIMS_STORE__) {
  globalForClaims.__PAYSWAP_CLAIMS_STORE__ = store;
}

// ─── Seed ─────────────────────────────────────────────────────────────────
//
// Seed a few representative claims so the admin and merchant pages have
// content on first load.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function ago(msAgo: number): number {
  return Date.now() - msAgo;
}

export function seedClaimsStore(): void {
  if (globalForClaims.__PAYSWAP_CLAIMS_SEEDED__) return;
  globalForClaims.__PAYSWAP_CLAIMS_SEEDED__ = true;

  const seeds: Claim[] = [
    {
      id: uid('clm'),
      transactionId: 'pay_seed_001',
      type: 'unauthorized_transaction',
      description:
        'Customer reports they did not authorize this 4,500 GHS charge. Their card was in their possession at the time of the transaction.',
      status: 'open',
      claimantEmail: 'merchant@payswap.demo',
      merchantId: 'seed-merchant-1',
      createdAt: ago(2 * HOUR),
      updatedAt: ago(2 * HOUR),
      evidence: [
        {
          id: uid('evd'),
          claimId: '',
          type: 'text',
          description: 'Card statement showing the disputed transaction',
          submittedByEmail: 'merchant@payswap.demo',
          submittedAt: ago(2 * HOUR),
        },
        {
          id: uid('evd'),
          claimId: '',
          type: 'screenshot',
          description: 'Screenshot of the customer email reporting the dispute',
          reference: 'file://evidence/dispute-email-001.png',
          submittedByEmail: 'merchant@payswap.demo',
          submittedAt: ago(90 * 60 * 1000),
        },
      ],
      votes: [
        {
          id: uid('vote'),
          claimId: '',
          vote: 'support',
          comment: 'Customer has a strong case — the IP geolocation does not match.',
          voterEmail: 'compliance@payswap.demo',
          votedAt: ago(1 * HOUR),
        },
      ],
    },
    {
      id: uid('clm'),
      transactionId: 'pay_seed_002',
      type: 'refund_not_processed',
      description:
        'Customer returned the product 12 days ago but the refund has not been credited. Refund reference: ref_seed_002.',
      status: 'under_review',
      claimantEmail: 'merchant@payswap.demo',
      merchantId: 'seed-merchant-1',
      createdAt: ago(1 * DAY),
      updatedAt: ago(3 * HOUR),
      evidence: [
        {
          id: uid('evd'),
          claimId: '',
          type: 'transaction_log',
          description: 'Refund initiated log from merchant dashboard',
          reference: 'log://refund/ref_seed_002',
          submittedByEmail: 'merchant@payswap.demo',
          submittedAt: ago(1 * DAY),
        },
        {
          id: uid('evd'),
          claimId: '',
          type: 'communication',
          description: 'Customer support thread showing the return authorization',
          reference: 'thread://support/case_002',
          submittedByEmail: 'support@payswap.demo',
          submittedAt: ago(20 * HOUR),
        },
      ],
      votes: [
        {
          id: uid('vote'),
          claimId: '',
          vote: 'support',
          comment: 'Merchant seems to have initiated the refund — bank delay likely.',
          voterEmail: 'ops@payswap.demo',
          votedAt: ago(18 * HOUR),
        },
        {
          id: uid('vote'),
          claimId: '',
          vote: 'reject',
          comment: 'Refund window has elapsed — needs treasury escalation.',
          voterEmail: 'treasury@payswap.io',
          votedAt: ago(15 * HOUR),
        },
        {
          id: uid('vote'),
          claimId: '',
          vote: 'support',
          voterEmail: 'compliance@payswap.demo',
          votedAt: ago(10 * HOUR),
        },
      ],
    },
    {
      id: uid('clm'),
      transactionId: 'pay_seed_003',
      type: 'duplicate_charge',
      description:
        'Two charges for the same order ID appeared 12 seconds apart. One should be refunded.',
      status: 'approved',
      claimantEmail: 'developer@payswap.demo',
      merchantId: 'seed-merchant-1',
      createdAt: ago(5 * DAY),
      updatedAt: ago(4 * DAY),
      resolvedAt: ago(4 * DAY),
      resolution: {
        decision: 'approved',
        notes: 'Duplicate confirmed. Refund of second charge issued.',
        resolvedByEmail: 'admin@payswap.io',
        resolvedAt: ago(4 * DAY),
        communityTally: { support: 4, reject: 0 },
      },
      evidence: [
        {
          id: uid('evd'),
          claimId: '',
          type: 'transaction_log',
          description: 'Two payment records with identical order ID',
          reference: 'log://payments/order_003',
          submittedByEmail: 'developer@payswap.demo',
          submittedAt: ago(5 * DAY),
        },
      ],
      votes: [
        {
          id: uid('vote'),
          claimId: '',
          vote: 'support',
          voterEmail: 'ops@payswap.demo',
          votedAt: ago(5 * DAY),
        },
        {
          id: uid('vote'),
          claimId: '',
          vote: 'support',
          voterEmail: 'compliance@payswap.demo',
          votedAt: ago(4 * DAY + 6 * HOUR),
        },
      ],
    },
    {
      id: uid('clm'),
      transactionId: 'pay_seed_004',
      type: 'fraud',
      description:
        'Velocity check flagged this transaction. Customer claims the charge is legitimate but the device fingerprint is new.',
      status: 'vetoed',
      claimantEmail: 'merchant@payswap.demo',
      merchantId: 'seed-merchant-2',
      createdAt: ago(8 * DAY),
      updatedAt: ago(7 * DAY),
      resolvedAt: ago(7 * DAY),
      resolution: {
        decision: 'vetoed',
        notes:
          'Admin veto — community voted to approve but sanctions screening flagged the customer. Claim rejected.',
        resolvedByEmail: 'admin@payswap.io',
        resolvedAt: ago(7 * DAY),
        communityTally: { support: 5, reject: 1 },
      },
      evidence: [
        {
          id: uid('evd'),
          claimId: '',
          type: 'text',
          description: 'Customer KYC profile showing newly-verified identity',
          submittedByEmail: 'merchant@payswap.demo',
          submittedAt: ago(8 * DAY),
        },
        {
          id: uid('evd'),
          claimId: '',
          type: 'transaction_log',
          description: 'Sanctions screening hit log',
          reference: 'log://sanctions/screen_004',
          submittedByEmail: 'compliance@payswap.demo',
          submittedAt: ago(7 * DAY + 6 * HOUR),
        },
      ],
      votes: [
        {
          id: uid('vote'),
          claimId: '',
          vote: 'support',
          comment: 'Customer KYC is verified — likely a false positive.',
          voterEmail: 'ops@payswap.demo',
          votedAt: ago(8 * DAY),
        },
        {
          id: uid('vote'),
          claimId: '',
          vote: 'support',
          voterEmail: 'support@payswap.demo',
          votedAt: ago(7 * DAY + 12 * HOUR),
        },
        {
          id: uid('vote'),
          claimId: '',
          vote: 'reject',
          comment: 'Sanctions hit is high-confidence — veto recommended.',
          voterEmail: 'compliance@payswap.demo',
          votedAt: ago(7 * DAY + 4 * HOUR),
        },
      ],
    },
  ];

  // Fix up claimId references on evidence/votes.
  for (const c of seeds) {
    for (const e of c.evidence) e.claimId = c.id;
    for (const v of c.votes) v.claimId = c.id;
    store.claims.set(c.id, c);
  }
}

// Auto-seed on first import.
seedClaimsStore();

// ─── Service ─────────────────────────────────────────────────────────────────

export interface CreateClaimInput {
  transactionId: string;
  type: ClaimType;
  description: string;
  claimantUserId?: string;
  claimantEmail?: string;
  merchantId?: string;
}

export interface SubmitEvidenceInput {
  type: EvidenceType;
  description: string;
  reference?: string;
  submittedByUserId?: string;
  submittedByEmail?: string;
}

export interface CastVoteInput {
  vote: VoteChoice;
  comment?: string;
  voterUserId?: string;
  voterEmail?: string;
}

export interface ResolveClaimInput {
  decision: ResolutionDecision;
  notes?: string;
  resolvedByUserId?: string;
  resolvedByEmail?: string;
}

export interface ClaimsService {
  list(filter?: {
    status?: ClaimStatus;
    merchantId?: string;
    claimantUserId?: string;
    transactionId?: string;
    q?: string;
  }): Claim[];
  get(id: string): Claim | null;
  create(input: CreateClaimInput): Claim;
  submitEvidence(claimId: string, input: SubmitEvidenceInput): Evidence | null;
  castVote(claimId: string, input: CastVoteInput): Vote | null;
  resolve(claimId: string, input: ResolveClaimInput): Claim | null;
  tally(claimId: string): { support: number; reject: number };
  overview(): {
    total: number;
    open: number;
    underReview: number;
    approved: number;
    rejected: number;
    vetoed: number;
    resolved: number;
  };
}

export const claimsService: ClaimsService = {
  list(filter) {
    let rows = Array.from(store.claims.values());
    if (filter?.status) rows = rows.filter((c) => c.status === filter.status);
    if (filter?.merchantId)
      rows = rows.filter((c) => c.merchantId === filter.merchantId);
    if (filter?.claimantUserId)
      rows = rows.filter((c) => c.claimantUserId === filter.claimantUserId);
    if (filter?.transactionId)
      rows = rows.filter((c) => c.transactionId === filter.transactionId);
    if (filter?.q) {
      const q = filter.q.toLowerCase();
      rows = rows.filter(
        (c) =>
          c.description.toLowerCase().includes(q) ||
          c.transactionId.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q),
      );
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },

  get(id) {
    return store.claims.get(id) ?? null;
  },

  create(input) {
    const now = Date.now();
    const claim: Claim = {
      id: uid('clm'),
      transactionId: input.transactionId,
      type: input.type,
      description: input.description,
      status: 'open',
      claimantUserId: input.claimantUserId,
      claimantEmail: input.claimantEmail,
      merchantId: input.merchantId,
      createdAt: now,
      updatedAt: now,
      evidence: [],
      votes: [],
    };
    store.claims.set(claim.id, claim);
    return claim;
  },

  submitEvidence(claimId, input) {
    const c = store.claims.get(claimId);
    if (!c) return null;
    if (c.status === 'resolved') return null;
    const ev: Evidence = {
      id: uid('evd'),
      claimId,
      type: input.type,
      description: input.description,
      reference: input.reference,
      submittedByUserId: input.submittedByUserId,
      submittedByEmail: input.submittedByEmail,
      submittedAt: Date.now(),
    };
    c.evidence.push(ev);
    c.updatedAt = Date.now();
    // If the claim was open, mark it under_review now that there's evidence.
    if (c.status === 'open') c.status = 'under_review';
    return ev;
  },

  castVote(claimId, input) {
    const c = store.claims.get(claimId);
    if (!c) return null;
    if (c.status === 'resolved' || c.status === 'vetoed') return null;
    // One vote per user — replace any existing vote by the same voter.
    if (input.voterUserId || input.voterEmail) {
      const existingIdx = c.votes.findIndex(
        (v) =>
          (input.voterUserId && v.voterUserId === input.voterUserId) ||
          (input.voterEmail && v.voterEmail === input.voterEmail),
      );
      if (existingIdx >= 0) {
        c.votes[existingIdx] = {
          ...c.votes[existingIdx],
          vote: input.vote,
          comment: input.comment,
          votedAt: Date.now(),
        };
        c.updatedAt = Date.now();
        return c.votes[existingIdx];
      }
    }
    const vote: Vote = {
      id: uid('vote'),
      claimId,
      vote: input.vote,
      comment: input.comment,
      voterUserId: input.voterUserId,
      voterEmail: input.voterEmail,
      votedAt: Date.now(),
    };
    c.votes.push(vote);
    c.updatedAt = Date.now();
    // If the claim was open, mark it under_review now that there's a vote.
    if (c.status === 'open') c.status = 'under_review';
    return vote;
  },

  resolve(claimId, input) {
    const c = store.claims.get(claimId);
    if (!c) return null;
    const tally = claimsService.tally(claimId);
    const resolution: Resolution = {
      decision: input.decision,
      notes: input.notes,
      resolvedByUserId: input.resolvedByUserId,
      resolvedByEmail: input.resolvedByEmail,
      resolvedAt: Date.now(),
      communityTally: tally,
    };
    c.resolution = resolution;
    c.resolvedAt = Date.now();
    c.updatedAt = Date.now();
    // Map decision → status. Vetoed is a special status; approved/rejected
    // map to themselves; resolved covers everything else.
    if (input.decision === 'vetoed') c.status = 'vetoed';
    else if (input.decision === 'approved') c.status = 'approved';
    else if (input.decision === 'rejected') c.status = 'rejected';
    else c.status = 'resolved';
    return c;
  },

  tally(claimId) {
    const c = store.claims.get(claimId);
    if (!c) return { support: 0, reject: 0 };
    return {
      support: c.votes.filter((v) => v.vote === 'support').length,
      reject: c.votes.filter((v) => v.vote === 'reject').length,
    };
  },

  overview() {
    const rows = Array.from(store.claims.values());
    return {
      total: rows.length,
      open: rows.filter((c) => c.status === 'open').length,
      underReview: rows.filter((c) => c.status === 'under_review').length,
      approved: rows.filter((c) => c.status === 'approved').length,
      rejected: rows.filter((c) => c.status === 'rejected').length,
      vetoed: rows.filter((c) => c.status === 'vetoed').length,
      resolved: rows.filter((c) => c.status === 'resolved').length,
    };
  },
};
