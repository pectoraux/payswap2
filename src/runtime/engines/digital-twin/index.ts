// Digital Twin — pure simulation layer. (M-RT-11.)
export type {
  NetworkSnapshot,
  PredictedMetric,
  NetworkComparison,
  SimulationAssumption,
  SimulationResult,
  TwinConfig,
  SimulatableRecommendation,
} from './types';
export { DEFAULT_TWIN_CONFIG } from './types';
export { DigitalTwinEngine } from './engine';
export type { DigitalTwinInputs } from './engine';
