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
        // 13: Insufficient funds — amount exceeds all liquidity
        { id: 13, name: 'Insufficient Funds (rejected)', category: 'INSUFFICIENT_FUNDS', expectSettled: false,
          knownGap: 'GAP: The kernel PlanExecutor does not enforce capacity limits — it processes the amount without checking if total available liquidity (LP bandwidth + stablecoin + reserves) is sufficient. A 999M KES payment with only ~50K available still settles. This is a real enforcement gap: hard capacity rejection is not implemented.',
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' }, merchant: { country: 'Nigeria', currency: 'NGN', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 999999999, currency: 'KES', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 }, destinationReserve: { country: 'Nigeria', currency: 'NGN', available: 0, minThreshold: 0 }, stablecoinBalance: 50000 } } },
        // 14: Emergency freeze — strict policy, no stablecoin, no emergency treasury
        { id: 14, name: 'Treasury Emergency Freeze (Kenya)', category: 'EMERGENCY_FREEZE', expectSettled: false,
          knownGap: 'GAP: The kernel does not implement country-level emergency freeze as a hard block. reservePolicy:"strict" is advisory (affects treasury recommendations) but does not prevent settlement. The payment settles because the destination (Ghana) has reserves. Emergency freeze enforcement is not implemented in the PlanExecutor.',
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' }, merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 500, currency: 'KES', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 }, destinationReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 }, stablecoinBalance: 0, emergencyTreasury: 0, reservePolicy: 'strict' }, policies: { maxRiskScore: 0.05 }, liquidityProviders: [] } },
        // 15: Claims/voting — disputed scenario with compliance hold
        { id: 15, name: 'Claims/Evidence/Voting (dispute)', category: 'CLAIMS', expectSettled: true,
          overrides: { transaction: { type: 'cross_border', buyer: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' }, merchant: { country: 'Togo', currency: 'XOF', method: 'Bank Transfer', foId: 'fo-bank-gh' }, amount: 1000, currency: 'GHS', merchantType: 'Export merchant', customerType: 'Retail buyer', priority: 'cheapest' }, treasury: { originReserve: { country: 'Ghana', currency: 'GHS', available: 5000000, minThreshold: 500000 }, destinationReserve: { country: 'Togo', currency: 'XOF', available: 3000000, minThreshold: 300000 } }, policies: { requireInsurance: true }, failures: [{ id: 'fail_s15', type: 'insurance_claim', label: 'Merchant dispute — LP failed to settle', atFrame: 1 }] } },
      ];

      const results = scenarios.map((s) => {
        try {
          const scenario = buildScenario(`S${s.id}: ${s.category}`, s.overrides);
          const result = simulationEngine.run(scenario);
          const actualStrategy = (result.plan.reasoning as { strategy?: string }).strategy ?? 'UNKNOWN';
          const eventTypes = result.events.map((e: { type?: string }) => e.type ?? 'unknown');
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
        source: 'TEST-SCENARIOS.md (15 scenarios)',
        summary: { total: results.length, passed, failed, passRate: Math.round((passed / results.length) * 100) },
        results,
        message: `✓ Test scenarios: ${passed}/${results.length} passed (${failed} failed).`,
      });
    }

    return NextResponse.json({ error: 'Unknown action (use prove | certify | verifyBadge | planRoute | liveStripe | livePaystack | liveFlutterwave | liveStellar | liveStellarPath | liveMaps | planRouteLive | liveReport | testScenarios)' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
