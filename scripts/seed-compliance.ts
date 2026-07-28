/**
 * PaySwap Compliance Seed — creates realistic AML alerts, KYC reviews,
 * sanctions-screening hits, compliance cases and a SAR so the compliance
 * dashboard has demo data to test against.
 *
 * Idempotent: re-running it will skip rows whose deterministic id already
 * exists, so the seed can be re-run safely.
 *
 * Run with: `bun run scripts/seed-compliance.ts`
 */
import { db } from '../src/lib/db';

// Deterministic CUID-style ids so the seed is idempotent across runs. (These
// don't have to be valid CUIDs — Prisma only requires a unique string.)
const ID = (s: string) => `seed-compliance-${s}`;

async function main() {
  console.log('🛡️  Seeding compliance demo data...\n');

  // ─── Resolve reference data ─────────────────────────────────────────────
  const merchant = await db.merchant.findFirst({
    where: { email: 'merchant@payswap.demo' },
  });
  const customer = await db.customer.findFirst({
    where: { email: 'customer@payswap.demo' },
  });
  const complianceUser = await db.user.findUnique({
    where: { email: 'compliance@payswap.demo' },
  });
  const payments = await db.payment.findMany({
    orderBy: { createdAt: 'asc' },
    take: 12,
  });
  const payout = await db.payout.findFirst();

  if (!merchant || !customer || !complianceUser) {
    console.error(
      '❌ Missing base data — run `bun run scripts/seed.ts` first.',
    );
    process.exit(1);
  }

  const paymentIds = payments.map((p) => p.id);
  const paymentId = (i: number) =>
    paymentIds[i % Math.max(paymentIds.length, 1)];
  const payoutId = payout?.id ?? 'seed-payout-id';

  const complianceUserId = complianceUser.id;
  const reviewerId = complianceUserId; // the compliance officer reviews

  // ─── 1. AML Alerts ──────────────────────────────────────────────────────
  //
  // Mix of severities (LOW/MEDIUM/HIGH/CRITICAL) and statuses
  // (OPEN/INVESTIGATING/ESCALATED/CLOSED/SAR_FILED). Two of them are
  // SANCTIONS_HIT-typed alerts so the sanctions screening page has data too.
  type AlertSeed = {
    id: string;
    entityType: string;
    entityId: string;
    alertType: string;
    severity: string;
    score: number;
    status: string;
    details: Record<string, unknown>;
    daysAgo: number;
    closedDaysAgo?: number;
  };

  const alertSeeds: AlertSeed[] = [
    {
      id: ID('alert-1'),
      entityType: 'PAYMENT',
      entityId: paymentId(0),
      alertType: 'STRUCTURING',
      severity: 'HIGH',
      score: 0.86,
      status: 'OPEN',
      details: {
        scenario:
          'Customer split a GHS 9,500 deposit into 4 sub-10k transactions within 90 minutes.',
        threshold: 10000,
        txCount: 4,
        totalAmount: 9500,
        currency: 'GHS',
        merchantId: merchant.id,
      },
      daysAgo: 1,
    },
    {
      id: ID('alert-2'),
      entityType: 'PAYMENT',
      entityId: paymentId(2),
      alertType: 'VELOCITY',
      severity: 'MEDIUM',
      score: 0.62,
      status: 'INVESTIGATING',
      details: {
        scenario:
          'Customer completed 11 transactions in 25 minutes — 4x baseline velocity.',
        windowMinutes: 25,
        txCount: 11,
        baselinePerHour: 4,
      },
      daysAgo: 2,
    },
    {
      id: ID('alert-3'),
      entityType: 'CUSTOMER',
      entityId: customer.id,
      alertType: 'SANCTIONS_HIT',
      severity: 'CRITICAL',
      score: 0.97,
      status: 'ESCALATED',
      details: {
        scenario:
          'OFAC SDN fuzzy match: "Ama Serwaa" vs "Amah Serwah" (87% similarity). Manual adjudication required.',
        list: 'OFAC_SDN',
        matchedName: 'Amah Serwah',
        similarity: 0.87,
        matchField: 'name',
      },
      daysAgo: 3,
    },
    {
      id: ID('alert-4'),
      entityType: 'PAYOUT',
      entityId: payoutId,
      alertType: 'HIGH_RISK_CORRIDOR',
      severity: 'HIGH',
      score: 0.79,
      status: 'OPEN',
      details: {
        scenario:
          'Payout routed through a high-risk jurisdiction (FATF grey list). Enhanced due diligence required.',
        corridor: 'GHS→NGN',
        jurisdictionRisk: 'HIGH',
        fatfList: 'GREY',
      },
      daysAgo: 4,
    },
    {
      id: ID('alert-5'),
      entityType: 'PAYMENT',
      entityId: paymentId(5),
      alertType: 'PEP',
      severity: 'MEDIUM',
      score: 0.55,
      status: 'CLOSED',
      details: {
        scenario:
          'Customer flagged as Politically Exposed Person (PEP) — low-level local official, cleared after EDD.',
        pepList: 'WORLD_CHECK',
        role: 'Local Council Member',
        adjudication: 'FALSE_POSITIVE',
      },
      daysAgo: 7,
      closedDaysAgo: 5,
    },
    {
      id: ID('alert-6'),
      entityType: 'PAYMENT',
      entityId: paymentId(7),
      alertType: 'SANCTIONS_HIT',
      severity: 'HIGH',
      score: 0.81,
      status: 'OPEN',
      details: {
        scenario:
          'Beneficial owner name match against EU consolidated sanctions list.',
        list: 'EU_CONSOLIDATED',
        matchedName: 'Kofi Boateng',
        similarity: 0.92,
        matchField: 'beneficial_owner',
      },
      daysAgo: 1,
    },
    {
      id: ID('alert-7'),
      entityType: 'PAYMENT',
      entityId: paymentId(9),
      alertType: 'STRUCTURING',
      severity: 'CRITICAL',
      score: 0.94,
      status: 'SAR_FILED',
      details: {
        scenario:
          'Repeated structuring pattern across 3 days. Suspected layering of illicit funds.',
        pattern: 'multi_day_structuring',
        txCount: 12,
        totalAmount: 28500,
        currency: 'GHS',
        sarId: ID('sar-1'),
      },
      daysAgo: 14,
      closedDaysAgo: 10,
    },
    {
      id: ID('alert-8'),
      entityType: 'MERCHANT',
      entityId: merchant.id,
      alertType: 'VELOCITY',
      severity: 'LOW',
      score: 0.32,
      status: 'OPEN',
      details: {
        scenario:
          'Merchant transaction velocity up 18% week-over-week — within normal seasonal range but flagged for monitoring.',
        wowChange: 0.18,
        baseline: 240,
        current: 283,
      },
      daysAgo: 2,
    },
  ];

  let alertCount = 0;
  for (const a of alertSeeds) {
    const existing = await db.aMLAlert.findUnique({ where: { id: a.id } });
    if (existing) {
      continue;
    }
    const createdAt = new Date(Date.now() - a.daysAgo * 86400000);
    const closedAt = a.closedDaysAgo
      ? new Date(Date.now() - a.closedDaysAgo * 86400000)
      : null;
    await db.aMLAlert.create({
      data: {
        id: a.id,
        entityType: a.entityType,
        entityId: a.entityId,
        alertType: a.alertType,
        severity: a.severity,
        score: a.score,
        details: JSON.stringify(a.details),
        status: a.status,
        assignedTo:
          a.status === 'INVESTIGATING' || a.status === 'ESCALATED'
            ? complianceUserId
            : null,
        environment: 'sandbox',
        createdAt,
        closedAt,
      },
    });
    alertCount++;
  }
  console.log(`✅ ${alertCount} AML alerts (of ${alertSeeds.length} planned)`);

  // ─── 2. KYC Compliance Reviews ─────────────────────────────────────────
  //
  // Mix of PENDING/APPROVED/REJECTED/REVIEW_NEEDED statuses. Some link to
  // the merchant (KYB), some to the customer (KYC).
  type KycSeed = {
    id: string;
    entityType: string;
    entityId: string;
    status: string;
    type: string;
    notes?: string;
    data: Record<string, unknown>;
    daysAgo: number;
    reviewedDaysAgo?: number;
  };

  const kycSeeds: KycSeed[] = [
    {
      id: ID('kyc-1'),
      entityType: 'CUSTOMER',
      entityId: customer.id,
      status: 'PENDING',
      type: 'KYC',
      data: {
        documentType: 'NATIONAL_ID',
        country: 'Ghana',
        submittedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
      },
      daysAgo: 1,
    },
    {
      id: ID('kyc-2'),
      entityType: 'CUSTOMER',
      entityId: customer.id,
      status: 'REVIEW_NEEDED',
      type: 'KYC',
      notes:
        'Identity documents need re-review — address mismatch on utility bill.',
      data: {
        documentType: 'NATIONAL_ID',
        country: 'Ghana',
        mismatchField: 'address',
        submittedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
      },
      daysAgo: 4,
    },
    {
      id: ID('kyc-3'),
      entityType: 'CUSTOMER',
      entityId: customer.id,
      status: 'APPROVED',
      type: 'KYC',
      notes: 'Identity verified against national ID registry.',
      data: {
        documentType: 'NATIONAL_ID',
        country: 'Ghana',
        verificationMethod: 'BIOMETRIC',
      },
      daysAgo: 12,
      reviewedDaysAgo: 11,
    },
    {
      id: ID('kyc-4'),
      entityType: 'CUSTOMER',
      entityId: customer.id,
      status: 'REJECTED',
      type: 'KYC',
      notes:
        'Identity document expired. Customer must re-submit a valid ID before re-applying.',
      data: {
        documentType: 'PASSPORT',
        country: 'Ghana',
        expiryDate: '2024-12-31',
      },
      daysAgo: 20,
      reviewedDaysAgo: 18,
    },
    {
      id: ID('kyc-5'),
      entityType: 'CUSTOMER',
      entityId: customer.id,
      status: 'PENDING',
      type: 'KYC',
      data: {
        documentType: 'PASSPORT',
        country: 'Ghana',
        submittedAt: new Date(Date.now() - 0.2 * 86400000).toISOString(),
      },
      daysAgo: 0,
    },
  ];

  let kycCount = 0;
  for (const k of kycSeeds) {
    const existing = await db.complianceReview.findUnique({
      where: { id: k.id },
    });
    if (existing) continue;
    const createdAt = new Date(Date.now() - k.daysAgo * 86400000);
    const reviewedAt = k.reviewedDaysAgo
      ? new Date(Date.now() - k.reviewedDaysAgo * 86400000)
      : null;
    await db.complianceReview.create({
      data: {
        id: k.id,
        entityType: k.entityType,
        entityId: k.entityId,
        type: k.type,
        status: k.status,
        data: JSON.stringify(k.data),
        reviewerId:
          k.status === 'APPROVED' || k.status === 'REJECTED'
            ? reviewerId
            : null,
        reviewedAt,
        notes: k.notes ?? null,
        createdAt,
      },
    });
    kycCount++;
  }
  console.log(`✅ ${kycCount} KYC reviews (of ${kycSeeds.length} planned)`);

  // ─── 3. Compliance Cases (ComplianceReview with type='CASE') ──────────
  //
  // Each case links one or more AML alerts + KYC reviews through the
  // `data` JSON field (alertIds / kycIds / description).
  type CaseSeed = {
    id: string;
    entityType: string;
    entityId: string;
    status: string;
    description: string;
    alertIds: string[];
    kycIds: string[];
    daysAgo: number;
    reviewedDaysAgo?: number;
  };

  const caseSeeds: CaseSeed[] = [
    {
      id: ID('case-1'),
      entityType: 'PAYMENT',
      entityId: paymentId(0),
      status: 'OPEN',
      description:
        'Structuring pattern detected on PAY-0001. Opening investigation to determine source of funds.',
      alertIds: [ID('alert-1')],
      kycIds: [ID('kyc-2')],
      daysAgo: 1,
    },
    {
      id: ID('case-2'),
      entityType: 'CUSTOMER',
      entityId: customer.id,
      status: 'ESCALATED',
      description:
        'OFAC sanctions fuzzy match — escalated to MLRO for adjudication.',
      alertIds: [ID('alert-3')],
      kycIds: [ID('kyc-1')],
      daysAgo: 3,
    },
    {
      id: ID('case-3'),
      entityType: 'PAYMENT',
      entityId: paymentId(9),
      status: 'CLOSED',
      description:
        'Multi-day structuring case closed after SAR filed. Funds held pending law enforcement response.',
      alertIds: [ID('alert-7')],
      kycIds: [],
      daysAgo: 14,
      reviewedDaysAgo: 10,
    },
    {
      id: ID('case-4'),
      entityType: 'PAYOUT',
      entityId: payoutId,
      status: 'OPEN',
      description:
        'High-risk corridor payout held for EDD. Requesting beneficial owner declaration from merchant.',
      alertIds: [ID('alert-4'), ID('alert-6')],
      kycIds: [ID('kyc-2')],
      daysAgo: 4,
    },
    {
      id: ID('case-5'),
      entityType: 'MERCHANT',
      entityId: merchant.id,
      status: 'APPROVED',
      description:
        'Merchant velocity alert reviewed — confirmed seasonal uplift, no action required.',
      alertIds: [ID('alert-8')],
      kycIds: [],
      daysAgo: 2,
      reviewedDaysAgo: 1,
    },
  ];

  let caseCount = 0;
  for (const c of caseSeeds) {
    const existing = await db.complianceReview.findUnique({
      where: { id: c.id },
    });
    if (existing) continue;
    const createdAt = new Date(Date.now() - c.daysAgo * 86400000);
    const reviewedAt = c.reviewedDaysAgo
      ? new Date(Date.now() - c.reviewedDaysAgo * 86400000)
      : null;
    await db.complianceReview.create({
      data: {
        id: c.id,
        entityType: c.entityType,
        entityId: c.entityId,
        type: 'CASE',
        status: c.status,
        data: JSON.stringify({
          description: c.description,
          alertIds: c.alertIds,
          kycIds: c.kycIds,
          openedBy: complianceUserId,
        }),
        reviewerId:
          c.status === 'APPROVED' ||
          c.status === 'REJECTED' ||
          c.status === 'CLOSED'
            ? reviewerId
            : null,
        reviewedAt,
        notes: c.description,
        createdAt,
      },
    });
    caseCount++;
  }
  console.log(`✅ ${caseCount} cases (of ${caseSeeds.length} planned)`);

  // ─── 4. SAR (Suspicious Activity Report) ───────────────────────────────
  //
  // One filed SAR linked to the multi-day structuring case.
  const sarId = ID('sar-1');
  const existingSar = await db.sAR.findUnique({ where: { id: sarId } });
  if (!existingSar) {
    await db.sAR.create({
      data: {
        id: sarId,
        caseId: ID('case-3'),
        filedBy: complianceUserId,
        narrative:
          'Customer Ama Serwaa engaged in a structured deposit pattern over 3 days, splitting GHS 28,500 across 12 sub-10k transactions. Beneficial owner linked to a PEP. Funds held pending law enforcement response.',
        amount: 28500,
        entities: JSON.stringify([
          { type: 'CUSTOMER', id: customer.id, name: customer.name },
          { type: 'PAYMENT', id: paymentId(9) },
        ]),
        regulatoryRef: 'FIU-GH-2025-00471',
        status: 'FILED',
        filedAt: new Date(Date.now() - 10 * 86400000),
        createdAt: new Date(Date.now() - 11 * 86400000),
      },
    });
    console.log('✅ 1 SAR (1 planned)');
  } else {
    console.log('⏭️  SAR already exists');
  }

  // ─── Summary ───────────────────────────────────────────────────────────
  const totalAlerts = await db.aMLAlert.count();
  const totalKyc = await db.complianceReview.count({
    where: { type: 'KYC' },
  });
  const totalCases = await db.complianceReview.count({
    where: { type: 'CASE' },
  });
  const totalSars = await db.sAR.count();
  const sanctionsHits = await db.aMLAlert.count({
    where: { alertType: { contains: 'SANCTION' } },
  });

  console.log('\n🎉 Compliance seed complete!');
  console.log('━━━ Database state ━━━');
  console.log(`AML alerts:        ${totalAlerts}`);
  console.log(`  └─ sanctions hits: ${sanctionsHits}`);
  console.log(`KYC reviews:       ${totalKyc}`);
  console.log(`Compliance cases:  ${totalCases}`);
  console.log(`SARs filed:        ${totalSars}`);
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error('Seed failed:', e);
    db.$disconnect();
    process.exit(1);
  });
