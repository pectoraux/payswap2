/**
 * Economic Knowledge Graph — The Economic DSL.
 *
 * PHASE 4: An Economic Domain-Specific Language. Developers don't write payment
 * flows — they declare goals. The DSL compiler translates goal declarations
 * into Goal objects the planner can prove().
 *
 * Syntax (YAML-like, line-based):
 *
 *   goal EnrollStudent
 *     requires
 *       identity.verified
 *       payment.completed
 *     produces
 *       education.enrollment
 *     constraints
 *       budget < 1000
 *       jurisdiction = GH
 *       deadline < 2h
 *
 * The compiler:
 *   1. Parses the DSL into an AST.
 *   2. Validates it against the graph (do the required/produced assets exist?).
 *   3. Resolves asset names to graph node ids.
 *   4. Compiles to a Goal object.
 *   5. The planner can then prove(goal) → Proof[].
 *
 * This becomes the programming language of the platform.
 */

import { uid } from '@/runtime/types';
import { ekg } from './graph';
import type { Goal, Constraints } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// DSL AST
// ═══════════════════════════════════════════════════════════════════════════

export interface DSLGoal {
  name: string;
  description?: string;
  category?: string;
  requires: string[];          // asset names
  produces: string;            // target asset name
  inputs: Record<string, number>;  // asset name → amount
  constraints: DSLConstraint[];
}

export interface DSLConstraint {
  field: 'budget' | 'deadline' | 'minTrust' | 'maxCarbon' | 'jurisdiction' | 'maxRisk';
  operator: '<' | '<=' | '=' | '>=' | '>';
  value: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSER — parses DSL text into an AST
// ═══════════════════════════════════════════════════════════════════════════

export interface ParseResult {
  goal: DSLGoal | null;
  errors: string[];
  warnings: string[];
}

export function parseDSL(source: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines = source.split('\n').map((l) => l.replace(/\r$/, ''));

  let goal: Partial<DSLGoal> = { requires: [], inputs: {}, constraints: [] };
  let currentSection: 'requires' | 'produces' | 'inputs' | 'constraints' | null = null;
  let foundGoal = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = raw.length - raw.trimStart().length;

    // Top-level: goal declaration
    if (indent === 0 && trimmed.startsWith('goal ')) {
      if (foundGoal) {
        errors.push(`Line ${lineNum}: multiple goal declarations — only one goal per DSL block`);
        break;
      }
      const name = trimmed.slice(5).trim();
      if (!name) { errors.push(`Line ${lineNum}: goal name is empty`); continue; }
      goal.name = name;
      foundGoal = true;
      currentSection = null;
      continue;
    }

    // Description + category (can be at any indent under the goal)
    if (trimmed.startsWith('description ')) {
      goal.description = trimmed.slice(12).trim();
      continue;
    }
    if (trimmed.startsWith('category ')) {
      goal.category = trimmed.slice(9).trim();
      continue;
    }

    // Section headers (indented under goal)
    if (trimmed === 'requires' || trimmed === 'produces' || trimmed === 'inputs' || trimmed === 'constraints') {
      currentSection = trimmed as 'requires' | 'produces' | 'inputs' | 'constraints';
      continue;
    }

    // Section content
    if (!foundGoal) {
      errors.push(`Line ${lineNum}: content before goal declaration`);
      continue;
    }

    if (currentSection === 'requires') {
      goal.requires!.push(trimmed);
    } else if (currentSection === 'produces') {
      if (goal.produces) warnings.push(`Line ${lineNum}: multiple produces — using the last one`);
      goal.produces = trimmed;
    } else if (currentSection === 'inputs') {
      // Format: assetName amount
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const asset = parts[0];
        const amount = parseFloat(parts[1]);
        if (Number.isNaN(amount)) errors.push(`Line ${lineNum}: invalid input amount "${parts[1]}"`);
        else goal.inputs![asset] = amount;
      } else {
        goal.inputs![trimmed] = 1; // default amount
      }
    } else if (currentSection === 'constraints') {
      // Format: field operator value
      const match = trimmed.match(/^(\w+)\s*(<|<=|=|>=|>)\s*(.+)$/);
      if (!match) {
        errors.push(`Line ${lineNum}: invalid constraint "${trimmed}" — expected "field op value"`);
        continue;
      }
      const [, field, operator, value] = match;
      const validFields = ['budget', 'deadline', 'minTrust', 'maxCarbon', 'jurisdiction', 'maxRisk'];
      if (!validFields.includes(field)) {
        errors.push(`Line ${lineNum}: unknown constraint field "${field}" — valid: ${validFields.join(', ')}`);
        continue;
      }
      goal.constraints!.push({ field: field as DSLConstraint['field'], operator: operator as DSLConstraint['operator'], value: value.trim() });
    } else {
      errors.push(`Line ${lineNum}: content outside any section — indent under requires/produces/inputs/constraints`);
    }
  }

  if (!foundGoal) {
    errors.push('No goal declaration found — DSL must start with "goal Name"');
    return { goal: null, errors, warnings };
  }

  if (!goal.produces) {
    errors.push('Goal has no "produces" section — the target asset is required');
    return { goal: null, errors, warnings };
  }

  return { goal: goal as DSLGoal, errors, warnings };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPILER — validates the AST against the graph + compiles to a Goal
// ═══════════════════════════════════════════════════════════════════════════

export interface CompileResult {
  goal: Goal | null;
  errors: string[];
  warnings: string[];
  /** The resolved asset node ids (for debugging). */
  resolvedAssets: { name: string; nodeId: string | null }[];
}

/**
 * Compile a DSL goal into a Goal object the planner can prove().
 * Validates that all referenced assets exist in the graph.
 */
export function compileGoal(dsl: DSLGoal): CompileResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const resolvedAssets: { name: string; nodeId: string | null }[] = [];

  // Build a name → nodeId lookup from the graph's ASSET nodes
  const assetNodes = ekg.listNodes({ kind: 'ASSET' });
  const nameToId = new Map<string, string>();
  for (const node of assetNodes) {
    nameToId.set(node.label.toLowerCase().replace(/\s+/g, '_'), node.id);
    // Also map by stableId if present
    const stableId = node.properties.stableId as string | undefined;
    if (stableId) nameToId.set(stableId, node.id);
    nameToId.set(node.id, node.id); // direct id
  }

  const resolveAsset = (name: string): string | null => {
    const normalized = name.toLowerCase().replace(/\s+/g, '_');
    // Try direct match
    if (nameToId.has(name)) return nameToId.get(name)!;
    if (nameToId.has(normalized)) return nameToId.get(normalized)!;
    // Try partial match on stableId (e.g. "identity.verified" → matches "asset.identity")
    const parts = normalized.split('.');
    for (const part of parts) {
      for (const [key, id] of nameToId) {
        if (key.includes(part) && part.length > 2) return id;
      }
    }
    // Try label-based match (e.g. "Verified Identity" → matches)
    for (const [key, id] of nameToId) {
      if (key.includes(normalized) || normalized.includes(key)) return id;
    }
    return null;
  };

  // Resolve requires
  const resolvedRequires: string[] = [];
  for (const req of dsl.requires) {
    const id = resolveAsset(req);
    resolvedAssets.push({ name: req, nodeId: id });
    if (id) resolvedRequires.push(id);
    else errors.push(`Required asset "${req}" not found in the graph`);
  }

  // Resolve produces (target)
  const targetId = resolveAsset(dsl.produces);
  resolvedAssets.push({ name: dsl.produces, nodeId: targetId });
  if (!targetId) errors.push(`Target asset "${dsl.produces}" not found in the graph`);

  // Resolve inputs
  const resolvedInputs: Record<string, number> = {};
  for (const [name, amount] of Object.entries(dsl.inputs)) {
    const id = resolveAsset(name);
    resolvedAssets.push({ name, nodeId: id });
    if (id) resolvedInputs[id] = amount;
    else errors.push(`Input asset "${name}" not found in the graph`);
  }

  // Compile constraints
  const constraints: Constraints = {};
  for (const c of dsl.constraints) {
    const numValue = parseFloat(c.value);
    switch (c.field) {
      case 'budget':
        if (Number.isNaN(numValue)) errors.push(`Constraint budget: invalid number "${c.value}"`);
        else constraints.budget = numValue;
        break;
      case 'deadline':
        // Parse "2h" / "30m" / "60s" / "5000" (ms)
        if (c.value.endsWith('h')) constraints.deadline = parseFloat(c.value) * 3600000;
        else if (c.value.endsWith('m')) constraints.deadline = parseFloat(c.value) * 60000;
        else if (c.value.endsWith('s')) constraints.deadline = parseFloat(c.value) * 1000;
        else constraints.deadline = numValue;
        break;
      case 'minTrust':
        if (Number.isNaN(numValue)) errors.push(`Constraint minTrust: invalid number "${c.value}"`);
        else constraints.minTrust = numValue;
        break;
      case 'maxCarbon':
        if (Number.isNaN(numValue)) errors.push(`Constraint maxCarbon: invalid number "${c.value}"`);
        else constraints.maxCarbon = numValue;
        break;
      case 'jurisdiction':
        // Resolve jurisdiction name to node id
        const jurisNodes = ekg.listNodes({ kind: 'JURISDICTION' });
        const juris = jurisNodes.find((j) => j.label.toLowerCase() === c.value.toLowerCase() || j.properties.code === c.value.toUpperCase());
        if (juris) constraints.jurisdiction = juris.id;
        else warnings.push(`Jurisdiction "${c.value}" not found — constraint ignored`);
        break;
      case 'maxRisk':
        if (Number.isNaN(numValue)) errors.push(`Constraint maxRisk: invalid number "${c.value}"`);
        else constraints.maxRisk = numValue;
        break;
    }
  }

  if (errors.length > 0) return { goal: null, errors, warnings, resolvedAssets };

  // Compile to Goal
  const goal: Goal = {
    id: uid('goal'),
    name: dsl.name,
    description: dsl.description ?? `DSL-compiled goal: ${dsl.name}`,
    category: dsl.category ?? 'general',
    targetAsset: targetId!,
    inputs: resolvedInputs,
    constraints,
    createdAt: Date.now(),
  };

  return { goal, errors, warnings, resolvedAssets };
}

/**
 * Full compile pipeline: parse DSL text → compile to Goal.
 */
export function compileDSL(source: string): { goal: Goal | null; parseErrors: string[]; compileErrors: string[]; warnings: string[]; resolvedAssets: { name: string; nodeId: string | null }[] } {
  const parse = parseDSL(source);
  if (parse.errors.length > 0 || !parse.goal) {
    return { goal: null, parseErrors: parse.errors, compileErrors: [], warnings: parse.warnings, resolvedAssets: [] };
  }
  const compile = compileGoal(parse.goal);
  return {
    goal: compile.goal,
    parseErrors: [],
    compileErrors: compile.errors,
    warnings: [...parse.warnings, ...compile.warnings],
    resolvedAssets: compile.resolvedAssets,
  };
}
