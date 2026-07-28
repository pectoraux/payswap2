/**
 * Built-in plugins bundled with the PaySwap Capability SDK.
 *
 * Each entry is `{ manifest, module }`. They are auto-registered (and
 * auto-enabled) by the SDK singleton on first access so the admin UI has
 * something to show without manual setup.
 *
 * Adding a new built-in:
 *   1. Create `<name>.ts` exporting `{ <name>Manifest, <name>Module }`
 *   2. Add an entry to BUILTIN_PLUGINS below.
 */

import type { PluginManifest, PluginModule } from '../types';
import { mtnGhanaMomoManifest, mtnGhanaMomoModule } from './mtn-ghana-momo';
import { basicFraudManifest, basicFraudModule } from './basic-fraud-detection';
import { treasuryAnalyticsManifest, treasuryAnalyticsModule } from './treasury-analytics';

export interface BuiltinPlugin {
  manifest: PluginManifest;
  module: PluginModule;
}

export const BUILTIN_PLUGINS: BuiltinPlugin[] = [
  { manifest: mtnGhanaMomoManifest, module: mtnGhanaMomoModule },
  { manifest: basicFraudManifest, module: basicFraudModule },
  { manifest: treasuryAnalyticsManifest, module: treasuryAnalyticsModule },
];
