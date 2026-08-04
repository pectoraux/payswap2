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

    return NextResponse.json({ error: 'Unknown action (use prove | certify | verifyBadge | planRoute)' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
