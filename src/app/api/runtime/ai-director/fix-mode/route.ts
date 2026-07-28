import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { callLLM } from '@/lib/ai-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/runtime/ai-director/fix-mode
 *
 * AI Fix Mode (M-PLATFORM-38 spec) — the AI NEVER directly modifies runtime code.
 * Instead it generates a patch draft that the admin must approve before any
 * change is applied. This endpoint only GENERATES the draft; it does not write
 * any code.
 *
 * Body: {
 *   observation: string;        // admin's free-text concern, e.g. "corridor routing is too aggressive"
 *   scenarioResult?: SimulationResult;
 * }
 *
 * Returns: {
 *   ok: true,
 *   patch: {
 *     problem: string,
 *     currentBehavior: string,
 *     reason: string,
 *     suggestedFix: string,
 *     files: string[],
 *     tests: string[],
 *     expectedImpact: string,
 *   },
 *   llmPowered: boolean,
 * }
 *
 * The frontend can then send this draft to /escalate to file it as an Incident
 * (which acts as the "draft patch" store until a developer picks it up).
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  const body = await req.json().catch(() => ({} as any));
  const observation: string = (body?.observation ?? '').toString().trim();
  const scenarioResult: any | undefined = body?.scenarioResult;

  if (!observation) {
    return NextResponse.json(
      { ok: false, error: 'observation is required' },
      { status: 400 },
    );
  }

  // Compact scenario context (so the patch is grounded in the actual run).
  const scenarioSummary = scenarioResult
    ? buildCompactScenarioSummary(scenarioResult)
    : '(no scenario result attached)';

  const systemPrompt =
    'You are the PaySwap Runtime AI Director in Fix Mode. The admin has spotted a potential issue with the kernel\'s behaviour and wants you to draft a patch proposal — NOT to modify code, but to produce a structured improvement report that the engineering team can review and implement.\n\n' +
    'You NEVER write code changes. You NEVER claim to have applied anything. You ONLY produce a structured draft with: problem statement, current behaviour (what the kernel actually did in the attached scenario), reason (why this is a problem), suggested modification (high-level — no code), files that would need changing (paths only), tests that should be added/updated (names only), and expected impact.\n\n' +
    'Return STRICT JSON with this shape:\n' +
    '{\n' +
    '  "problem": "string — one-sentence problem statement",\n' +
    '  "currentBehavior": "string — 2-4 sentences describing what the kernel actually did in this run (cite specific decisions, amendments, frames)",\n' +
    '  "reason": "string — why this is a problem (cost, risk, correctness, user impact)",\n' +
    '  "suggestedFix": "string — 2-4 sentences describing the high-level modification (NO code)",\n' +
    '  "files": ["src/path/file.ts", ...] — 1-6 file paths that would need changing,\n' +
    '  "tests": ["test name or scenario name", ...] — 1-5 tests that should be added/updated,\n' +
    '  "expectedImpact": "string — what the fix accomplishes (cost reduction, risk reduction, correctness)"\n' +
    '}\n' +
    'Respond with ONLY the JSON object — no prose, no markdown fences.';

  const userPrompt =
    `Admin observation:\n${observation}\n\n` +
    `Attached scenario result:\n${scenarioSummary}\n\n` +
    `Draft a structured patch proposal. Be specific about what the kernel did in this run that prompted the observation. Suggest concrete (but code-free) modifications. List the most likely files in the PaySwap kernel/runtime that would need to change. List the tests that would prove the fix works.`;

  const llmText = await callLLM(systemPrompt, userPrompt);
  const parsed = llmText ? tryParseJsonObject(llmText) : null;

  if (parsed && typeof parsed.problem === 'string') {
    return NextResponse.json({
      ok: true,
      patch: {
        problem: String(parsed.problem).slice(0, 500),
        currentBehavior: String(parsed.currentBehavior ?? '').slice(0, 2000),
        reason: String(parsed.reason ?? '').slice(0, 1000),
        suggestedFix: String(parsed.suggestedFix ?? '').slice(0, 2000),
        files: Array.isArray(parsed.files)
          ? parsed.files.filter((f: unknown) => typeof f === 'string').slice(0, 12)
          : [],
        tests: Array.isArray(parsed.tests)
          ? parsed.tests.filter((t: unknown) => typeof t === 'string').slice(0, 12)
          : [],
        expectedImpact: String(parsed.expectedImpact ?? '').slice(0, 1000),
      },
      llmPowered: true,
    });
  }

  // ── Deterministic fallback patch (LLM unavailable) ──────────────────
  return NextResponse.json({
    ok: true,
    patch: computeFallbackPatch(observation, scenarioResult),
    llmPowered: false,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────

function buildCompactScenarioSummary(r: any): string {
  if (!r || typeof r !== 'object') return '(no scenario result attached)';
  const plan = r.plan ?? {};
  const metrics = plan.metrics ?? {};
  const reasoning = plan.reasoning ?? {};
  const amendments = Array.isArray(r.amendments) ? r.amendments : [];
  const constitution = r.constitution ?? {};

  const decisions = (reasoning.decisions ?? [])
    .map((d: any, i: number) => `${i + 1}. ${d.step}: ${d.rationale}`)
    .join('\n') || '(none)';

  const amendmentsText = amendments
    .slice(0, 4)
    .map(
      (a: any, i: number) =>
        `${i + 1}. triggeredBy=${a.triggeredBy?.label ?? a.triggeredBy?.type}; recovery=${a.recoveryStrategy}; atFrame=${a.insertedAtFrame}`,
    )
    .join('\n') || '(none)';

  return [
    `Scenario: ${r.scenario?.name ?? 'Untitled'}`,
    `Run: ${r.runId ?? '?'}, settled=${r.settled}, status=${plan.status ?? '?'}, strategy=${plan.strategy ?? '?'}`,
    `Cost: ${metrics.costPercent ?? '?'}%, risk: ${metrics.riskScore ?? '?'}, confidence: ${metrics.confidence ?? '?'}%, time: ${metrics.settlementTimeLabel ?? '?'}`,
    `Constitution: ${constitution.passed ? 'PASSED' : 'FAILED'} (${constitution.passedRules ?? '?'}/${constitution.totalRules ?? '?'} rules)`,
    `Amendments: ${amendments.length}`,
    '',
    'Decisions:',
    decisions,
    '',
    'Amendments:',
    amendmentsText,
  ].join('\n');
}

function tryParseJsonObject(text: string): any | null {
  const tryParse = (snippet: string): any | null => {
    try {
      const parsed = JSON.parse(snippet);
      return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(text.trim());
  if (direct) return direct;
  const fenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const stripped = tryParse(fenced);
  if (stripped) return stripped;
  const match = fenced.match(/\{[\s\S]*\}/);
  if (match) {
    const extracted = tryParse(match[0]);
    if (extracted) return extracted;
  }
  return null;
}

function computeFallbackPatch(observation: string, scenarioResult: any): {
  problem: string;
  currentBehavior: string;
  reason: string;
  suggestedFix: string;
  files: string[];
  tests: string[];
  expectedImpact: string;
} {
  const plan = scenarioResult?.plan ?? {};
  const metrics = plan.metrics ?? {};
  const amendments = Array.isArray(scenarioResult?.amendments) ? scenarioResult.amendments : [];
  const constitution = scenarioResult?.constitution ?? {};

  const obs = observation.toLowerCase();
  let problem = `Admin observation: ${observation}`;
  let currentBehavior = `In the attached run, the kernel chose strategy "${plan.strategy ?? 'unknown'}" with cost ${metrics.costPercent ?? '?'}%, risk ${metrics.riskScore ?? '?'}, and confidence ${metrics.confidence ?? '?'}%. ${amendments.length} amendment(s) occurred. Constitution ${constitution.passed ? 'passed' : 'FAILED'}.`;
  let reason = 'The admin flagged this behaviour as suboptimal and wants a structured patch proposal for engineering review.';
  let suggestedFix = 'Engineering should review the planner weights and constraint solver configuration. The admin observation should drive the specific change — see the AI Reasoning tab for the planner\'s objective scores and the Solver tab for ranked alternatives.';
  let expectedImpact = 'Improved planner behaviour on similar scenarios, lower cost or risk, and clearer audit trail for routing decisions.';

  const files: string[] = [];
  const tests: string[] = [];

  if (obs.includes('aggressive') || obs.includes('corridor') || obs.includes('routing')) {
    problem = `Corridor routing is too aggressive: ${observation}`;
    currentBehavior = `The planner selected strategy "${plan.strategy ?? 'unknown'}" for this corridor, which the admin observes is too aggressive. Cost was ${metrics.costPercent ?? '?'}%, risk ${metrics.riskScore ?? '?'}. The current AI weights may be over-prioritising speed or cost at the expense of safety.`;
    reason = 'Aggressive routing can lead to settlement failures or reserve depletion under stress, especially in thin corridors.';
    suggestedFix = 'Re-tune the AI weights (cost/speed/risk/confidence) for this corridor — increase the risk weight and reduce the cost weight. Add a corridor-specific override so that aggressive strategies are only chosen when reserve coverage is above a higher threshold.';
    files.push('src/kernel/planner.ts', 'src/kernel/support.ts (PRIORITY_WEIGHTS)');
    tests.push('corridor-aggression-regression.scenario', 'planner-weights-priority-rank.test');
    expectedImpact = 'Lower risk score on the same corridor without materially increasing cost; fewer amendments during execution.';
  } else if (obs.includes('cost') || obs.includes('fee') || obs.includes('expensive')) {
    problem = `Cost is too high: ${observation}`;
    currentBehavior = `This run cost ${metrics.costPercent ?? '?'}% in fees. The planner ranked it highest despite cheaper alternatives existing (see Solver tab).`;
    reason = 'High fees erode merchant margin and make the corridor uncompetitive.';
    suggestedFix = 'Increase the cost weight in the planner for this corridor, or add a hard cost ceiling that blocks plans above a threshold. Inspect the LP fee table to see if any LPs are charging above-market rates.';
    files.push('src/kernel/planner.ts', 'src/kernel/support.ts (PRIORITY_WEIGHTS)');
    tests.push('cost-ceiling-block.test', 'planner-cost-priority.test');
    expectedImpact = 'Measurable cost reduction on this corridor with no increase in risk or settlement time.';
  } else if (obs.includes('rollback') || obs.includes('amendment') || obs.includes('recover')) {
    problem = `Excessive rollbacks / amendments: ${observation}`;
    currentBehavior = `This run had ${amendments.length} amendment(s). The first was triggered by "${amendments[0]?.triggeredBy?.label ?? 'unknown failure'}" with recovery strategy "${amendments[0]?.recoveryStrategy ?? 'unknown'}".`;
    reason = 'Frequent amendments indicate the planner is choosing plans that are not robust to real-world conditions, increasing operational overhead.';
    suggestedFix = 'Add a pre-flight feasibility check that rejects plans with high amendment probability. Increase the confidence threshold for autonomous settlement on this corridor. Backfill the LP evidence store with fresher attestations.';
    files.push('src/kernel/execution-graph.ts', 'src/kernel/transition.ts');
    tests.push('amendment-rate-regression.test', 'feasibility-precheck.test');
    expectedImpact = 'Lower amendment rate, fewer manual interventions, more deterministic settlement.';
  } else if (obs.includes('invariant') || obs.includes('constitution')) {
    problem = `Invariant / constitution failure: ${observation}`;
    currentBehavior = `Constitution ${constitution.passed ? 'passed' : 'FAILED'} (${constitution.passedRules ?? '?'}/${constitution.totalRules ?? '?'} rules).`;
    reason = 'A failed invariant is a correctness bug — the kernel should never produce a state that violates its own constitution.';
    suggestedFix = 'Identify the specific invariant that failed (see Constitution tab), then trace back through the planner and executor to find which step produced the invalid state. Add a stronger precondition check at that step.';
    files.push('src/kernel/types.ts (ConstitutionCheck)', 'src/kernel/world-store.ts');
    tests.push('constitution-violation-repro.test', 'invariant-precondition.test');
    expectedImpact = 'Constitution passes consistently; no invariant violations on this scenario family.';
  } else {
    files.push('src/kernel/planner.ts');
    tests.push('admin-observation-repro.test');
  }

  return {
    problem,
    currentBehavior,
    reason,
    suggestedFix,
    files,
    tests,
    expectedImpact,
  };
}
