/**
 * Supply Chain Scenarios — 5 coordination tests using the SAME kernel.
 *
 * No money. No LPs. No escrow. No obligations. No finance.
 * Just containers, trucks, warehouses, and customs.
 *
 * If these pass through the same converge() pipeline as PaySwap,
 * the kernel is proven to be a coordination runtime, not a financial runtime.
 */
import type { SupplyChainScenario } from './index';
import {
  createContainer, createTruck, createWarehouse, createCustomsSlot, createPort,
  createTransportProof, createWarehouseProof,
} from './index';

export function supplyChainScenarios(): SupplyChainScenario[] {
  return [
    // 1. Simple transport — one truck, one container
    {
      id: 'sc-simple-transport',
      name: 'Simple Container Transport',
      description: 'Move one container from Mombasa to Lagos via a single truck.',
      intent: {
        containerId: 'C001',
        originPort: 'Mombasa',
        destinationPort: 'Lagos',
        priority: 'fastest',
        deadline: 86400000,
      },
      world: {
        containers: [createContainer('C001', 'Mombasa', 'Lagos', 'Electronics')],
        trucks: [createTruck('T01', 'Mombasa', 100, 3600000, 50)],
        warehouses: [],
        customsSlots: [],
        ports: [createPort('Mombasa', 'Kenya'), createPort('Lagos', 'Nigeria')],
        shippers: [],
        evidence: [createTransportProof('truck:T01', 100)],
      },
      expectedBehavior: 'Single truck bridges container from Mombasa to Lagos.',
      validates: ['planning-success', 'convergence', 'evidence-cited', 'resource-reserved'],
    },

    // 2. Multi-hop — truck + warehouse + customs
    {
      id: 'sc-multi-hop',
      name: 'Multi-Hop Transport (truck → warehouse → customs)',
      description: 'Container moves through multiple resources: truck, warehouse, customs clearance.',
      intent: {
        containerId: 'C002',
        originPort: 'Mombasa',
        destinationPort: 'Accra',
        priority: 'cheapest',
        deadline: 172800000,
      },
      world: {
        containers: [createContainer('C002', 'Mombasa', 'Accra', 'Textiles')],
        trucks: [
          createTruck('T01', 'Mombasa', 50, 7200000, 30),
          createTruck('T02', 'Mombasa', 80, 5400000, 40),
        ],
        warehouses: [createWarehouse('W01', 'Accra', 200, 20)],
        customsSlots: [createCustomsSlot('CS01', 'Accra', 10, 15)],
        ports: [createPort('Mombasa', 'Kenya'), createPort('Accra', 'Ghana')],
        shippers: [],
        evidence: [
          createTransportProof('truck:T01', 50),
          createTransportProof('truck:T02', 80),
          createWarehouseProof('warehouse:W01', 200),
        ],
      },
      expectedBehavior: 'Multiple resources coordinated: truck + warehouse + customs.',
      validates: ['planning-success', 'convergence', 'multi-hop', 'evidence-cited'],
    },

    // 3. Capacity competition — multiple trucks compete
    {
      id: 'sc-capacity-competition',
      name: 'Capacity Competition',
      description: 'Multiple trucks with different capacity, speed, and cost. Planner selects optimal.',
      intent: {
        containerId: 'C003',
        originPort: 'Dar es Salaam',
        destinationPort: 'Lagos',
        priority: 'cheapest',
        deadline: 86400000,
      },
      world: {
        containers: [createContainer('C003', 'Dar es Salaam', 'Lagos', 'Coffee')],
        trucks: [
          createTruck('T01', 'Dar es Salaam', 100, 3600000, 80), // expensive, fast
          createTruck('T02', 'Dar es Salaam', 100, 7200000, 30), // cheap, slow
          createTruck('T03', 'Dar es Salaam', 100, 5400000, 50), // medium
        ],
        warehouses: [],
        customsSlots: [],
        ports: [createPort('Dar es Salaam', 'Tanzania'), createPort('Lagos', 'Nigeria')],
        shippers: [],
        evidence: [
          createTransportProof('truck:T01', 100),
          createTransportProof('truck:T02', 100),
          createTransportProof('truck:T03', 100),
        ],
      },
      expectedBehavior: 'Planner compares candidates and selects cheapest (T02).',
      validates: ['planning-success', 'strategy-selection', 'evidence-cited', 'convergence'],
    },

    // 4. Insufficient capacity — planner cannot converge
    {
      id: 'sc-insufficient-capacity',
      name: 'Insufficient Capacity (should fail to converge)',
      description: 'No trucks have enough capacity. Planner should report infeasible.',
      intent: {
        containerId: 'C004',
        originPort: 'Mombasa',
        destinationPort: 'Lagos',
        priority: 'fastest',
        deadline: 86400000,
      },
      world: {
        containers: [createContainer('C004', 'Mombasa', 'Lagos', 'Machinery')],
        trucks: [createTruck('T01', 'Mombasa', 5, 3600000, 50)], // only 5 capacity
        warehouses: [],
        customsSlots: [],
        ports: [createPort('Mombasa', 'Kenya'), createPort('Lagos', 'Nigeria')],
        evidence: [createTransportProof('truck:T01', 5)],
        shippers: [],
      },
      expectedBehavior: 'No truck has enough capacity — plan infeasible.',
      validates: ['planning-failure-detected', 'constitution-honors-infeasibility'],
    },

    // 5. Stale evidence — confidence decays
    {
      id: 'sc-stale-evidence',
      name: 'Stale Evidence (low confidence)',
      description: 'Transport proof is stale. Confidence should be low but plan may still succeed.',
      intent: {
        containerId: 'C005',
        originPort: 'Mombasa',
        destinationPort: 'Accra',
        priority: 'safest',
        deadline: 86400000,
      },
      world: {
        containers: [createContainer('C005', 'Mombasa', 'Accra', 'Tea')],
        trucks: [createTruck('T01', 'Mombasa', 100, 3600000, 50)],
        warehouses: [],
        customsSlots: [],
        ports: [createPort('Mombasa', 'Kenya'), createPort('Accra', 'Ghana')],
        evidence: [], // no evidence — confidence should be 0
        shippers: [],
      },
      expectedBehavior: 'No evidence → zero confidence → planner may reject or produce low-confidence plan.',
      validates: ['evidence-required', 'confidence-affects-planning'],
    },
  ];
}
