/**
 * Supply Chain Domain — built on the exact same kernel.
 *
 * NO money. NO LPs. NO escrow. NO obligations. NO finance.
 *
 * Just containers, trucks, warehouses, and customs slots.
 *
 * This proves the kernel is a coordination runtime, not a financial runtime.
 * The same 7 primitives (Entity, Capability, Evidence, Proposal, Command,
 * Transition, Event) that power PaySwap also power supply chain logistics.
 *
 *   Proposal: "Move container #123 from Mombasa to Lagos"
 *   ↓
 *   Planner (same kernel ConvergencePlanner)
 *   ↓
 *   Transitions: reserve truck, reserve warehouse, reserve customs slot
 *   ↓
 *   Events: truck.reserved, warehouse.allocated, customs.cleared
 *
 * Zero kernel changes. Zero new primitives. Same convergence pipeline.
 */
import {
  type Entity,
  type Evidence,
  type ConvergenceIntent,
  type ConvergencePlan,
  type SimulationResult,
  type SimulationScenario,
  createEntity,
  createEvidence,
  entitiesFromScenario,
  simulationEngine,
  ConvergencePlanner,
  convergencePlanner,
  resourceReservation,
  proposalStore,
  proposal,
  acceptProposal,
  activateProposal,
  completeProposal,
  evidenceStore,
  KERNEL_VERSION,
} from '@/kernel';
import { uid, round } from '@/kernel/support';

// ─── Supply Chain Entity Types ──────────────────────────────────────────────

export type SCEntityType = 'container' | 'truck' | 'warehouse' | 'customs_slot' | 'port' | 'shipper';

export interface SupplyChainWorld {
  containers: Entity[];
  trucks: Entity[];
  warehouses: Entity[];
  customsSlots: Entity[];
  ports: Entity[];
  shippers: Entity[];
  evidence: Evidence[];
}

// ─── Supply Chain Intent ────────────────────────────────────────────────────

export interface SupplyChainIntent {
  containerId: string;
  originPort: string;
  destinationPort: string;
  priority: 'fastest' | 'cheapest' | 'safest';
  deadline: number;
}

// ─── Supply Chain Scenario ──────────────────────────────────────────────────

export interface SupplyChainScenario {
  id: string;
  name: string;
  description: string;
  intent: SupplyChainIntent;
  world: SupplyChainWorld;
  expectedBehavior: string;
  validates: string[];
}

// ─── Entity Factories ───────────────────────────────────────────────────────

export function createContainer(id: string, origin: string, destination: string, cargo: string): Entity {
  return createEntity('custom', `Container ${id}`, {
    id: `container:${id}`,
    state: 'awaiting_transport',
    country: origin,
    balance: 0,
    capabilities: { canTransfer: true },
    attributes: { destination, cargo, origin },
    metadata: { createdAt: Date.now(), updatedAt: Date.now(), version: 1, createdBy: 'sc_system', tags: ['container'] },
  });
}

export function createTruck(id: string, location: string, capacity: number, speedMs: number, feeBps: number): Entity {
  return createEntity('custom', `Truck ${id}`, {
    id: `truck:${id}`,
    state: 'available',
    country: location,
    balance: capacity,
    capabilities: { canBridge: true, canTransfer: true },
    policies: { feeBps, minThreshold: 0 },
    attributes: { location, capacity, speedMs, type: 'truck' },
    metadata: { createdAt: Date.now(), updatedAt: Date.now(), version: 1, createdBy: 'sc_system', tags: ['truck'] },
  });
}

export function createWarehouse(id: string, location: string, capacity: number, feeBps: number): Entity {
  return createEntity('custom', `Warehouse ${id}`, {
    id: `warehouse:${id}`,
    state: 'available',
    country: location,
    balance: capacity,
    capabilities: { canBridge: true, canReceive: true },
    policies: { feeBps, minThreshold: 0 },
    attributes: { location, capacity, type: 'warehouse' },
    metadata: { createdAt: Date.now(), updatedAt: Date.now(), version: 1, createdBy: 'sc_system', tags: ['warehouse'] },
  });
}

export function createCustomsSlot(id: string, location: string, capacity: number, feeBps: number): Entity {
  return createEntity('custom', `Customs ${id}`, {
    id: `customs:${id}`,
    state: 'available',
    country: location,
    balance: capacity,
    capabilities: { canBridge: true, canReceive: true },
    policies: { feeBps, minThreshold: 0 },
    attributes: { location, capacity, type: 'customs' },
    metadata: { createdAt: Date.now(), updatedAt: Date.now(), version: 1, createdBy: 'sc_system', tags: ['customs'] },
  });
}

export function createPort(name: string, country: string): Entity {
  return createEntity('custom', `Port ${name}`, {
    id: `port:${name}`,
    state: 'operational',
    country,
    balance: 0,
    capabilities: { canReceive: true, canTransfer: true },
    attributes: { type: 'port' },
    metadata: { createdAt: Date.now(), updatedAt: Date.now(), version: 1, createdBy: 'sc_system', tags: ['port'] },
  });
}

// ─── Evidence (supply chain uses same Evidence primitive) ───────────────────

export function createTransportProof(truckId: string, capacity: number): Evidence {
  return createEvidence({
    type: 'attestation',
    source: 'third_party_attestation',
    verificationLevel: 'institutional',
    entityId: truckId,
    attestedAmount: capacity,
    currency: 'units',
    reputation: 0.85,
    attester: 'logistics_api',
    ttlMs: 600000,
    payload: { kind: 'transport_capacity', attestedValue: `${capacity} units available` },
  });
}

export function createWarehouseProof(warehouseId: string, capacity: number): Evidence {
  return createEvidence({
    type: 'attestation',
    source: 'third_party_attestation',
    verificationLevel: 'attested',
    entityId: warehouseId,
    attestedAmount: capacity,
    currency: 'units',
    reputation: 0.8,
    attester: 'warehouse_management_system',
    ttlMs: 600000,
    payload: { kind: 'warehouse_capacity', attestedValue: `${capacity} slots available` },
  });
}

// ─── Supply Chain Runner (uses same kernel.converge pipeline) ───────────────

export interface SupplyChainResult {
  scenarioId: string;
  scenarioName: string;
  feasible: boolean;
  plansGenerated: number;
  winnerLabel: string;
  transitionCount: number;
  transitions: { type: string; entityId: string; command: string; capability: string; amount?: number }[];
  evidenceCount: number;
  reservations: { resourceType: string; ownerId: string; amount: number; state: string }[];
  proposals: { type: string; state: string; proposerId: string; beneficiaryId: string }[];
  converged: boolean;
  kernelVersion: string;
  validates: string[];
  expectedBehavior: string;
}

/**
 * Run a supply chain scenario through the SAME kernel convergence pipeline.
 * Zero kernel changes. Same planner. Same evidence. Same transitions.
 * Same proposals. Same resource reservations. Same event store.
 */
export function runSupplyChainScenario(scenario: SupplyChainScenario): SupplyChainResult {
  const { intent, world } = scenario;

  // Collect all entities
  const allEntities = [
    ...world.containers,
    ...world.trucks,
    ...world.warehouses,
    ...world.customsSlots,
    ...world.ports,
  ];

  // Build convergence intent — same structure as PaySwap
  const convergenceIntent: ConvergenceIntent = {
    currentWorld: { entities: allEntities, evidence: world.evidence },
    desiredWorld: {
      deltas: [
        { entityId: `container:${intent.containerId}`, amount: -1, command: 'TransferContainer', capability: 'canTransfer', fromState: 'awaiting_transport', toState: 'in_transit' },
        { entityId: `port:${intent.destinationPort}`, amount: 1, command: 'ReceiveContainer', capability: 'canReceive', fromState: 'operational', toState: 'operational' },
      ],
    },
    constraints: { maxCostPercent: 100, maxRiskScore: 0.8, maxSettlementMs: intent.deadline, minConfidence: 0.3 },
    objectives: {
      cost: intent.priority === 'cheapest' ? 0.7 : 0.2,
      speed: intent.priority === 'fastest' ? 0.7 : 0.2,
      safety: intent.priority === 'safest' ? 0.7 : 0.2,
      liquidityPreservation: 0.2, merchantSatisfaction: 0.3,
      communityImpact: 0.1, carbonImpact: 0.1, treasuryHealth: 0.2,
    },
    policies: { reservePolicy: 'hybrid', maxLpShare: 0.7, requireInsurance: false },
  };

  // Run the SAME kernel planner
  const planner = new ConvergencePlanner();
  const output = planner.converge(convergenceIntent);

  // Create proposals for each transition (same Proposal primitive)
  proposalStore.reset();
  const proposals = output.transitions.map((t) => {
    let p = proposal({
      type: 'transfer',
      proposerId: t.entityId,
      beneficiaryId: `container:${intent.containerId}`,
      amount: t.amount,
      confidence: 0.85,
      ttlMs: intent.deadline,
    });
    p = acceptProposal(p);
    p = activateProposal(p, uid('obl'));
    p = completeProposal(p);
    proposalStore.register(p);
    return { type: p.type, state: p.state, proposerId: p.proposerId, beneficiaryId: p.beneficiaryId };
  });

  // Reserve resources (same ResourceReservation primitive)
  resourceReservation.reset();
  const reservations: SupplyChainResult['reservations'] = [];
  for (const t of output.transitions) {
    if (t.amount && t.amount > 0) {
      const r = resourceReservation.reserve('transport_capacity', t.entityId, 'container', t.amount, intent.deadline);
      if (r) {
        resourceReservation.consume(r.id);
        reservations.push({ resourceType: r.resourceType, ownerId: r.ownerId, amount: r.amount, state: r.state });
      }
    }
  }

  const converged = output.winner.feasible && output.transitions.length > 0;

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    feasible: output.winner.feasible,
    plansGenerated: output.plans.length,
    winnerLabel: output.winner.label,
    transitionCount: output.transitions.length,
    transitions: output.transitions.map((t) => ({
      type: t.command, entityId: t.entityId, command: t.command,
      capability: t.capability, amount: t.amount,
    })),
    evidenceCount: world.evidence.length,
    reservations,
    proposals,
    converged,
    kernelVersion: KERNEL_VERSION,
    validates: scenario.validates,
    expectedBehavior: scenario.expectedBehavior,
  };
}
