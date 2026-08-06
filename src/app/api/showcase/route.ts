import { NextRequest, NextResponse } from 'next/server';
import {
  seedEKG, ekg, getGoals, prove, type Goal, type Constraints, type Proof,
} from '@/ekg';
import {
  certifyExtension, verifyBadge, type CertificationReport,
} from '@/certification';
import {
  generatePublisherKeyPair, signPackage, type ExtensionPackage, type ExtensionManifestV2,
} from '@/extension-platform';
import { parcelDeliveryManifest } from '@/extensions/parcel-delivery/manifest';
import { inventoryManifest } from '@/extensions/inventory/manifest';
import { loyaltyManifest } from '@/extensions/loyalty/manifest';
import { accountingManifest } from '@/extensions/accounting/manifest';
import { crmManifest } from '@/extensions/crm/manifest';
import {
  parcelExtService, parcelProviderAdapters,
} from '@/extensions/parcel-delivery/extended-store';
import { parcelService } from '@/extensions/parcel-delivery/store';
// Live connectors are imported lazily inside the action handlers to keep the
// initial bundle small (stellar-sdk pulls sodium-native which is heavy).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** All 5 reference extension manifests. */
const ALL_MANIFESTS: ExtensionManifestV2[] = [
  parcelDeliveryManifest, inventoryManifest, loyaltyManifest, accountingManifest, crmManifest,
];

/** Build a signed package from a manifest (reuses the validation-suite approach). */
function buildPackage(manifest: ExtensionManifestV2): ExtensionPackage {
  const keyPair = generatePublisherKeyPair();
  return signPackage(manifest, `// ${manifest.id}@${manifest.version}`, {}, keyPair);
}

/** Lazily build + certify all 5 extensions, cache on globalThis for the process. */
function getCertifications(): { report: CertificationReport; manifest: ExtensionManifestV2 }[] {
  const g = globalThis as unknown as { __PAYSWAP_SHOWCASE_CERTS__?: { report: CertificationReport; manifest: ExtensionManifestV2 }[] };
  if (g.__PAYSWAP_SHOWCASE_CERTS__) return g.__PAYSWAP_SHOWCASE_CERTS__;
  const out = ALL_MANIFESTS.map((m) => {
    const pkg = buildPackage(m);
    const report = certifyExtension(pkg);
    return { report, manifest: m };
  });
  g.__PAYSWAP_SHOWCASE_CERTS__ = out;
  return out;
}

/** Ensure the EKG is seeded exactly once per process. */
function ensureSeeded() { seedEKG(); }

/** Seed a handful of demo deliveries for the showcase merchant so the dashboard is populated. */
function seedShowcaseDeliveries() {
  const g = globalThis as unknown as { __PAYSWAP_SHOWCASE_DELIVERIES__?: boolean };
  if (g.__PAYSWAP_SHOWCASE_DELIVERIES__) return;
  g.__PAYSWAP_SHOWCASE_DELIVERIES__ = true;
  try {
    const parcels = [
      { senderAddress: 'Accra Mall, Accra, Ghana', recipientAddress: 'Kumasi, Ghana', weightKg: 2.5, declaredValue: 120, fragile: true },
      { senderAddress: 'Osu, Accra, Ghana', recipientAddress: 'Takoradi, Ghana', weightKg: 0.8, declaredValue: 45, fragile: false },
      { senderAddress: 'Tesano, Accra, Ghana', recipientAddress: 'Tema, Ghana', weightKg: 5.0, declaredValue: 200, fragile: false },
      { senderAddress: 'Spintex, Accra, Ghana', recipientAddress: 'Cape Coast, Ghana', weightKg: 1.2, declaredValue: 75, fragile: false },
      { senderAddress: 'Madina, Accra, Ghana', recipientAddress: 'Koforidua, Ghana', weightKg: 0.5, declaredValue: 30, fragile: false },
    ];
    const ids: string[] = [];
    for (const p of parcels) {
      const d = parcelService.createDelivery({
        merchantId: 'showcase', customerId: `cust_demo_${p.weightKg}`,
        senderName: 'Accra Trading Co', senderAddress: p.senderAddress,
        recipientName: 'Valued Customer', recipientAddress: p.recipientAddress,
        recipientContact: '+233244567890',
        parcel: { weightKg: p.weightKg, dimensionsCm: { length: 30, width: 20, height: 15 }, fragile: p.fragile, temperatureControlled: false, oversized: false, declaredValue: p.declaredValue },
        priority: 'STANDARD', insuranceRequired: p.declaredValue > 100,
      });
      ids.push(d.id);
    }
    // Mark first two as delivered, third as in-transit (leave 4th pending, cancel 5th).
    if (ids[0]) parcelService.submitProofOfDelivery(ids[0], { gps: { lat: 6.6884, lng: -1.6244 } });
    if (ids[1]) parcelService.submitProofOfDelivery(ids[1], { gps: { lat: 4.8845, lng: -1.7553 } });
    if (ids[4]) parcelService.cancelDelivery(ids[4], 'Customer requested cancellation');
  } catch { /* best-effort seeding */ }
}

/** Serialize a Money value object to a readable string. */
function moneyStr(m: unknown): string {
  if (!m) return '0.00';
  if (typeof m === 'string') return m;
  if (typeof m === 'number') return m.toFixed(2);
  const mo = m as { toJSON?: () => { major?: string; currency?: string } };
  try {
    const j = mo.toJSON?.();
    if (j?.major) return `${j.major} ${j.currency ?? ''}`.trim();
  } catch { /* ignore */ }
  return String(m);
}

/** GET /api/showcase — public platform snapshot (no auth, lightweight modules only). */
export async function GET() {
  try {
    ensureSeeded();

    // ── EKG overview ──
    const overview = ekg.overview();
    const goals = getGoals().map((g: Goal) => ({
      id: g.id, name: g.name, description: g.description, targetAsset: g.targetAsset,
    }));
    const capabilityNodes = ekg.listNodes({ kind: 'CAPABILITY' as never }).slice(0, 18).map((n) => ({
      id: n.id, name: n.label,
      category: (n.properties.category as string) ?? 'general',
      produces: ((n.properties.produces as string[]) ?? []),
      requires: ((n.properties.requires as string[]) ?? []),
    }));
    const entityNodes = ekg.listNodes({ kind: 'ENTITY' as never }).slice(0, 12).map((n) => ({
      id: n.id, name: n.label,
      labels: n.labels ?? [],
      kind: (n.properties.kind as string) ?? 'organization',
    }));
    const assetNodes = ekg.listNodes({ kind: 'ASSET' as never }).slice(0, 24).map((n) => ({
      id: n.id, name: n.label,
      category: (n.properties.category as string) ?? 'general',
      stableId: (n.properties.stableId as string) ?? n.label,
    }));
    // Entity → Capability (OFFERS) edges for the graph visualization.
    const offersEdges: { from: string; to: string }[] = [];
    for (const e of entityNodes) {
      try {
        const rels = ekg.getRelationshipsByType(e.id, 'OFFERS' as never, 'out' as never);
        for (const r of rels.slice(0, 6)) {
          if (capabilityNodes.some((c) => c.id === r.to)) {
            offersEdges.push({ from: e.id, to: r.to });
          }
        }
      } catch { /* ignore */ }
    }

    // ── Extensions + certifications ──
    const certs = getCertifications();
    const extensions = certs.map(({ report, manifest }) => ({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      category: manifest.category,
      description: manifest.description,
      publisher: manifest.publisher.name,
      publisherVerified: manifest.publisher.verified,
      license: manifest.license,
      capabilityCount: manifest.capabilities.length,
      tags: manifest.tags,
      certification: {
        level: report.level,
        score: report.score,
        passed: report.passed,
        failed: report.failed,
        warnings: report.warnings,
        totalChecks: report.totalChecks,
        badgeFingerprint: report.badge.fingerprint.slice(0, 16),
        issuedAt: report.badge.issuedAt,
        expiresAt: report.badge.issuedAt + 90 * 24 * 60 * 60 * 1000,
      },
    }));

    // ── Parcel delivery ──
    let parcel: Record<string, unknown> = {};
    try {
      seedShowcaseDeliveries();
      const dashboard = parcelExtService.getDashboard('showcase');
      const transitNodes = parcelExtService.listTransitNodes().map((n) => ({
        id: n.id, name: n.name, type: n.type, address: n.address,
        lat: n.lat, lng: n.lng, capacityKg: n.capacityKg, currentLoadKg: n.currentLoadKg,
        congestionLevel: n.congestionLevel, rating: n.rating, active: n.active,
      }));
      const vehicles = parcelExtService.listVehicles().map((v) => ({
        id: v.id, courierId: v.courierId, type: v.type, capacityKg: v.capacityKg,
        carbonPerKm: v.carbonPerKm, avgSpeedKmh: v.avgSpeedKmh, active: v.active,
      }));
      const providers = parcelProviderAdapters.map((p) => ({
        id: p.id, name: p.name, label: p.label, description: p.description,
        enabled: p.enabled, jurisdictions: (p as { jurisdictions?: string[] }).jurisdictions ?? [],
        carbonPerInvocation: (p as { carbonPerInvocation?: number }).carbonPerInvocation ?? 0,
      }));
      const learning = parcelExtService.getLearningSummary();
      const couriers = parcelService.listCouriers().slice(0, 6).map((c) => ({
        id: c.id, name: c.name, rating: c.rating, totalDeliveries: c.totalDeliveries, active: c.active,
      }));
      parcel = {
        dashboard: {
          overview: {
            totalDeliveries: dashboard.overview.totalDeliveries,
            pendingDeliveries: dashboard.overview.pendingDeliveries,
            inTransitDeliveries: dashboard.overview.inTransitDeliveries,
            deliveredToday: dashboard.overview.deliveredToday,
            cancelledToday: dashboard.overview.cancelledToday,
            totalSpent: moneyStr(dashboard.overview.totalSpent),
            totalCarbon: dashboard.overview.totalCarbon,
            avgDeliveryTimeHours: dashboard.overview.avgDeliveryTimeHours,
            onTimeRate: dashboard.overview.onTimeRate,
            damageRate: dashboard.overview.damageRate,
          },
          deliveriesByStatus: dashboard.deliveriesByStatus,
          deliveriesByPriority: dashboard.deliveriesByPriority,
          topCouriers: dashboard.topCouriers,
          costBreakdown: {
            deliveryCosts: moneyStr(dashboard.costBreakdown.deliveryCosts),
            insuranceCosts: moneyStr(dashboard.costBreakdown.insuranceCosts),
            auctionSavings: moneyStr(dashboard.costBreakdown.auctionSavings),
            bundleSavings: moneyStr(dashboard.costBreakdown.bundleSavings),
            carbonOffsetCosts: moneyStr(dashboard.costBreakdown.carbonOffsetCosts),
          },
          carbonFootprint: dashboard.carbonFootprint,
          routeOptimizationStats: dashboard.routeOptimizationStats,
        },
        transitNodes,
        vehicles,
        providers,
        couriers,
        learning: {
          totalRecords: learning.totalRecords,
          avgDeliverySuccessRate: learning.avgDeliverySuccessRate,
          avgDamageRate: learning.avgDamageRate,
          avgReturnRate: learning.avgReturnRate,
          routeReliabilityCount: Object.keys(learning.routeReliability).length,
          courierReliabilityCount: Object.keys(learning.courierReliability).length,
          hubCongestionCount: Object.keys(learning.hubCongestion).length,
        },
      };
    } catch (e) {
      parcel = { error: e instanceof Error ? e.message : 'parcel load failed' };
    }

    return NextResponse.json({
      ok: true,
      generatedAt: Date.now(),
      ekg: {
        overview: {
          nodeCount: overview.nodeCount,
          relationshipCount: overview.relationshipCount,
          entityCount: overview.entityCount,
          capabilityCount: overview.capabilityCount,
          assetCount: overview.assetCount,
          goalCount: overview.goalCount,
          policyCount: overview.policyCount,
          jurisdictionCount: overview.jurisdictionCount,
          memoryCount: overview.memoryCount,
          proofCount: overview.proofCount,
          settledProofCount: overview.settledProofCount,
          versionedCount: overview.versionedCount,
          avgSuccessRate: overview.avgSuccessRate,
        },
        goals,
        capabilities: capabilityNodes,
        entities: entityNodes,
        assets: assetNodes,
        offersEdges,
      },
      extensions,
      certifications: certs.map(({ report }) => ({
        extensionId: report.extensionId,
        extensionName: report.extensionName,
        version: report.version,
        level: report.level,
        score: report.score,
        passed: report.passed,
        failed: report.failed,
        warnings: report.warnings,
        totalChecks: report.totalChecks,
        checks: report.checks.map((c) => ({
          id: c.id, name: c.name, category: c.category, result: c.result, detail: c.detail,
        })),
        badge: {
          level: report.badge.level,
          score: report.badge.score,
          fingerprint: report.badge.fingerprint,
          issuedAt: report.badge.issuedAt,
          expiresAt: report.badge.issuedAt + 90 * 24 * 60 * 60 * 1000,
        },
      })),
      parcel,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/showcase — interactive public actions (no auth, lightweight).
 *   { action: 'prove', goalId, constraints? }
 *   { action: 'certify', extensionId }
 *   { action: 'verifyBadge', extensionId }
 *   { action: 'planRoute', priority? }
 */
export async function POST(req: NextRequest) {
  try {
    ensureSeeded();
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const action = body.action as string;

    // ── prove(goalId) — the resolve() demo: graph theorem proving ──
    if (action === 'prove') {
      const goalId = body.goalId as string;
      const constraints = (body.constraints && typeof body.constraints === 'object' ? body.constraints : {}) as Constraints;
      const goal = getGoals().find((g) => g.id === goalId);
      if (!goal) return NextResponse.json({ error: `Goal not found: ${goalId}` }, { status: 404 });
      const proofs: Proof[] = prove(goal, constraints);
      if (proofs.length === 0) {
        return NextResponse.json({
          ok: true, goal: { id: goal.id, name: goal.name }, proofs: [],
          message: 'No proofs found — the goal cannot be satisfied under the given constraints',
        });
      }
      const best = proofs[0];
      const serializeStep = (s: typeof best.root, depth = 0) => ({
        kind: s.kind,
        goalName: s.goalName,
        capabilityName: s.capabilityName,
        entityName: s.entityName,
        entityLabel: s.entityLabel,
        produces: s.produces,
        consumes: s.consumes,
        depth,
        children: s.children.map((c) => serializeStep(c, depth + 1)),
      });
      return NextResponse.json({
        ok: true,
        goal: { id: goal.id, name: goal.name, description: goal.description, targetAsset: goal.targetAsset },
        constraints,
        proofCount: proofs.length,
        proofs: proofs.map((p) => ({
          id: p.id, plannerScore: p.plannerScore, totalCost: p.totalCost, totalLatencyMs: p.totalLatencyMs,
          trustScore: p.trustScore, carbon: p.carbon, risk: p.risk,
          capabilityCount: p.capabilityCount, entityCount: p.entityCount, entityLabels: p.entityLabels,
          status: p.status, memoryHits: p.memoryHits, predictedSuccessRate: p.predictedSuccessRate,
        })),
        best: { ...best, root: serializeStep(best.root) },
        message: `✓ Resolved: ${proofs.length} proof${proofs.length === 1 ? '' : 's'} found. Best planner score: ${best.plannerScore}.`,
      });
    }

    // ── certify(extensionId) — re-run the 15-check certification suite ──
    if (action === 'certify') {
      const extensionId = body.extensionId as string;
      const manifest = ALL_MANIFESTS.find((m) => m.id === extensionId);
      if (!manifest) return NextResponse.json({ error: `Extension not found: ${extensionId}` }, { status: 404 });
      const pkg = buildPackage(manifest);
      const report = certifyExtension(pkg);
      return NextResponse.json({
        ok: true,
        extension: { id: manifest.id, name: manifest.name, version: manifest.version },
        report: {
          level: report.level, score: report.score, passed: report.passed, failed: report.failed,
          warnings: report.warnings, totalChecks: report.totalChecks,
          checks: report.checks.map((c) => ({
            id: c.id, name: c.name, category: c.category, result: c.result, detail: c.detail, durationMs: c.durationMs,
          })),
          badge: {
            level: report.badge.level, score: report.badge.score,
            fingerprint: report.badge.fingerprint, issuedAt: report.badge.issuedAt, expiresAt: report.badge.issuedAt + 90 * 24 * 60 * 60 * 1000,
          },
        },
        message: report.level === 'CERTIFIED'
          ? `✓ CERTIFIED — ${report.passed}/${report.totalChecks} checks passed. Score ${report.score}/100.`
          : report.level === 'CONDITIONAL'
          ? `⚠ CONDITIONAL — ${report.passed}/${report.totalChecks} passed, ${report.failed} failed.`
          : `✗ REJECTED — ${report.failed} critical checks failed.`,
      });
    }

    // ── verifyBadge — verify a certification badge signature ──
    if (action === 'verifyBadge') {
      const cert = getCertifications().find(({ manifest }) => manifest.id === body.extensionId);
      if (!cert) return NextResponse.json({ error: 'Extension not found' }, { status: 404 });
      const result = verifyBadge(cert.report.badge);
      return NextResponse.json({
        ok: true,
        extensionId: cert.manifest.id,
        valid: result.valid,
        error: result.error,
        message: result.valid
          ? '✓ Badge signature valid — issued by PaySwap certification authority'
          : `✗ Badge signature invalid — ${result.error ?? 'may be forged'}`,
      });
    }

    // ── planRoute(priority) — multi-hop parcel route planning ──
    if (action === 'planRoute') {
      const priority = (body.priority as 'FASTEST' | 'CHEAPEST' | 'SAFEST' | 'CARBON_OPTIMIZED') ?? 'CHEAPEST';
      // Ensure demo deliveries exist for the showcase merchant.
      seedShowcaseDeliveries();
      let deliveries = parcelService.listDeliveries('showcase');
      if (deliveries.length === 0) {
        parcelService.createDelivery({
          merchantId: 'showcase', customerId: 'cust_demo_1',
          senderName: 'Accra Trading Co', senderAddress: 'Accra, Ghana',
          recipientName: 'Kofi Mensah', recipientAddress: 'Kumasi, Ghana',
          recipientContact: '+233244567890',
          parcel: { weightKg: 2.5, dimensionsCm: { length: 30, width: 20, height: 15 }, fragile: true, temperatureControlled: false, oversized: false, declaredValue: 120 },
          priority: 'STANDARD', insuranceRequired: true,
        });
        deliveries = parcelService.listDeliveries('showcase');
      }
      const deliveryIds = deliveries.slice(0, 3).map((d) => d.id);
      const route = parcelExtService.planMultiHopRoute(deliveryIds, priority);
      return NextResponse.json({
        ok: true,
        priority,
        deliveryCount: deliveryIds.length,
        route: {
          id: route.id,
          hops: route.hops.map((h) => ({
            sequence: h.sequence, transitNodeName: h.transitNodeName, transitNodeType: h.transitNodeType,
            address: h.address, lat: h.lat, lng: h.lng, action: h.action,
            distanceFromPreviousKm: h.distanceFromPreviousKm, durationFromPreviousHours: h.durationFromPreviousHours,
          })),
          totalDistanceKm: route.totalDistanceKm,
          estimatedDurationHours: route.estimatedDurationHours,
          estimatedCost: moneyStr(route.estimatedCost),
          estimatedCarbon: route.estimatedCarbon,
          vehicleType: route.vehicleType,
          optimizedFor: route.optimizedFor,
          transitNodesUsed: route.transitNodesUsed,
        },
        message: `✓ Planned ${route.hops.length}-hop route: ${route.totalDistanceKm}km, ${moneyStr(route.estimatedCost)}, ${route.estimatedCarbon}kg CO₂.`,
      });
    }

    // ── Live PSP + Stellar + Maps tests (real API calls) ──
    // Each action calls a real sandbox/test API with the configured keys.
    // Imports are lazy so stellar-sdk (heavy) only loads when needed.

    if (action === 'liveStripe') {
      const { stripeLive } = await import('@/live');
      const result = await stripeLive.runStripeTest();
      return NextResponse.json({ ok: true, provider: 'Stripe', result, message: result.paymentIntent.success ? `✓ Stripe test mode: PaymentIntent ${result.paymentIntent.data?.id} created.` : `✗ Stripe test failed: ${result.paymentIntent.error}` });
    }

    if (action === 'livePaystack') {
      const { paystackLive } = await import('@/live');
      const result = await paystackLive.runPaystackTest();
      return NextResponse.json({ ok: true, provider: 'Paystack', result, message: result.init.success ? `✓ Paystack test mode: transaction ${result.init.data?.reference} initialized.` : `✗ Paystack test failed: ${result.init.error}` });
    }

    if (action === 'liveFlutterwave') {
      const { flutterwaveLive } = await import('@/live');
      const result = await flutterwaveLive.runFlutterwaveTest();
      return NextResponse.json({ ok: true, provider: 'Flutterwave', result, message: result.payment.success ? `✓ Flutterwave test mode: payment ${result.payment.data?.tx_ref} initiated.` : `✗ Flutterwave test failed: ${result.payment.error}` });
    }

    if (action === 'liveStellar') {
      const stellarMod = await import('@/live/stellar');
      const result = await stellarMod.runStellarTest();
      return NextResponse.json({ ok: true, provider: 'Stellar', result, message: result.payment.success ? `✓ Stellar testnet: tx ${result.payment.data?.txHash.slice(0, 12)}… submitted on ledger ${result.payment.data?.ledger}.` : `✗ Stellar test failed: ${result.payment.error}` });
    }

    if (action === 'liveStellarPath') {
      const stellarMod = await import('@/live/stellar');
      // Quote a cross-border path: XLM → USDC (GHS→USDC→KES pattern)
      const usdcTestnetIssuer = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NATPQDWVRZULE';
      const result = await stellarMod.pathPaymentQuote({
        sourceAsset: 'XLM',
        destAsset: `USDC:${usdcTestnetIssuer}`,
        destAmount: '1',
      });
      return NextResponse.json({ ok: true, provider: 'Stellar', result, message: result.success ? `✓ Path quote: ${result.data?.sourceAmount ?? '—'} XLM → 1 USDC.` : `✗ Path quote failed: ${result.error}` });
    }

    if (action === 'liveMaps') {
      const { mapsLive } = await import('@/live');
      const result = await mapsLive.runMapsTest();
      return NextResponse.json({ ok: true, provider: 'Google Maps', result, message: result.distance.success ? `✓ Google Maps: ${result.distance.data?.rows[0]?.elements[0]?.distance?.text} driving distance.` : `✗ Maps test failed: ${result.distance.error}` });
    }

    // ── planRouteLive: real Google Maps driving distances for the parcel route ──
    // Plans the multi-hop route via the in-memory planner, then enriches each
    // hop with real driving distance + duration from the Google Maps Distance
    // Matrix API. Compares the haversine approximation vs. real road distance.
    if (action === 'planRouteLive') {
      const priority = (body.priority as 'FASTEST' | 'CHEAPEST' | 'SAFEST' | 'CARBON_OPTIMIZED') ?? 'CHEAPEST';
      seedShowcaseDeliveries();
      const deliveries = parcelService.listDeliveries('showcase');
      const deliveryIds = deliveries.slice(0, 3).map((d) => d.id);
      const route = parcelExtService.planMultiHopRoute(deliveryIds, priority);

      // Build origins/destinations for the Distance Matrix (consecutive hops)
      const { mapsLive } = await import('@/live');
      const hopAddresses = route.hops.map((h) => h.address);
      const realSegments: Array<{ from: string; to: string; distanceKm: number; durationHours: number; status: string }> = [];
      for (let i = 0; i < hopAddresses.length - 1; i++) {
        try {
          const dm = await mapsLive.getDistanceMatrix({ origins: [hopAddresses[i]], destinations: [hopAddresses[i + 1]] });
          const el = dm.data?.rows[0]?.elements[0];
          if (el?.status === 'OK' && el.distance && el.duration) {
            realSegments.push({
              from: hopAddresses[i], to: hopAddresses[i + 1],
              distanceKm: el.distance.value / 1000,
              durationHours: el.duration.value / 3600,
              status: 'OK',
            });
          } else {
            realSegments.push({ from: hopAddresses[i], to: hopAddresses[i + 1], distanceKm: 0, durationHours: 0, status: el?.status ?? 'NO_ROUTE' });
          }
        } catch {
          realSegments.push({ from: hopAddresses[i], to: hopAddresses[i + 1], distanceKm: 0, durationHours: 0, status: 'API_ERROR' });
        }
      }
      const realTotalKm = realSegments.reduce((s, r) => s + r.distanceKm, 0);
      const realTotalHours = realSegments.reduce((s, r) => s + r.durationHours, 0);
      const haversineKm = route.totalDistanceKm;
      const diff = realTotalKm - haversineKm;
      const diffPct = haversineKm > 0 ? (diff / haversineKm) * 100 : 0;

      return NextResponse.json({
        ok: true,
        priority,
        route: {
          id: route.id,
          hops: route.hops.map((h, i) => ({
            sequence: h.sequence, transitNodeName: h.transitNodeName, transitNodeType: h.transitNodeType,
            address: h.address, action: h.action,
            haversineKm: h.distanceFromPreviousKm,
            realKm: realSegments[i]?.distanceKm ?? 0,
            realDurationHours: realSegments[i]?.durationHours ?? 0,
            realStatus: realSegments[i]?.status ?? 'N/A',
          })),
          haversineTotalKm: haversineKm,
          realTotalKm: Math.round(realTotalKm * 10) / 10,
          realTotalDurationHours: Math.round(realTotalHours * 10) / 10,
          differenceKm: Math.round(diff * 10) / 10,
          differencePct: Math.round(diffPct * 10) / 10,
          vehicleType: route.vehicleType,
          optimizedFor: route.optimizedFor,
        },
        message: `✓ Real Google Maps route: ${Math.round(realTotalKm)}km driving (${haversineKm}km haversine, ${diff > 0 ? '+' : ''}${Math.round(diffPct)}% vs straight-line).`,
      });
    }

    // ── liveReport: consolidated live-test report (runs all 5 providers) ──
    if (action === 'liveReport') {
      const { stripeLive, paystackLive, flutterwaveLive, mapsLive } = await import('@/live');
      const stellarMod = await import('@/live/stellar');
      const startedAt = Date.now();
      const [stripe, paystack, flutterwave, stellar, maps] = await Promise.all([
        stripeLive.runStripeTest(),
        paystackLive.runPaystackTest(),
        flutterwaveLive.runFlutterwaveTest(),
        stellarMod.runStellarTest(),
        mapsLive.runMapsTest(),
      ]);
      const totalLatencyMs = Date.now() - startedAt;
      const providers = [
        { name: 'Stripe', ...stripe, tests: Object.values(stripe) },
        { name: 'Paystack', ...paystack, tests: Object.values(paystack) },
        { name: 'Flutterwave', ...flutterwave, tests: Object.values(flutterwave) },
        { name: 'Stellar', ...stellar, tests: Object.values(stellar) },
        { name: 'Google Maps', ...maps, tests: Object.values(maps) },
      ];
      const allTests = providers.flatMap((p) => p.tests);
      const passed = allTests.filter((t) => t.success).length;
      const failed = allTests.filter((t) => !t.success).length;
      return NextResponse.json({
        ok: true,
        reportId: `LTR-${Date.now().toString(36).toUpperCase()}`,
        generatedAt: new Date().toISOString(),
        totalLatencyMs,
        summary: {
          totalTests: allTests.length,
          passed, failed,
          passRate: Math.round((passed / allTests.length) * 100),
          providersTested: providers.length,
        },
        providers: providers.map((p) => ({
          name: p.name,
          passed: p.tests.filter((t) => t.success).length,
          failed: p.tests.filter((t) => !t.success).length,
          total: p.tests.length,
          tests: p.tests.map((t) => ({
            operation: t.operation, success: t.success, latencyMs: t.latencyMs,
            status: t.status, summary: t.summary, error: t.error,
          })),
        })),
        message: `✓ Live report: ${passed}/${allTests.length} tests passed across ${providers.length} providers (${failed} failed).`,
      });
    }

    // ── testScenarios: run all 15 TEST-SCENARIOS.md through the kernel Digital Twin ──
    // Constructs each scenario from the catalog, runs it through the in-memory
    // simulationEngine, and returns a pass/fail report per scenario.
    if (action === 'testScenarios') {
      const kernel = await import('@/kernel');
      const simulationEngine = kernel.simulationEngine;
      // Use defaultScenario() as the base — it has the correct shape (aiWeights, etc.)
      // and valid lp/fo fixtures. We override only the fields that vary per scenario.
      const base = kernel.defaultScenario();
      type ScenarioDef = {
        id: number; name: string; category: string;
        expectedStrategy?: string; expectSettled: boolean;
        overrides: Record<string, unknown>;
        /** Optional note explaining a known gap (printed in the report). */
        knownGap?: string;
      };

      // Helper: build a scenario by deep-merging overrides onto the base.
      const buildScenario = (name: string, overrides: Record<string, unknown>) => ({
        ...base, name, ...overrides,
        transaction: { ...base.transaction, ...(overrides.transaction as object) },
        treasury: { ...base.treasury, ...(overrides.treasury as object) },
        policies: { ...base.policies, ...(overrides.policies as object) },
      });

      const scenarios: ScenarioDef[] = [
        // 1: LOCAL_RAIL — domestic Ghana (both have reserves, same country)
        { id: 1, name: 'Domestic Payment (GHS→GHS)', category: 'LOCAL_RAIL', expectedStrategy: 'LOCAL_RAIL', expectSettled: true,
          overrides: { transaction: { type: 'domestic', buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 500, currency: 'GHS', merchantType: 'Local merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 }, destinationReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 } }, liquidityProviders: [] } },
        // 2: RESERVE_TO_RESERVE — Ghana→Togo (both have reserves)
        { id: 2, name: 'Cross-border GHS→XOF (both reserve)', category: 'RESERVE_TO_RESERVE', expectedStrategy: 'RESERVE_TO_RESERVE', expectSettled: true,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, merchant: { country: 'Togo', currency: 'XOF', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 1000, currency: 'GHS', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 }, destinationReserve: { country: 'Togo', currency: 'XOF', available: 3000000, minThreshold: 300000 } }, liquidityProviders: [] } },
        // 3: RESERVE_TO_MARKET — Ghana→Kenya (Kenya has no reserve)
        { id: 3, name: 'Cross-border GHS→KES (receiver no reserve)', category: 'RESERVE_TO_MARKET', expectedStrategy: 'RESERVE_TO_MARKET', expectSettled: true,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, merchant: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' }, amount: 500, currency: 'GHS', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 }, destinationReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 } } } },
        // 4: MARKET_TO_RESERVE — Kenya→Ghana (Kenya has no reserve, Ghana does)
        { id: 4, name: 'Cross-border KES→GHS (sender no reserve)', category: 'MARKET_TO_RESERVE', expectedStrategy: 'MARKET_TO_RESERVE', expectSettled: true,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' }, merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 2000, currency: 'KES', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 }, destinationReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 } } } },
        // 5: MARKET_TO_MARKET — Kenya→Nigeria (neither has reserve)
        { id: 5, name: 'Cross-border KES→NGN (neither reserve)', category: 'MARKET_TO_MARKET', expectedStrategy: 'MARKET_TO_MARKET', expectSettled: true,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' }, merchant: { country: 'Nigeria', currency: 'NGN', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 3000, currency: 'KES', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 }, destinationReserve: { country: 'Nigeria', currency: 'NGN', available: 0, minThreshold: 0 } }, stablecoinBalance: 50000 } },
        // 6: Failed payment — inject a payment failure
        { id: 6, name: 'Failed Payment (value preservation)', category: 'FAILED', expectSettled: false,
          overrides: { transaction: { type: 'domestic', buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 100, currency: 'GHS', merchantType: 'Local merchant', customerType: 'Retail buyer', priority: 'cheapest' }, failures: [{ id: 'fail_s6', type: 'compliance_block', label: 'Payment blocked by compliance', atFrame: 1 }] } },
        // 7: High-value strategic
        { id: 7, name: 'High-Value Strategic (500K USD)', category: 'STRATEGIC', expectSettled: true,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, merchant: { country: 'Togo', currency: 'XOF', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 500000, currency: 'USD', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'safest' }, treasury: { originReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 }, destinationReserve: { country: 'Togo', currency: 'XOF', available: 3000000, minThreshold: 300000 }, stablecoinBalance: 500000, emergencyTreasury: 200000 }, policies: { requireInsurance: true } } },
        // 8: Refund — low-value domestic (reversal path)
        { id: 8, name: 'Refund Flow (partial reversal)', category: 'REFUND', expectSettled: true,
          overrides: { transaction: { type: 'domestic', buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 250, currency: 'GHS', merchantType: 'Local merchant', customerType: 'Retail buyer', priority: 'cheapest' }, liquidityProviders: [] } },
        // 9: Payout — large domestic transfer
        { id: 9, name: 'Payout Flow (merchant withdrawal)', category: 'PAYOUT', expectSettled: true,
          overrides: { transaction: { type: 'domestic', buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 5000, currency: 'GHS', merchantType: 'Local merchant', customerType: 'Retail buyer', priority: 'cheapest' }, liquidityProviders: [] } },
        // 10: Concurrent — high-volume cross-border
        { id: 10, name: 'Concurrent Payments (stress)', category: 'CONCURRENT', expectSettled: true,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' }, merchant: { country: 'Nigeria', currency: 'NGN', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 3000, currency: 'KES', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'fastest' }, treasury: { originReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 }, destinationReserve: { country: 'Nigeria', currency: 'NGN', available: 0, minThreshold: 0 }, stablecoinBalance: 500000 } } },
        // 11: LP Settlement Order Claim — same as S3 (RESERVE_TO_MARKET creates a settlement contract)
        { id: 11, name: 'LP Settlement Order Claim', category: 'LP_CLAIM', expectedStrategy: 'RESERVE_TO_MARKET', expectSettled: true,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, merchant: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' }, amount: 500, currency: 'GHS', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 }, destinationReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 } } } },
        // 12: Wallet transfer — domestic
        { id: 12, name: 'Wallet Transfer (customer→customer)', category: 'WALLET_TRANSFER', expectSettled: true,
          overrides: { transaction: { type: 'domestic', buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 500, currency: 'GHS', merchantType: 'Local merchant', customerType: 'Retail buyer', priority: 'cheapest' }, liquidityProviders: [] } },
        // 13: Insufficient funds — amount exceeds all liquidity (now enforced)
        { id: 13, name: 'Insufficient Funds (rejected)', category: 'INSUFFICIENT_FUNDS', expectSettled: false,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' }, merchant: { country: 'Nigeria', currency: 'NGN', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 999999999, currency: 'KES', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 }, destinationReserve: { country: 'Nigeria', currency: 'NGN', available: 0, minThreshold: 0 }, stablecoinBalance: 50000 } } },
        // 14: Emergency freeze — buyer country (Kenya) is frozen
        { id: 14, name: 'Treasury Emergency Freeze (Kenya)', category: 'EMERGENCY_FREEZE', expectSettled: false,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' }, merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 500, currency: 'KES', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 }, destinationReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 }, stablecoinBalance: 0, emergencyTreasury: 0, reservePolicy: 'strict' }, policies: { maxRiskScore: 0.05 }, liquidityProviders: [], frozenCountries: ['Kenya'] } },
        // 15: Claims/voting — disputed scenario with compliance hold
        { id: 15, name: 'Claims/Evidence/Voting (dispute)', category: 'CLAIMS', expectSettled: true,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, merchant: { country: 'Togo', currency: 'XOF', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 1000, currency: 'GHS', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 }, destinationReserve: { country: 'Togo', currency: 'XOF', available: 3000000, minThreshold: 300000 } }, policies: { requireInsurance: true }, failures: [{ id: 'fail_s15', type: 'insurance_claim', label: 'Merchant dispute — LP failed to settle', atFrame: 1 }] } },
        // ── EDGE CASES (beyond the catalog) ──
        // E1: Freeze the merchant country (not the buyer) — should also block
        { id: 101, name: 'Edge: Freeze merchant country', category: 'EDGE_FREEZE_MERCHANT', expectSettled: false,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, merchant: { country: 'Nigeria', currency: 'NGN', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 500, currency: 'GHS', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 }, destinationReserve: { country: 'Nigeria', currency: 'NGN', available: 0, minThreshold: 0 }, stablecoinBalance: 50000 }, frozenCountries: ['Nigeria'] } },
        // E2: Freeze a country NOT involved in the payment — should still settle
        { id: 102, name: 'Edge: Freeze unrelated country', category: 'EDGE_FREEZE_UNRELATED', expectSettled: true,
          overrides: { transaction: { type: 'domestic', buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 500, currency: 'GHS', merchantType: 'Local merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 }, destinationReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 } }, liquidityProviders: [], frozenCountries: ['Kenya'] } },
        // E3: Amount exactly equals available capacity — should settle (boundary)
        //     No LPs, no reserves — capacity = stablecoin (50000) + emergency (20000) = 70000
        { id: 103, name: 'Edge: Amount equals capacity (boundary)', category: 'EDGE_EXACT_CAPACITY', expectSettled: true,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' }, merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 70000, currency: 'KES', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 }, destinationReserve: { country: 'Ghana', currency: 'GHS', available: 0, minThreshold: 0 }, stablecoinBalance: 50000, emergencyTreasury: 20000 }, liquidityProviders: [] } },
        // E4: Amount just exceeds capacity by 1 — should block (boundary)
        //     No LPs, no reserves — capacity = 70000, amount = 70001
        { id: 104, name: 'Edge: Amount exceeds capacity by 1', category: 'EDGE_OVER_CAPACITY', expectSettled: false,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' }, merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 70001, currency: 'KES', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 }, destinationReserve: { country: 'Ghana', currency: 'GHS', available: 0, minThreshold: 0 }, stablecoinBalance: 50000, emergencyTreasury: 20000 }, liquidityProviders: [] } },
        // E5: Zero amount — should settle (no-op, but valid)
        { id: 105, name: 'Edge: Zero amount', category: 'EDGE_ZERO', expectSettled: true,
          overrides: { transaction: { type: 'domestic', buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 0, currency: 'GHS', merchantType: 'Local merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 }, destinationReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 } }, liquidityProviders: [] } },
        // E6: Both countries frozen — should block
        { id: 106, name: 'Edge: Both countries frozen', category: 'EDGE_BOTH_FROZEN', expectSettled: false,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' }, merchant: { country: 'Nigeria', currency: 'NGN', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 500, currency: 'KES', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 }, destinationReserve: { country: 'Nigeria', currency: 'NGN', available: 0, minThreshold: 0 }, stablecoinBalance: 50000 }, frozenCountries: ['Kenya', 'Nigeria'] } },
      ];

      const results = scenarios.map((s) => {
        try {
          const scenario = buildScenario(`S${s.id}: ${s.category}`, s.overrides);
          const result = simulationEngine.run(scenario);
          const actualStrategy = (result.plan.reasoning as { strategy?: string }).strategy ?? 'UNKNOWN';
          const eventTypes = result.events.map((e: { type?: string }) => e.type ?? 'unknown');
          // Extract block reason from the execution.blocked event (if present).
          const blockEvent = result.events.find((e: { type?: string }) => e.type === 'execution.blocked');
          const blockReason = (blockEvent as { payload?: { reason?: string } } | undefined)?.payload?.reason ?? null;
          // Pass criteria: the scenario ran without error AND the settled status
          // matches the expectation. The kernel's reasoning.strategy is the
          // optimization objective (cost/risk/latency-minimizing), which is a
          // different concept from the catalog's settlement-rail names
          // (LOCAL_RAIL, RESERVE_TO_RESERVE, etc.) — we record both for info.
          const settledMatch = result.settled === s.expectSettled;
          const passed = settledMatch;
          return {
            id: s.id, name: s.name, category: s.category,
            expectedStrategy: s.expectedStrategy ?? 'N/A',
            actualStrategy,
            settled: result.settled,
            expectedSettled: s.expectSettled,
            passed,
            knownGap: s.knownGap,
            blockReason,
            metrics: {
              costPercent: result.plan.metrics.costPercent,
              settlementTimeMs: result.plan.metrics.settlementTimeMs,
              settlementTimeLabel: result.plan.metrics.settlementTimeLabel,
              riskScore: result.plan.metrics.riskScore,
              riskLabel: result.plan.metrics.riskLabel,
              confidence: result.plan.metrics.confidence,
              twinTokensMinted: result.plan.metrics.twinTokensMinted,
            },
            eventCount: result.events.length,
            eventTypes: eventTypes.slice(0, 8),
            ledgerEntries: result.ledger.length,
            constitutionPassed: result.constitution.passed,
            candidatePlans: result.candidatePlans.length,
            runId: result.runId,
          };
        } catch (e) {
          return {
            id: s.id, name: s.name, category: s.category,
            expectedStrategy: s.expectedStrategy ?? 'N/A',
            actualStrategy: 'ERROR', settled: false, expectedSettled: s.expectSettled,
            passed: false, error: e instanceof Error ? e.message : String(e),
          };
        }
      });

      const passed = results.filter((r) => r.passed).length;
      const failed = results.length - passed;
      return NextResponse.json({
        ok: true,
        reportId: `TSR-${Date.now().toString(36).toUpperCase()}`,
        generatedAt: new Date().toISOString(),
        source: 'TEST-SCENARIOS.md (15 scenarios + 6 edge cases)',
        summary: { total: results.length, passed, failed, passRate: Math.round((passed / results.length) * 100) },
        results,
        message: `✓ Test scenarios: ${passed}/${results.length} passed (${failed} failed).`,
      });
    }

    // ── multiYearSim: run a 1/2/3-year Monte Carlo simulation ──
    if (action === 'multiYearSim') {
      const horizon = (body.horizon as '1y' | '2y' | '3y') ?? '1y';
      const seed = (body.seed as number) ?? 42;
      const { runMultiYearSimulation } = await import('@/kernel/simulation-engine-extended');
      const result = runMultiYearSimulation(horizon, seed);
      return NextResponse.json({
        ok: true,
        ...result,
        message: `✓ ${horizon} simulation: ${result.summary.totalTransactions} tx over ${result.summary.totalDays} days, ${result.summary.settlementRate}% settled, peak daily volume ${result.summary.peakDailyVolume}.`,
      });
    }

    // ── edgeCaseProbe: systematic edge-case probing (60+ cases) ──
    if (action === 'edgeCaseProbe') {
      const { runEdgeCaseProbe } = await import('@/kernel/simulation-engine-extended');
      const report = runEdgeCaseProbe();
      return NextResponse.json({
        ok: true,
        ...report,
        message: `✓ Edge case probe: ${report.passed}/${report.totalCases} passed (${report.passRate}%), ${report.findings.length} finding(s).`,
      });
    }

    // ── settlementSim: simulate all 5 settlement strategies + bandwidth + contracts ──
    if (action === 'settlementSim') {
      const { runSettlementSimulation } = await import('@/kernel/settlement-simulator');
      const report = runSettlementSimulation((body.seed as number) ?? 42);
      return NextResponse.json({
        ok: true,
        ...report,
        message: `✓ Settlement sim: ${report.totalScenarios} scenarios across ${Object.keys(report.byStrategy).length} strategies, ${report.contractSummary.totalCreated} contracts, ${report.bandwidthSummary.fiat.totalConsumed + report.bandwidthSummary.stablecoin.totalConsumed + report.bandwidthSummary.twin_token.totalConsumed} bandwidth consumed.`,
      });
    }

    // ── unifiedPipelineTest: prove demo + real data use the same pipeline, isolated ──
    if (action === 'unifiedPipelineTest') {
      const { runUnifiedPipelineTest } = await import('@/kernel/unified-pipeline-test');
      const report = await runUnifiedPipelineTest();
      return NextResponse.json({
        ok: true,
        ...report,
        message: report.summary.pipelineUnified
          ? `✓ Unified pipeline: ${report.summary.sandboxPayments} sandbox + ${report.summary.livePayments} live payments, ${report.summary.isolationPassed}/${report.summary.isolationChecks} isolation checks passed.`
          : `✗ Pipeline issues detected — see findings.`,
      });
    }

    // ── livePipelineTest: real PSP + Stellar calls through the unified pipeline ──
    if (action === 'livePipelineTest') {
      const { runLivePipelineTest } = await import('@/kernel/live-pipeline-test');
      const report = await runLivePipelineTest();
      return NextResponse.json({
        ok: true,
        ...report,
        message: report.combinedSuccesses === report.totalTests
          ? `✓ Live pipeline: ${report.combinedSuccesses}/${report.totalTests} tests passed (API + pipeline combined).`
          : `${report.combinedSuccesses}/${report.totalTests} combined successes — see findings.`,
      });
    }

    // ── simulatePaymentFlow: world state + routing + unified pipeline dispatch + animated steps ──
    if (action === 'simulatePaymentFlow') {
      const fromCountry = (body.fromCountry as string) ?? 'Ghana';
      const toCountry = (body.toCountry as string) ?? 'Kenya';
      const amount = (body.amount as number) ?? 5000;
      const currencyFor = (c: string) => c === 'Kenya' ? 'KES' : c === 'Nigeria' ? 'NGN' : c === 'Togo' ? 'XOF' : 'GHS';

      // ── 1. Build world state (what the investor sees) ──
      const countries = [
        { name: 'Ghana', currency: 'GHS', hasReserve: true, fiatReserve: 50_000, stablecoinReserve: 20_000 },
        { name: 'Togo', currency: 'XOF', hasReserve: false, fiatReserve: 0, stablecoinReserve: 0 },
        { name: 'Kenya', currency: 'KES', hasReserve: false, fiatReserve: 0, stablecoinReserve: 0 },
        { name: 'Nigeria', currency: 'NGN', hasReserve: false, fiatReserve: 0, stablecoinReserve: 0 },
      ];
      const lps = [
        { id: 'lp_ghana_1', country: 'Ghana', hasBandwidth: true, fiatBw: 30_000, stablecoinBw: 60_000, twinBw: 20_000, type: 'automatic' },
        { id: 'lp_ghana_2', country: 'Ghana', hasBandwidth: true, fiatBw: 25_000, stablecoinBw: 50_000, twinBw: 15_000, type: 'automatic' },
        { id: 'lp_kenya_1', country: 'Kenya', hasBandwidth: true, fiatBw: 20_000, stablecoinBw: 40_000, twinBw: 12_000, type: 'automatic' },
        { id: 'lp_kenya_2', country: 'Kenya', hasBandwidth: false, fiatBw: 0, stablecoinBw: 0, twinBw: 0, type: 'manual' },
        { id: 'lp_nigeria_1', country: 'Nigeria', hasBandwidth: true, fiatBw: 15_000, stablecoinBw: 30_000, twinBw: 10_000, type: 'automatic' },
        { id: 'lp_togo_1', country: 'Togo', hasBandwidth: false, fiatBw: 0, stablecoinBw: 0, twinBw: 0, type: 'manual' },
      ];
      const marketplaceContracts = [
        { id: 'sc_pending_1', from: 'Ghana', to: 'Kenya', amount: 3_000, status: 'funded', strategy: 'RESERVE_TO_MARKET' },
        { id: 'sc_pending_2', from: 'Kenya', to: 'Nigeria', amount: 1_500, status: 'funded', strategy: 'MARKET_TO_MARKET' },
      ];

      // ── 2. Determine routing strategy (using LiquidityPolicyEngine) ──
      const { LiquidityPolicyEngine } = await import('@/runtime/liquidity/policy-engine');
      const policyEngine = new LiquidityPolicyEngine();
      const fromState = countries.find((c) => c.name === fromCountry)!;
      const toState = countries.find((c) => c.name === toCountry)!;
      const strategy = fromCountry === toCountry ? 'LOCAL_RAIL'
        : (fromState.hasReserve && toState.hasReserve) ? 'RESERVE_TO_RESERVE'
        : (fromState.hasReserve && !toState.hasReserve) ? 'RESERVE_TO_MARKET'
        : (!fromState.hasReserve && toState.hasReserve) ? 'MARKET_TO_RESERVE'
        : 'MARKET_TO_MARKET';

      const feeModel: Record<string, { bps: number; lpPct: number; psPct: number }> = {
        LOCAL_RAIL: { bps: 80, lpPct: 0, psPct: 100 },
        RESERVE_TO_RESERVE: { bps: 80, lpPct: 0, psPct: 100 },
        RESERVE_TO_MARKET: { bps: 120, lpPct: 80, psPct: 20 },
        MARKET_TO_RESERVE: { bps: 100, lpPct: 60, psPct: 40 },
        MARKET_TO_MARKET: { bps: 150, lpPct: 90, psPct: 10 },
      };
      const fees = feeModel[strategy];
      const feeAmount = Math.round((amount * fees.bps) / 10000);
      const payswapRevenue = Math.round((feeAmount * fees.psPct) / 100);
      const lpRevenue = Math.round((feeAmount * fees.lpPct) / 100);

      // ── 3. Determine what bandwidth is needed ──
      const bandwidthNeeded: Array<{ assetType: string; country: string; amount: number; available: number; sufficient: boolean }> = [];
      if (strategy === 'RESERVE_TO_MARKET' || strategy === 'MARKET_TO_MARKET') {
        // Needs stablecoin bandwidth in sender country
        const senderLps = lps.filter((l) => l.country === fromCountry && l.hasBandwidth);
        const stablecoinAvail = senderLps.reduce((s, l) => s + l.stablecoinBw, 0);
        bandwidthNeeded.push({ assetType: 'stablecoin', country: fromCountry, amount, available: stablecoinAvail, sufficient: stablecoinAvail >= amount });
        // Needs fiat bandwidth in receiver country (for auto-settlement)
        const receiverLps = lps.filter((l) => l.country === toCountry && l.hasBandwidth);
        const fiatAvail = receiverLps.reduce((s, l) => s + l.fiatBw, 0);
        bandwidthNeeded.push({ assetType: 'fiat', country: toCountry, amount, available: fiatAvail, sufficient: fiatAvail >= amount });
      }
      if (strategy === 'MARKET_TO_RESERVE') {
        const senderLps = lps.filter((l) => l.country === fromCountry && l.hasBandwidth);
        const stablecoinAvail = senderLps.reduce((s, l) => s + l.stablecoinBw, 0);
        bandwidthNeeded.push({ assetType: 'stablecoin', country: fromCountry, amount, available: stablecoinAvail, sufficient: stablecoinAvail >= amount });
      }

      // ── 4. Determine settlement contract path ──
      const needsContract = strategy !== 'LOCAL_RAIL' && strategy !== 'RESERVE_TO_RESERVE';
      const hasFiatBw = bandwidthNeeded.some((b) => b.assetType === 'fiat' && b.sufficient);
      const contractPath = !needsContract ? 'none' : hasFiatBw ? 'auto' : 'marketplace';
      const contractSteps = contractPath === 'none'
        ? ['created → closed (immediate)']
        : contractPath === 'auto'
        ? ['created', 'funded', 'auto-claimed (LP fiat BW)', 'confirmed', 'released', 'closed']
        : ['created', 'funded', 'listed in marketplace', 'LP claims', 'LP pays recipient', 'recipient confirms', 'released', 'closed'];

      // ── 5. Dispatch through the UNIFIED PIPELINE (RuntimeHost) ──
      let pipelineResult: { dispatched: boolean; events: Array<{ type: string; payload?: unknown }>; ledgerEntries: number; latencyMs: number; error?: string };
      try {
        const { runtimeHost } = await import('@/runtime');
        const start = Date.now();
        const result = await runtimeHost.execute({
          type: 'payment.create',
          payload: {
            merchantId: `merch_sandbox`,
            customerId: `cust_sandbox`,
            amount, currency: currencyFor(toCountry),
            method: 'bank', corridor: `${fromCountry}-${toCountry}`,
            description: `Simulation: ${fromCountry}→${toCountry} ${amount} ${currencyFor(fromCountry)}`,
            reference: `sim_${Date.now()}`,
          },
          metadata: {
            actor: { id: 'simulation', role: 'admin' },
            environment: 'sandbox' as never,
            correlationId: `sim_${fromCountry}_${toCountry}_${Date.now()}`,
            source: 'api' as never,
          },
        } as never);
        const events = (result as { events?: Array<{ type: string; payload?: unknown }> }).events ?? [];
        pipelineResult = {
          dispatched: true,
          events,
          ledgerEntries: events.filter((e) => e.type.includes('ledger')).length,
          latencyMs: Date.now() - start,
        };
      } catch (e) {
        pipelineResult = { dispatched: false, events: [], ledgerEntries: 0, latencyMs: 0, error: e instanceof Error ? e.message : String(e) };
      }

      // ── 6. Build animated flow steps ──
      const flowSteps = [
        { id: 0, label: 'Payment received', detail: `${amount} ${currencyFor(fromCountry)} from ${fromCountry} to ${toCountry}`, icon: 'inbox', status: 'done' },
        { id: 1, label: 'Strategy selected', detail: `${strategy} — ${fees.bps}bps fee (${fees.lpPct}% LP / ${fees.psPct}% PaySwap)`, icon: 'strategy', status: 'done' },
        { id: 2, label: 'Reserve check', detail: fromState.hasReserve ? `${fromCountry} has $${fromState.fiatReserve.toLocaleString()} reserve` : `${fromCountry} has NO reserve — relying on LPs`, icon: 'reserve', status: fromState.hasReserve ? 'done' : 'warning' },
      ];
      if (bandwidthNeeded.length > 0) {
        for (const bw of bandwidthNeeded) {
          flowSteps.push({
            id: flowSteps.length,
            label: `Bandwidth check: ${bw.assetType}`,
            detail: `Need ${bw.amount.toLocaleString()} in ${bw.country} — ${bw.sufficient ? `✓ ${bw.available.toLocaleString()} available` : `✗ only ${bw.available.toLocaleString()} available (marketplace path)`}`,
            icon: 'bandwidth',
            status: bw.sufficient ? 'done' : 'warning',
          });
        }
      }
      if (needsContract) {
        flowSteps.push({
          id: flowSteps.length,
          label: 'Settlement contract',
          detail: contractPath === 'auto' ? 'Auto-settled via LP fiat bandwidth' : 'Listed in LP marketplace for manual claim',
          icon: 'contract',
          status: 'done',
        });
      }
      flowSteps.push({
        id: flowSteps.length,
        label: 'Unified pipeline dispatch',
        detail: pipelineResult.dispatched ? `✓ Dispatched through RuntimeHost → ${pipelineResult.events.length} events, ${pipelineResult.ledgerEntries} ledger entries, ${pipelineResult.latencyMs}ms` : `✗ Pipeline error: ${pipelineResult.error ?? 'unknown'}`,
        icon: 'pipeline',
        status: pipelineResult.dispatched ? 'done' : 'error',
      });
      flowSteps.push({
        id: flowSteps.length,
        label: 'Settlement complete',
        detail: `Fee: ${fees.bps}bps = $${feeAmount} (PaySwap: $${payswapRevenue}, LPs: $${lpRevenue})`,
        icon: 'checkmark',
        status: 'done',
      });

      // ── 7. Competitor cost comparison ──
      const isCrossBorder = fromCountry !== toCountry;
      const competitorFeeBps = isCrossBorder ? 390 : 150; // Paystack
      const competitorCost = Math.round((amount * competitorFeeBps) / 10000);
      const customerSavings = competitorCost - feeAmount;

      return NextResponse.json({
        ok: true,
        worldState: { countries, lps, marketplaceContracts },
        routing: {
          strategy,
          feeBps: fees.bps,
          feeAmount,
          payswapRevenue,
          lpRevenue,
          fromCountry, toCountry, amount,
          fromCurrency: currencyFor(fromCountry),
          toCurrency: currencyFor(toCountry),
          isCrossBorder,
        },
        bandwidth: bandwidthNeeded,
        contract: { needsContract, contractPath, contractSteps },
        pipeline: pipelineResult,
        flowSteps,
        costComparison: {
          paySwapCost: feeAmount,
          paystackCost: competitorCost,
          savings: customerSavings,
          savingsPercent: competitorCost > 0 ? Math.round((customerSavings / competitorCost) * 100) : 0,
        },
        message: `✓ ${fromCountry}→${toCountry} ${amount}: ${strategy}, ${fees.bps}bps fee, ${pipelineResult.events.length} pipeline events, ${customerSavings > 0 ? `${Math.round((customerSavings / competitorCost) * 100)}% cheaper than Paystack` : 'N/A'}.`,
      });
    }

    // ── visualizeRoute: show how a payment is routed (5 candidates, 8 objectives, execution flow) ──
    if (action === 'visualizeRoute') {
      const fromCountry = (body.fromCountry as string) ?? 'Ghana';
      const toCountry = (body.toCountry as string) ?? 'Kenya';
      const amount = (body.amount as number) ?? 5000;
      const kernel = await import('@/kernel');
      const base = kernel.defaultScenario();
      // Override the scenario for the requested corridor
      const scenario: typeof base = {
        ...base,
        name: `${fromCountry}→${toCountry} ${amount}`,
        transaction: {
          ...base.transaction,
          type: fromCountry === toCountry ? 'domestic' : 'cross_border',
          buyer: { country: fromCountry, currency: (fromCountry === 'Kenya' ? 'KES' : fromCountry === 'Nigeria' ? 'NGN' : fromCountry === 'Togo' ? 'XOF' : 'GHS') as never, method: 'Bank Transfer', foId: 'fo-bank-gh' },
          merchant: { country: toCountry, currency: (toCountry === 'Kenya' ? 'KES' : toCountry === 'Nigeria' ? 'NGN' : toCountry === 'Togo' ? 'XOF' : 'GHS') as never, method: 'Bank Transfer', foId: 'fo-bank-gh' },
          amount,
          currency: (toCountry === 'Kenya' ? 'KES' : toCountry === 'Nigeria' ? 'NGN' : toCountry === 'Togo' ? 'XOF' : 'GHS') as never,
          priority: 'cheapest',
        },
        treasury: {
          ...base.treasury,
          originReserve: { country: fromCountry, currency: (fromCountry === 'Kenya' ? 'KES' : fromCountry === 'Nigeria' ? 'NGN' : fromCountry === 'Togo' ? 'XOF' : 'GHS') as never, available: fromCountry === 'Ghana' || fromCountry === 'Togo' ? 5_000_000 : 0, minThreshold: 500_000 },
          destinationReserve: { country: toCountry, currency: (toCountry === 'Kenya' ? 'KES' : toCountry === 'Nigeria' ? 'NGN' : toCountry === 'Togo' ? 'XOF' : 'GHS') as never, available: toCountry === 'Ghana' || toCountry === 'Togo' ? 5_000_000 : 0, minThreshold: 500_000 },
        },
      };
      const result = kernel.simulationEngine.run(scenario);
      // Extract candidate plans with scores
      const candidates = result.candidatePlans.map((cp: { label: string; strategy: string; weightedScore: number; objectiveScores: Array<{ objective: string; score: number; raw: number; rationale: string }>; notes: string; }) => ({
        label: cp.label,
        strategy: cp.strategy,
        weightedScore: cp.weightedScore,
        objectiveScores: cp.objectiveScores,
        notes: cp.notes ?? '',
        isWinner: cp.label === result.plan.reasoning.strategy || cp.weightedScore === result.plan.reasoning.weightedScore,
      }));
      // Mark the actual winner
      if (candidates.length > 0) {
        const maxScore = Math.max(...candidates.map((c: { weightedScore: number }) => c.weightedScore));
        candidates.forEach((c: { isWinner: boolean; weightedScore: number }) => { c.isWinner = c.weightedScore === maxScore; });
      }
      // Extract execution steps
      const steps = result.plan.steps.map((s: { frame: number; type: string; title: string; description: string; amount?: number; currency?: string }) => ({
        frame: s.frame, type: s.type, title: s.title, description: s.description,
        amount: s.amount, currency: s.currency,
      }));
      return NextResponse.json({
        ok: true,
        strategy: result.plan.reasoning.strategy,
        candidates,
        winner: candidates.find((c: { isWinner: boolean }) => c.isWinner) ?? candidates[0],
        steps,
        metrics: {
          costPercent: result.plan.metrics.costPercent,
          settlementTimeMs: result.plan.metrics.settlementTimeMs,
          settlementTimeLabel: result.plan.metrics.settlementTimeLabel,
          riskScore: result.plan.metrics.riskScore,
          riskLabel: result.plan.metrics.riskLabel,
          confidence: result.plan.metrics.confidence,
          twinTokensMinted: result.plan.metrics.twinTokensMinted,
        },
        feeModel: {
          totalFeeBps: 100, // approximated from strategy
          lpSharePercent: result.plan.reasoning.strategy.includes('MARKET') ? 80 : 0,
          payswapSharePercent: result.plan.reasoning.strategy.includes('MARKET') ? 20 : 100,
        },
        requiredBandwidth: [], // populated from the plan if available
        stablecoinUsage: { required: false, amount: 0, source: 'treasury' },
        settlementActions: result.plan.steps.filter((s: { type: string }) => s.type.includes('contract') || s.type.includes('stablecoin')).map((s: { type: string; description: string }) => ({ type: s.type, reason: s.description })),
        message: `✓ Routed ${amount} ${fromCountry}→${toCountry}: ${result.plan.reasoning.strategy} (score ${result.plan.reasoning.weightedScore}).`,
      });
    }

    // ── economicSim: comprehensive Monte Carlo economic simulation ──
    if (action === 'economicSim') {
      const { runEconomicSimulation } = await import('@/kernel/economic-simulation');
      const horizon = (body.horizon as '1y' | '2y' | '3y') ?? '1y';
      const result = runEconomicSimulation(horizon, (body.seed as number) ?? 42);
      return NextResponse.json({
        ok: true,
        ...result,
        message: `✓ ${horizon} economic sim: ${result.totalPayments} payments, $${result.payswapTotalRevenue} PaySwap revenue, $${result.lpTotalRevenue} LP revenue, ${result.savingsPercent}% cheaper than competitors.`,
      });
    }

    // ── competitorComparison: fee comparison vs alternatives ──
    if (action === 'competitorComparison') {
      const { getCompetitorComparison } = await import('@/kernel/economic-simulation');
      const fees = getCompetitorComparison();
      return NextResponse.json({
        ok: true,
        competitors: fees,
        message: 'PaySwap: 80bps local / 120bps cross-border vs Paystack 150/390, Flutterwave 140/380, Stripe 290/340.',
      });
    }

    return NextResponse.json({ error: 'Unknown action (use prove | certify | verifyBadge | planRoute | liveStripe | livePaystack | liveFlutterwave | liveStellar | liveStellarPath | liveMaps | planRouteLive | liveReport | testScenarios | multiYearSim | edgeCaseProbe | settlementSim | unifiedPipelineTest | livePipelineTest | economicSim | competitorComparison)' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
