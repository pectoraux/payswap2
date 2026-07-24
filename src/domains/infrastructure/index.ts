/**
 * Infrastructure Orchestration Domain — third protocol on the same kernel.
 *
 * No finance. No logistics. Just servers, databases, regions, and operators.
 *
 * Domain objects: Server, Database, Region, Operator, BackupSystem
 * Capabilities: canHost, canReplicate, canBackup, canFailover
 * Evidence: HealthCheck, CapacityReport, SecurityAttestation, LatencyMeasurement
 * Proposals: "I will host workload X", "I will replicate database Y"
 * Commands: AllocateResource, ReplicateData, Failover, Restore
 *
 * The kernel must support this with ZERO kernel changes.
 */
import {
  type Entity, type Evidence, type ConvergenceIntent,
  createEntity, createEvidence, ConvergencePlanner,
  resourceReservation, proposalStore,
  proposal, acceptProposal, activateProposal, completeProposal,
  KERNEL_VERSION,
} from '@/kernel';
import { uid } from '@/kernel/support';

// ─── Entity Factories ───────────────────────────────────────────────────────

export function createServer(id: string, region: string, capacity: number, latencyMs: number): Entity {
  return createEntity('server', `Server ${id}`, {
    id: `server:${id}`, state: 'available', country: region, balance: capacity,
    capabilities: { canHost: true as any, canBridge: true, canTransfer: true },
    policies: { feeBps: 0 },
    attributes: { region, capacity, latencyMs, type: 'server' },
    metadata: { createdAt: Date.now(), updatedAt: Date.now(), version: 1, createdBy: 'infra_system', tags: ['server'] },
  });
}

export function createDatabase(id: string, region: string, dataSize: number): Entity {
  return createEntity('database', `Database ${id}`, {
    id: `db:${id}`, state: 'running', country: region, balance: dataSize,
    capabilities: { canReplicate: true as any, canReceive: true },
    attributes: { region, dataSize, type: 'database' },
    metadata: { createdAt: Date.now(), updatedAt: Date.now(), version: 1, createdBy: 'infra_system', tags: ['database'] },
  });
}

export function createBackupSystem(id: string, region: string, capacity: number): Entity {
  return createEntity('backup', `Backup ${id}`, {
    id: `backup:${id}`, state: 'available', country: region, balance: capacity,
    capabilities: { canBackup: true as any, canBridge: true, canReceive: true },
    attributes: { region, capacity, type: 'backup' },
    metadata: { createdAt: Date.now(), updatedAt: Date.now(), version: 1, createdBy: 'infra_system', tags: ['backup'] },
  });
}

// ─── Evidence Factories ─────────────────────────────────────────────────────

export function createHealthCheck(serverId: string, healthy: boolean): Evidence {
  return createEvidence({
    type: 'observation', source: 'protocol_observation', verificationLevel: 'cryptographic',
    entityId: serverId, attestedAmount: healthy ? 1 : 0, currency: 'health',
    reputation: 0.9, attester: 'monitoring_system', ttlMs: 30000,
    payload: { kind: 'health_check', healthy, attestedValue: healthy ? 'healthy' : 'unhealthy' },
  });
}

export function createCapacityReport(serverId: string, availableCapacity: number): Evidence {
  return createEvidence({
    type: 'attestation', source: 'protocol_observation', verificationLevel: 'institutional',
    entityId: serverId, attestedAmount: availableCapacity, currency: 'units',
    reputation: 0.85, attester: 'capacity_monitor', ttlMs: 60000,
    payload: { kind: 'capacity_report', attestedValue: `${availableCapacity} units available` },
  });
}

export function createLatencyMeasurement(serverId: string, latencyMs: number): Evidence {
  return createEvidence({
    type: 'observation', source: 'protocol_observation', verificationLevel: 'cryptographic',
    entityId: serverId, attestedAmount: latencyMs, currency: 'ms',
    reputation: 0.95, attester: 'latency_probe', ttlMs: 15000,
    payload: { kind: 'latency', attestedValue: `${latencyMs}ms` },
  });
}

// ─── Infrastructure Scenarios ───────────────────────────────────────────────

export interface InfraScenario {
  id: string; name: string; description: string;
  entities: Entity[]; evidence: Evidence[];
  intent: { sourceEntityId: string; targetEntityId: string; amount: number; priority: string };
  expectedBehavior: string; validates: string[];
}

export function infrastructureScenarios(): InfraScenario[] {
  return [
    {
      id: 'infra-deploy',
      name: 'Deploy Workload',
      description: 'Deploy a workload to the best available server based on health + capacity + latency.',
      entities: [
        createServer('S01', 'us-east', 100, 20),
        createServer('S02', 'eu-west', 100, 45),
        createServer('S03', 'ap-south', 100, 80),
      ],
      evidence: [
        createHealthCheck('server:S01', true),
        createHealthCheck('server:S02', true),
        createHealthCheck('server:S03', true),
        createCapacityReport('server:S01', 80),
        createCapacityReport('server:S02', 90),
        createCapacityReport('server:S03', 100),
        createLatencyMeasurement('server:S01', 20),
        createLatencyMeasurement('server:S02', 45),
        createLatencyMeasurement('server:S03', 80),
      ],
      intent: { sourceEntityId: 'workload:W01', targetEntityId: 'server', amount: 50, priority: 'fastest' },
      expectedBehavior: 'Planner selects server with best evidence (lowest latency, highest capacity).',
      validates: ['planning-success', 'evidence-cited', 'convergence'],
    },
    {
      id: 'infra-replicate',
      name: 'Replicate Database',
      description: 'Replicate database to a backup system in a different region.',
      entities: [
        createDatabase('DB01', 'us-east', 500),
        createBackupSystem('BK01', 'eu-west', 1000),
        createBackupSystem('BK02', 'ap-south', 800),
      ],
      evidence: [
        createCapacityReport('backup:BK01', 900),
        createCapacityReport('backup:BK02', 700),
      ],
      intent: { sourceEntityId: 'db:DB01', targetEntityId: 'backup', amount: 500, priority: 'safest' },
      expectedBehavior: 'Planner selects backup system with sufficient capacity + evidence.',
      validates: ['planning-success', 'multi-hop', 'evidence-cited'],
    },
    {
      id: 'infra-failover',
      name: 'Failover (unhealthy server)',
      description: 'Primary server is unhealthy. Planner must failover to healthy server.',
      entities: [
        createServer('S01', 'us-east', 100, 20),
        createServer('S02', 'eu-west', 100, 45),
      ],
      evidence: [
        createHealthCheck('server:S01', false), // unhealthy!
        createHealthCheck('server:S02', true),
        createCapacityReport('server:S01', 0), // no capacity
        createCapacityReport('server:S02', 100),
      ],
      intent: { sourceEntityId: 'workload:W02', targetEntityId: 'server', amount: 50, priority: 'fastest' },
      expectedBehavior: 'S01 has 0 capacity (unhealthy). Planner selects S02.',
      validates: ['fault-tolerance', 'evidence-based-rejection', 'convergence'],
    },
    {
      id: 'infra-insufficient',
      name: 'Insufficient Capacity (should fail)',
      description: 'No server has enough capacity. Planner should report infeasible.',
      entities: [
        createServer('S01', 'us-east', 10, 20),
        createServer('S02', 'eu-west', 5, 45),
      ],
      evidence: [
        createCapacityReport('server:S01', 10),
        createCapacityReport('server:S02', 5),
      ],
      intent: { sourceEntityId: 'workload:W03', targetEntityId: 'server', amount: 50, priority: 'cheapest' },
      expectedBehavior: 'No server has 50 units — plan infeasible.',
      validates: ['planning-failure-detected'],
    },
    {
      id: 'infra-stale-evidence',
      name: 'Stale Evidence (no health check)',
      description: 'No health checks provided. Confidence should be low.',
      entities: [createServer('S01', 'us-east', 100, 20)],
      evidence: [], // no evidence
      intent: { sourceEntityId: 'workload:W04', targetEntityId: 'server', amount: 50, priority: 'safest' },
      expectedBehavior: 'No evidence → zero confidence → low-quality plan.',
      validates: ['evidence-required', 'confidence-affects-planning'],
    },
  ];
}

// ─── Infrastructure Runner (uses SAME kernel converge) ──────────────────────

export interface InfraResult {
  scenarioId: string; scenarioName: string;
  feasible: boolean; plansGenerated: number; winnerLabel: string;
  transitionCount: number; evidenceCount: number;
  converged: boolean; kernelVersion: string;
  validates: string[]; expectedBehavior: string;
}

export function runInfraScenario(scenario: InfraScenario): InfraResult {
  const planner = new ConvergencePlanner();
  const output = planner.converge({
    currentWorld: { entities: scenario.entities, evidence: scenario.evidence },
    desiredWorld: {
      deltas: [
        { entityId: scenario.intent.sourceEntityId, amount: -scenario.intent.amount, command: 'AllocateResource', capability: 'canTransfer', fromState: 'pending', toState: 'allocated' },
        { entityId: scenario.intent.targetEntityId, amount: scenario.intent.amount, command: 'ReceiveResource', capability: 'canReceive', fromState: 'available', toState: 'allocated' },
      ],
    },
    constraints: { maxCostPercent: 100, maxRiskScore: 0.8, maxSettlementMs: 60000, minConfidence: 0.1 },
    objectives: { cost: 0.2, speed: 0.3, safety: 0.3, liquidityPreservation: 0.2, merchantSatisfaction: 0.2, communityImpact: 0.1, carbonImpact: 0.1, treasuryHealth: 0.2 },
    policies: { reservePolicy: 'hybrid', maxLpShare: 0.7, requireInsurance: false },
  });

  return {
    scenarioId: scenario.id, scenarioName: scenario.name,
    feasible: output.winner.feasible,
    plansGenerated: output.plans.length,
    winnerLabel: output.winner.label,
    transitionCount: output.transitions.length,
    evidenceCount: scenario.evidence.length,
    converged: output.winner.feasible && output.transitions.length > 0,
    kernelVersion: KERNEL_VERSION,
    validates: scenario.validates,
    expectedBehavior: scenario.expectedBehavior,
  };
}
