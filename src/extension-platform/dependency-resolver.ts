/**
 * Extension Platform — Dependency Resolver.
 *
 * Solves dependency graphs before installation. Extensions declare:
 *   - dependencies: required extensions with version ranges
 *   - conflicts: extensions that cannot coexist
 *   - provides: capability ids this extension provides (for virtual dependencies)
 *   - optional: optional dependencies
 *
 * The resolver performs topological sort + conflict detection + version range
 * matching. If resolution fails, installation is aborted.
 */

import { parseSemVer, compareSemVer } from './types';
import type { ExtensionManifestV2, ExtensionDependency } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// VERSION RANGE MATCHING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a version satisfies a range string.
 * Supports: ^1.0.0 (compatible), ~1.0.0 (patch), >=1.0.0 <2.0.0 (range), * (any)
 */
export function satisfiesVersion(version: string, range: string): boolean {
  const v = parseSemVer(version);

  // Any version
  if (range === '*') return true;

  // Caret range: ^1.0.0 → >=1.0.0 <2.0.0 (compatible with)
  const caretMatch = range.match(/^\^(\d+)\.(\d+)\.(\d+)/);
  if (caretMatch) {
    const min = parseSemVer(`${caretMatch[1]}.${caretMatch[2]}.${caretMatch[3]}`);
    const max = parseSemVer(`${Number(caretMatch[1]) + 1}.0.0`);
    return compareSemVer(v, min) >= 0 && compareSemVer(v, max) < 0;
  }

  // Tilde range: ~1.0.0 → >=1.0.0 <1.1.0 (patch only)
  const tildeMatch = range.match(/^~(\d+)\.(\d+)\.(\d+)/);
  if (tildeMatch) {
    const min = parseSemVer(`${tildeMatch[1]}.${tildeMatch[2]}.${tildeMatch[3]}`);
    const max = parseSemVer(`${tildeMatch[1]}.${Number(tildeMatch[2]) + 1}.0`);
    return compareSemVer(v, min) >= 0 && compareSemVer(v, max) < 0;
  }

  // Range: >=1.0.0 <2.0.0
  const rangeMatch = range.match(/^(>=|>|<=|<)(\d+\.\d+\.\d+)\s*(>=|>|<=|<)?\s*(\d+\.\d+\.\d+)?/);
  if (rangeMatch) {
    const op1 = rangeMatch[1];
    const v1 = parseSemVer(rangeMatch[2]);
    const cmp1 = compareSemVer(v, v1);
    const ok1 = op1 === '>=' ? cmp1 >= 0 : op1 === '>' ? cmp1 > 0 : op1 === '<=' ? cmp1 <= 0 : cmp1 < 0;
    if (!ok1) return false;
    if (rangeMatch[3] && rangeMatch[4]) {
      const op2 = rangeMatch[3];
      const v2 = parseSemVer(rangeMatch[4]);
      const cmp2 = compareSemVer(v, v2);
      return op2 === '>=' ? cmp2 >= 0 : op2 === '>' ? cmp2 > 0 : op2 === '<=' ? cmp2 <= 0 : cmp2 < 0;
    }
    return true;
  }

  // Exact match
  try {
    return compareSemVer(v, parseSemVer(range)) === 0;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DEPENDENCY RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

export interface ResolvedDependency {
  id: string;
  version: string;
  available: boolean;         // is this extension installed or installable?
  optional: boolean;
}

export interface DependencyResolutionResult {
  resolved: ResolvedDependency[];
  missing: ExtensionDependency[];      // dependencies that couldn't be resolved
  conflicts: Array<{ extensionA: string; extensionB: string; reason: string }>;
  installOrder: string[];              // topological order
  success: boolean;
  error?: string;
}

/**
 * Resolve dependencies for an extension being installed.
 * @param manifest The extension to install.
 * @param installedExtensions Currently installed extensions (id → version).
 * @param availableExtensions Extensions available in the marketplace (id → versions[]).
 */
export function resolveDependencies(
  manifest: ExtensionManifestV2,
  installedExtensions: Map<string, string>,
  availableExtensions: Map<string, string[]>,
): DependencyResolutionResult {
  const resolved: ResolvedDependency[] = [];
  const missing: ExtensionDependency[] = [];
  const conflicts: Array<{ extensionA: string; extensionB: string; reason: string }> = [];
  const installOrder: string[] = [];

  // ── Check conflicts ──
  for (const conflict of manifest.conflicts) {
    const installedVersion = installedExtensions.get(conflict.id);
    if (installedVersion && (!conflict.versionRange || satisfiesVersion(installedVersion, conflict.versionRange))) {
      conflicts.push({
        extensionA: manifest.id,
        extensionB: conflict.id,
        reason: conflict.reason,
      });
    }
  }

  if (conflicts.length > 0) {
    return {
      resolved, missing, conflicts,
      installOrder: [],
      success: false,
      error: `${conflicts.length} conflict(s) detected: ${conflicts.map((c) => `${c.extensionA} conflicts with ${c.extensionB}`).join('; ')}`,
    };
  }

  // ── Resolve each dependency ──
  for (const dep of manifest.dependencies) {
    // Check if already installed
    const installedVersion = installedExtensions.get(dep.id);
    if (installedVersion && satisfiesVersion(installedVersion, dep.versionRange)) {
      resolved.push({ id: dep.id, version: installedVersion, available: true, optional: dep.optional ?? false });
      installOrder.push(dep.id);
      continue;
    }

    // Check if available in marketplace
    const availableVersions = availableExtensions.get(dep.id) ?? [];
    const matchingVersion = availableVersions.find((v) => satisfiesVersion(v, dep.versionRange));

    if (matchingVersion) {
      resolved.push({ id: dep.id, version: matchingVersion, available: true, optional: dep.optional ?? false });
      installOrder.push(dep.id);
    } else if (dep.optional) {
      // Optional dependency — skip silently
      resolved.push({ id: dep.id, version: '', available: false, optional: true });
    } else {
      missing.push(dep);
    }
  }

  // ── Topological sort (simplified — the extension itself is last) ──
  installOrder.push(manifest.id);

  if (missing.length > 0) {
    return {
      resolved, missing, conflicts,
      installOrder: [],
      success: false,
      error: `${missing.length} missing required dependency(ies): ${missing.map((d) => `${d.id}@${d.versionRange}`).join(', ')}`,
    };
  }

  return {
    resolved, missing, conflicts,
    installOrder,
    success: true,
  };
}
