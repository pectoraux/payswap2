/**
 * Plugin Verification System.
 *
 * Runs a multi-stage pipeline on a PluginManifest (+ optional PluginModule)
 * before the plugin can be published to the public marketplace.
 *
 * Pipeline stages (run in order):
 *   1. Schema validation — manifest matches the PluginManifest type
 *   2. Dependency check — all dependencies exist and are compatible
 *   3. Permission analysis — flag dangerous permissions
 *   4. Security scan — check for known bad patterns in manifest fields
 *   5. Sandbox test — if a module is provided, load it in a sandbox and verify
 *      it doesn't crash on onLoad/onEnable/onDisable
 *   6. Capability validation — verify declared capabilities have unique ids,
 *      valid types, and (if a module is provided) that the methods referenced
 *      by commands/events/policies actually exist on the module.
 *
 * Each stage returns a list of `VerificationFinding` objects. The final
 * `VerificationResult` aggregates them into a status (passed/warning/failed)
 * and a 0-100 score.
 *
 * The verifier is a stateless class with static methods — no DB access, no
 * side effects. It's safe to call from API routes, background jobs, or tests.
 */

import type {
  PluginManifest,
  PluginModule,
  CapabilityDeclaration,
  Permission,
} from '@/sdk/types';
import { PluginLoader } from '@/sdk/loader';
import {
  DANGEROUS_PERMISSIONS,
  SUSPICIOUS_PATTERNS,
  type VerificationFinding,
  type VerificationResult,
  type VerificationStatus,
} from './types';

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/;

export interface SecurityScanResult {
  findings: VerificationFinding[];
  /** Number of error-severity findings. */
  errors: number;
  /** Number of warning-severity findings. */
  warnings: number;
}

export interface TestResult {
  ok: boolean;
  findings: VerificationFinding[];
  durationMs: number;
}

export interface FullVerificationResult extends VerificationResult {
  stages: Array<{
    name: 'schema' | 'dependencies' | 'permissions' | 'security' | 'sandbox' | 'capabilities';
    status: VerificationStatus;
    findings: VerificationFinding[];
    durationMs: number;
  }>;
}

export class PluginVerifier {
  // ── Stage 1: Schema validation ──────────────────────────────────────────

  /**
   * Validate the manifest matches the PluginManifest type structurally.
   * Mirrors PluginLoader.validateManifest but produces findings instead of
   * throwing, and adds a few extra checks (semver, unique capability ids,
   * non-empty arrays).
   */
  staticAnalysis(manifest: PluginManifest): VerificationResult {
    const start = Date.now();
    const findings: VerificationFinding[] = this.runSchemaStage(manifest);
    const { status, score } = this.aggregate(findings);
    return {
      status,
      findings,
      score,
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - start,
    };
  }

  // ── Stage 4: Security scan ──────────────────────────────────────────────

  /**
   * Scan the manifest for dangerous permissions + suspicious patterns in any
   * string field (description, capability names, command descriptions, etc.).
   *
   * NOTE: This is a STATIC scan of the manifest only. It does NOT execute
   * plugin code — that's the sandbox test. In a real platform this would be
   * paired with a SAST tool that scans the plugin's source bundle.
   */
  securityScan(manifest: PluginManifest): SecurityScanResult {
    const findings: VerificationFinding[] = [];

    // Dangerous permissions.
    for (const perm of manifest.permissions) {
      if (DANGEROUS_PERMISSIONS.includes(perm)) {
        findings.push({
          stage: 'security',
          severity: 'warning',
          message: `Permission "${perm}" is dangerous — grants write access to financial state. Reviewer must verify the plugin genuinely needs this.`,
          path: 'manifest.permissions',
        });
      }
    }

    // Many dangerous permissions on a small plugin is a red flag.
    const dangerousCount = manifest.permissions.filter((p) =>
      DANGEROUS_PERMISSIONS.includes(p),
    ).length;
    if (dangerousCount >= 4) {
      findings.push({
        stage: 'security',
        severity: 'error',
        message: `Plugin requests ${dangerousCount} dangerous write permissions. This is unusual — reviewers must scrutinize the install consent flow.`,
        path: 'manifest.permissions',
      });
    }

    // Suspicious patterns in any string field of the manifest.
    const stringFields = this.collectManifestStrings(manifest);
    for (const { path, value } of stringFields) {
      for (const { regex, reason } of SUSPICIOUS_PATTERNS) {
        if (regex.test(value)) {
          findings.push({
            stage: 'security',
            severity: 'error',
            message: `Suspicious pattern detected: ${reason}`,
            path,
          });
        }
      }
    }

    // Empty permissions array — flag as info (not necessarily wrong).
    if (manifest.permissions.length === 0) {
      findings.push({
        stage: 'security',
        severity: 'info',
        message: 'Plugin declares no permissions — verify it genuinely needs none.',
        path: 'manifest.permissions',
      });
    }

    const errors = findings.filter((f) => f.severity === 'error').length;
    const warnings = findings.filter((f) => f.severity === 'warning').length;
    return { findings, errors, warnings };
  }

  // ── Stage 5: Sandbox test ───────────────────────────────────────────────

  /**
   * Run the plugin's lifecycle hooks (onLoad, onEnable, onDisable, onUnload)
   * in a temporary PluginSandbox. Verifies the plugin doesn't crash on basic
   * lifecycle events.
   *
   * If no module is provided, this stage is skipped (status: 'info').
   */
  async automatedTest(
    manifest: PluginManifest,
    module?: PluginModule,
  ): Promise<TestResult> {
    const start = Date.now();
    const findings: VerificationFinding[] = [];

    if (!module) {
      findings.push({
        stage: 'sandbox',
        severity: 'info',
        message: 'No module provided — sandbox test skipped.',
      });
      return { ok: true, findings, durationMs: Date.now() - start };
    }

    // Build a throwaway loader + sandbox. We use the real PluginLoader so the
    // test exercises the same code path as production installs.
    const { CapabilityRegistry } = await import('@/sdk/registry');
    const sandboxMod = await import('@/sdk/sandbox');
    const PluginSandbox = sandboxMod.PluginSandbox;
    const registry = new CapabilityRegistry();
    const sandboxRuntime: import('@/sdk/sandbox').SandboxRuntime = {
      async getBalanceSheet() {
        return { assets: 0, liabilities: 0, equity: 0 };
      },
      async getDigitalTwin() {
        return { tokens: [] };
      },
      async getEvents() {
        return [];
      },
    };
    const sandbox = new PluginSandbox({
      runtime: sandboxRuntime,
      emitHook: async () => {
        /* swallow — sandbox test doesn't propagate events */
      },
      callHook: async () => {
        throw new Error('Cross-plugin calls are not allowed during sandbox testing');
      },
      onPluginError: () => {
        /* swallow */
      },
      defaultTimeoutMs: 2_000,
      failureThreshold: 99, // don't auto-disable during the test
    });
    const loader = new PluginLoader({
      registry,
      sandbox,
      // No granted-permissions restriction — the verifier needs to load any
      // manifest, even ones with permissions the runtime wouldn't grant.
    });

    try {
      // Register (validates manifest + calls onLoad).
      try {
        await loader.register(manifest, module);
      } catch (err) {
        findings.push({
          stage: 'sandbox',
          severity: 'error',
          message: `Registration failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        return { ok: false, findings, durationMs: Date.now() - start };
      }

      // Enable (calls onEnable + registers capabilities).
      try {
        await loader.enable(manifest.name);
      } catch (err) {
        findings.push({
          stage: 'sandbox',
          severity: 'error',
          message: `Enable failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        // Continue to disable to clean up.
      }

      // Disable (calls onDisable).
      try {
        await loader.disable(manifest.name);
      } catch (err) {
        findings.push({
          stage: 'sandbox',
          severity: 'warning',
          message: `Disable failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Unregister (calls onUnload).
      try {
        await loader.unregister(manifest.name);
      } catch (err) {
        findings.push({
          stage: 'sandbox',
          severity: 'warning',
          message: `Unload failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const errors = findings.filter((f) => f.severity === 'error').length;
      return { ok: errors === 0, findings, durationMs: Date.now() - start };
    } finally {
      // Best-effort cleanup.
      try {
        await loader.unregister(manifest.name);
      } catch {
        /* ignore */
      }
    }
  }

  // ── Stage 6: Capability validation ──────────────────────────────────────

  /**
   * Validate declared capabilities have unique ids, valid types, and (if a
   * module is provided) that the methods referenced by commands/events/policies
   * actually exist on the module.
   */
  validateCapabilities(
    manifest: PluginManifest,
    module?: PluginModule,
  ): VerificationFinding[] {
    const findings: VerificationFinding[] = [];

    // Unique capability ids.
    const ids = new Set<string>();
    manifest.capabilities.forEach((cap, i) => {
      if (!cap.id) {
        findings.push({
          stage: 'capabilities',
          severity: 'error',
          message: `Capability at index ${i} is missing an id.`,
          path: `manifest.capabilities[${i}].id`,
        });
        return;
      }
      if (ids.has(cap.id)) {
        findings.push({
          stage: 'capabilities',
          severity: 'error',
          message: `Duplicate capability id "${cap.id}".`,
          path: `manifest.capabilities[${i}].id`,
        });
      }
      ids.add(cap.id);
      if (!cap.name) {
        findings.push({
          stage: 'capabilities',
          severity: 'error',
          message: `Capability "${cap.id}" is missing a name.`,
          path: `manifest.capabilities[${i}].name`,
        });
      }
    });

    // Command handlers exist on the module.
    if (module) {
      for (const cmd of manifest.commands) {
        if (typeof (module as any)[cmd.handler] !== 'function') {
          findings.push({
            stage: 'capabilities',
            severity: 'error',
            message: `Command handler "${cmd.handler}" not found on module (command: ${cmd.commandType}).`,
            path: 'manifest.commands',
          });
        }
      }
      for (const evt of manifest.events) {
        if (typeof (module as any)[evt.handler] !== 'function') {
          findings.push({
            stage: 'capabilities',
            severity: 'error',
            message: `Event handler "${evt.handler}" not found on module (event: ${evt.eventType}).`,
            path: 'manifest.events',
          });
        }
      }
      for (const pol of manifest.policies) {
        if (typeof (module as any)[pol.enforce] !== 'function') {
          findings.push({
            stage: 'capabilities',
            severity: 'error',
            message: `Policy enforcement function "${pol.enforce}" not found on module (policy: ${pol.id}).`,
            path: 'manifest.policies',
          });
        }
      }
    }

    return findings;
  }

  // ── Full pipeline ───────────────────────────────────────────────────────

  /**
   * Run the full verification pipeline. Returns a `FullVerificationResult`
   * with per-stage breakdown + an aggregate status.
   *
   * If `module` is provided, runs the sandbox + capability-validation stages.
   * If not, those stages are skipped (status: 'info').
   *
   * `knownPlugins` is the list of already-published plugin slugs (for the
   * dependency check). Pass an empty array (the default) to skip the
   * dependency-resolver portion of the dependency stage.
   */
  async verify(
    manifest: PluginManifest,
    module?: PluginModule,
    knownPlugins: Array<{ slug: string; version: string }> = [],
  ): Promise<FullVerificationResult> {
    const start = Date.now();
    const stages: FullVerificationResult['stages'] = [];

    // Stage 1: Schema
    {
      const t0 = Date.now();
      const findings = this.runSchemaStage(manifest);
      stages.push({
        name: 'schema',
        status: this.aggregate(findings).status,
        findings,
        durationMs: Date.now() - t0,
      });
    }

    // Stage 2: Dependencies
    {
      const t0 = Date.now();
      const findings = this.runDependencyStage(manifest, knownPlugins);
      stages.push({
        name: 'dependencies',
        status: this.aggregate(findings).status,
        findings,
        durationMs: Date.now() - t0,
      });
    }

    // Stage 3: Permissions
    {
      const t0 = Date.now();
      const findings = this.runPermissionStage(manifest);
      stages.push({
        name: 'permissions',
        status: this.aggregate(findings).status,
        findings,
        durationMs: Date.now() - t0,
      });
    }

    // Stage 4: Security scan
    {
      const t0 = Date.now();
      const scan = this.securityScan(manifest);
      stages.push({
        name: 'security',
        status: scan.errors > 0 ? 'failed' : scan.warnings > 0 ? 'warning' : 'passed',
        findings: scan.findings,
        durationMs: Date.now() - t0,
      });
    }

    // Stage 5: Sandbox test
    {
      const t0 = Date.now();
      const test = await this.automatedTest(manifest, module);
      stages.push({
        name: 'sandbox',
        status: test.ok ? 'passed' : 'failed',
        findings: test.findings,
        durationMs: test.durationMs + (Date.now() - t0 - test.durationMs),
      });
    }

    // Stage 6: Capabilities
    {
      const t0 = Date.now();
      const findings = this.validateCapabilities(manifest, module);
      stages.push({
        name: 'capabilities',
        status: this.aggregate(findings).status,
        findings,
        durationMs: Date.now() - t0,
      });
    }

    // Aggregate.
    const allFindings = stages.flatMap((s) => s.findings);
    const { status, score } = this.aggregate(allFindings);

    return {
      status,
      findings: allFindings,
      score,
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      stages,
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────

  /** Stage 1: Schema validation. Returns findings (empty = clean). */
  private runSchemaStage(m: PluginManifest): VerificationFinding[] {
    const findings: VerificationFinding[] = [];

    if (!m || typeof m !== 'object') {
      findings.push({
        stage: 'schema',
        severity: 'error',
        message: 'Manifest must be an object.',
      });
      return findings;
    }
    if (typeof m.name !== 'string' || !m.name) {
      findings.push({
        stage: 'schema',
        severity: 'error',
        message: 'name must be a non-empty string.',
        path: 'manifest.name',
      });
    }
    if (typeof m.version !== 'string' || !SEMVER_RE.test(m.version)) {
      findings.push({
        stage: 'schema',
        severity: 'error',
        message: `version "${m.version}" is not valid semver (x.y.z).`,
        path: 'manifest.version',
      });
    }
    if (typeof m.description !== 'string' || !m.description) {
      findings.push({
        stage: 'schema',
        severity: 'error',
        message: 'description must be a non-empty string.',
        path: 'manifest.description',
      });
    }
    if (typeof m.author !== 'string' || !m.author) {
      findings.push({
        stage: 'schema',
        severity: 'error',
        message: 'author must be a non-empty string.',
        path: 'manifest.author',
      });
    }

    // Required arrays.
    const requiredArrays: Array<[keyof PluginManifest, string]> = [
      ['capabilities', 'capabilities'],
      ['permissions', 'permissions'],
      ['commands', 'commands'],
      ['events', 'events'],
      ['views', 'views'],
      ['policies', 'policies'],
      ['dependencies', 'dependencies'],
      ['migrations', 'migrations'],
    ];
    for (const [key, label] of requiredArrays) {
      if (!Array.isArray((m as any)[key])) {
        findings.push({
          stage: 'schema',
          severity: 'error',
          message: `${label} must be an array.`,
          path: `manifest.${key}`,
        });
      }
    }

    // Capability shape.
    if (Array.isArray(m.capabilities)) {
      m.capabilities.forEach((cap, i) => {
        if (!cap || typeof cap.id !== 'string' || !cap.id) {
          findings.push({
            stage: 'schema',
            severity: 'error',
            message: `capabilities[${i}].id must be a non-empty string.`,
            path: `manifest.capabilities[${i}].id`,
          });
        }
        if (typeof cap.name !== 'string' || !cap.name) {
          findings.push({
            stage: 'schema',
            severity: 'error',
            message: `capabilities[${i}].name must be a non-empty string.`,
            path: `manifest.capabilities[${i}].name`,
          });
        }
        if (typeof cap.type !== 'string') {
          findings.push({
            stage: 'schema',
            severity: 'error',
            message: `capabilities[${i}].type must be a string.`,
            path: `manifest.capabilities[${i}].type`,
          });
        }
      });
    }

    // Dependency versions.
    if (Array.isArray(m.dependencies)) {
      m.dependencies.forEach((dep, i) => {
        if (typeof dep.pluginName !== 'string' || !dep.pluginName) {
          findings.push({
            stage: 'schema',
            severity: 'error',
            message: `dependencies[${i}].pluginName must be a non-empty string.`,
            path: `manifest.dependencies[${i}].pluginName`,
          });
        }
        if (dep.minVersion && !SEMVER_RE.test(dep.minVersion)) {
          findings.push({
            stage: 'schema',
            severity: 'error',
            message: `dependencies[${i}].minVersion is not valid semver.`,
            path: `manifest.dependencies[${i}].minVersion`,
          });
        }
      });
    }

    // Migration versions.
    if (Array.isArray(m.migrations)) {
      m.migrations.forEach((mig, i) => {
        if (typeof mig.version !== 'string' || !SEMVER_RE.test(mig.version)) {
          findings.push({
            stage: 'schema',
            severity: 'error',
            message: `migrations[${i}].version is not valid semver.`,
            path: `manifest.migrations[${i}].version`,
          });
        }
        if (typeof mig.up !== 'string' || !mig.up) {
          findings.push({
            stage: 'schema',
            severity: 'error',
            message: `migrations[${i}].up must be a function name.`,
            path: `manifest.migrations[${i}].up`,
          });
        }
      });
    }

    // Runtime version constraints.
    if (m.minRuntimeVersion && !SEMVER_RE.test(m.minRuntimeVersion)) {
      findings.push({
        stage: 'schema',
        severity: 'warning',
        message: 'minRuntimeVersion is not valid semver.',
        path: 'manifest.minRuntimeVersion',
      });
    }
    if (m.maxRuntimeVersion && !SEMVER_RE.test(m.maxRuntimeVersion)) {
      findings.push({
        stage: 'schema',
        severity: 'warning',
        message: 'maxRuntimeVersion is not valid semver.',
        path: 'manifest.maxRuntimeVersion',
      });
    }

    return findings;
  }

  /** Stage 2: Dependency check. */
  private runDependencyStage(
    m: PluginManifest,
    knownPlugins: Array<{ slug: string; version: string }>,
  ): VerificationFinding[] {
    const findings: VerificationFinding[] = [];
    if (!Array.isArray(m.dependencies)) return findings;

    const knownMap = new Map(knownPlugins.map((p) => [p.slug, p.version]));
    for (const dep of m.dependencies) {
      const found = knownMap.get(dep.pluginName);
      if (!found) {
        findings.push({
          stage: 'dependencies',
          severity: 'error',
          message: `Dependency "${dep.pluginName}" is not published in the marketplace.`,
          path: 'manifest.dependencies',
        });
      } else if (dep.minVersion && !semverGte(found, dep.minVersion)) {
        findings.push({
          stage: 'dependencies',
          severity: 'error',
          message: `Dependency "${dep.pluginName}" published version ${found} is older than required ${dep.minVersion}.`,
          path: 'manifest.dependencies',
        });
      }
    }
    return findings;
  }

  /** Stage 3: Permission analysis. */
  private runPermissionStage(m: PluginManifest): VerificationFinding[] {
    const findings: VerificationFinding[] = [];
    const validPermissions = new Set<Permission>([
      'payments:read', 'payments:write',
      'payouts:read', 'payouts:write',
      'wallets:read', 'wallets:write',
      'customers:read', 'customers:write',
      'ledger:read', 'ledger:write',
      'treasury:read', 'treasury:write',
      'marketplace:read', 'marketplace:write',
      'compliance:read', 'compliance:write',
      'runtime:read', 'runtime:write',
      'events:read', 'events:write',
    ]);
    const seen = new Set<string>();
    for (const perm of m.permissions) {
      if (!validPermissions.has(perm)) {
        findings.push({
          stage: 'permissions',
          severity: 'error',
          message: `Unknown permission "${perm}".`,
          path: 'manifest.permissions',
        });
      }
      if (seen.has(perm)) {
        findings.push({
          stage: 'permissions',
          severity: 'warning',
          message: `Duplicate permission "${perm}".`,
          path: 'manifest.permissions',
        });
      }
      seen.add(perm);

      // Read without write is fine, but write without read is suspicious.
      const [resource, action] = perm.split(':');
      if (action === 'write' && !seen.has(`${resource}:read`)) {
        findings.push({
          stage: 'permissions',
          severity: 'info',
          message: `Permission "${perm}" is granted without "${resource}:read" — verify the plugin genuinely doesn't need read access.`,
          path: 'manifest.permissions',
        });
      }
    }
    return findings;
  }

  /**
   * Walk the manifest and collect every string field for pattern scanning.
   * Returns an array of { path, value } for each non-empty string.
   */
  private collectManifestStrings(m: PluginManifest): Array<{ path: string; value: string }> {
    const out: Array<{ path: string; value: string }> = [];
    const visit = (value: unknown, path: string) => {
      if (typeof value === 'string') {
        if (value.length > 0 && value.length < 4096) {
          out.push({ path, value });
        }
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => visit(v, `${path}[${i}]`));
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          visit(v, path ? `${path}.${k}` : k);
        }
      }
    };
    visit(m, 'manifest');
    return out;
  }

  /** Aggregate findings into a status + score. */
  private aggregate(findings: VerificationFinding[]): {
    status: VerificationStatus;
    score: number;
  } {
    const errors = findings.filter((f) => f.severity === 'error').length;
    const warnings = findings.filter((f) => f.severity === 'warning').length;
    const infos = findings.filter((f) => f.severity === 'info').length;
    if (errors > 0) {
      return { status: 'failed', score: Math.max(0, 60 - errors * 10 - warnings * 2) };
    }
    if (warnings > 0) {
      return {
        status: 'warning',
        score: Math.max(60, 90 - warnings * 5 - infos),
      };
    }
    return { status: 'passed', score: 100 };
  }
}

/** True when `version` >= `minVersion` (both must be semver x.y.z). */
function semverGte(version: string, minVersion: string): boolean {
  const a = parseSemver(version);
  const b = parseSemver(minVersion);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true; // equal
}

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Process-wide singleton. */
export const pluginVerifier = new PluginVerifier();
