// Simulator Integration — sim = prod. (M-RT-13.)
export type {
  ExecutionMode,
  SideEffectPolicy,
  RuntimeContext,
  WorldStateOverrides,
  TraceEquivalenceResult,
  TraceDifference,
  SimulationComparison,
} from './types';
export { SimulatorEngine } from './engine';
export type { SimulatorInputs } from './engine';
