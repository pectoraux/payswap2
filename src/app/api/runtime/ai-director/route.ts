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
 * POST /api/runtime/ai-director
 *
 * Body: {
 *   question: string;
 *   scenarioResult?: SimulationResult;   // last run scenario result, page-aware
 *   scenarioId?: string;                  // optional run id (for context label only)
 * }
 *
 * Returns: {
 *   ok: true,
 *   answer: string,                       // 2-4 paragraph answer grounded in scenarioResult
 *   reasoning: string[],                  // bullet list of supporting evidence (numbers, decisions)
 *   suggestedActions: string[],           // 0-3 actionable next steps
 *   escalate: boolean,                    // true if the AI thinks this is a real production risk
 *   citations: { frame?: number, field?: string, snippet: string }[],
 *   scenarioName?: string,
 *   runId?: string,
 *   llmPowered: boolean,
 * }
 *
 * Page-aware: the runtime page passes the most recent `SimulationResult` so the
 * LLM can answer "Why did this route use MARKET_TO_RESERVE?", "What caused the
 * rollback?", "Which invariant failed?" — using the actual decisions, ledger,
 * events, amendments and constitution verdict of that run, not generic prose.
 *
 * Falls back to a deterministic local answer (mirroring the pattern in
 * `runtime/platform/engine.ts:askAI`) when the LLM is unavailable.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  const body = await req.json().catch(() => ({} as any));
  const question: string = (body?.question ?? '').toString().trim();
  const scenarioResult: any | undefined = body?.scenarioResult;
  const scenarioId: string | undefined = body?.scenarioId;

  if (!question) {
    return NextResponse.json(
      { ok: false, error: 'question is required' },
      { status: 400 },
    );
  }

  // Build a compact context summary of the scenario result so the LLM has the
  // actual data points to answer questions like "which invariant failed?".
  const ctx = scenarioResult ? buildScenarioContext(scenarioResult) : null;

  if (!ctx) {
    return NextResponse.json({
      ok: true,
      answer:
        'No scenario result is available yet. Run a simulation first, then ask me about specific decisions, ledger entries, events, amendments, or invariant failures from that run.',
      reasoning: [],
      suggestedActions: [
        'Click "Run Simulation" on the left to execute a scenario through the kernel.',
        'Then ask me things like "Why did this route use MARKET_TO_RESERVE?" or "What caused the rollback?"',
      ],
      escalate: false,
      citations: [],
      llmPowered: false,
    });
  }

  // ── Build prompts ───────────────────────────────────────────────────
  const systemPrompt =
    'You are the PaySwap Runtime AI Director. You are an expert payments engineer with deep knowledge of the PaySwap kernel — the planner, executor, ledger, twin tokens, treasury, council, constitution, and 7-primitive protocol.\n\n' +
    'The user has just run a simulation scenario. You have the FULL result (timeline, ledger, events, decisions, amendments, constitution verdict, twin tokens, treasury recommendations). Answer their question using the ACTUAL data from this run — do NOT give generic answers.\n\n' +
    'Be specific and technical. Cite frame numbers, account IDs, event types, invariant names, amendment strategies. 2-4 short paragraphs. Plain prose, no markdown fences.\n\n' +
    'Return STRICT JSON with this shape:\n' +
    '{\n' +
    '  "answer": "string — 2-4 paragraph plain-prose answer grounded in the scenario data",\n' +
    '  "reasoning": ["string", ...] — 2-6 supporting evidence bullets (specific numbers, frame refs, decision steps),\n' +
    '  "suggestedActions": ["string", ...] — 0-3 concrete next steps the admin should take,\n' +
    '  "escalate": boolean — true if this looks like a real production risk (invariant violation, rollback, settlement failure, fraud) that warrants filing an incident,\n' +
    '  "citations": [{ "frame"?: number, "field"?: string, "snippet": string }, ...] — 0-5 specific data points the admin can verify in the UI\n' +
    '}\n' +
    'Respond with ONLY the JSON object — no prose, no markdown fences.';

  const userPrompt =
    `Scenario: ${ctx.scenarioName}\n` +
    `Run ID: ${ctx.runId}\n` +
    `Settled: ${ctx.settled}  ·  Status: ${ctx.status}  ·  Strategy: ${ctx.strategy}\n` +
    `Cost: ${ctx.costPercent}% (${ctx.totalFees} ${ctx.currency})  ·  Settlement: ${ctx.settlementTimeLabel} (${ctx.settlementTimeMs}ms)  ·  Risk: ${ctx.riskScore} (${ctx.riskLabel})  ·  Confidence: ${ctx.confidence}%\n\n` +
    `Constitution: ${ctx.constitutionPassed ? 'PASSED' : 'FAILED'} (${ctx.constitutionPassedRules}/${ctx.constitutionTotalRules} rules)\n` +
    `Amendments: ${ctx.amendments.length}  ·  Insurance claims: ${ctx.insuranceClaims.length}  ·  Twin tokens: ${ctx.twinTokens.length}  ·  Events: ${ctx.events.length}  ·  Ledger entries: ${ctx.ledger.length}\n\n` +
    `── Decisions ──\n${ctx.decisions}\n\n` +
    `── Amendments (rollback/recovery) ──\n${ctx.amendmentsText}\n\n` +
    `── Invariant violations ──\n${ctx.invariantViolations}\n\n` +
    `── Ledger entries (first 12) ──\n${ctx.ledgerText}\n\n` +
    `── Events (first 20) ──\n${ctx.eventsText}\n\n` +
    `── Twin tokens ──\n${ctx.twinTokensText}\n\n` +
    `── Treasury recommendations ──\n${ctx.treasuryText}\n\n` +
    `── Objective scores ──\n${ctx.objectiveScores}\n\n` +
    `── Alternatives (next-best plans) ──\n${ctx.alternatives}\n\n` +
    `── User question ──\n${question}\n\n` +
    `Answer the user's question using ONLY the data above. If the answer requires info not present in this run, say so explicitly. If the question is about a potential production risk (invariant failed, rollback, settlement failure), set escalate=true.`;

  const llmText = await callLLM(systemPrompt, userPrompt);
  const parsed = llmText ? tryParseJsonObject(llmText) : null;

  if (parsed && typeof parsed.answer === 'string') {
    return NextResponse.json({
      ok: true,
      answer: parsed.answer,
      reasoning: Array.isArray(parsed.reasoning) ? parsed.reasoning.filter((r: unknown) => typeof r === 'string').slice(0, 8) : [],
      suggestedActions: Array.isArray(parsed.suggestedActions)
        ? parsed.suggestedActions.filter((r: unknown) => typeof r === 'string').slice(0, 5)
        : [],
      escalate: typeof parsed.escalate === 'boolean' ? parsed.escalate : false,
      citations: Array.isArray(parsed.citations) ? parsed.citations.slice(0, 6) : [],
      scenarioName: ctx.scenarioName,
      runId: ctx.runId,
      scenarioId,
      llmPowered: true,
    });
  }

  // ── Deterministic fallback (LLM unavailable) ────────────────────────
  const fallback = computeFallbackAnswer(question, ctx);
  return NextResponse.json({
    ok: true,
    ...fallback,
    scenarioName: ctx.scenarioName,
    runId: ctx.runId,
    scenarioId,
    llmPowered: false,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────

interface ScenarioContext {
  scenarioName: string;
  runId: string;
  settled: boolean;
  status: string;
  strategy: string;
  costPercent: number;
  totalFees: number;
  currency: string;
  settlementTimeLabel: string;
  settlementTimeMs: number;
  riskScore: number;
  riskLabel: string;
  confidence: number;
  constitutionPassed: boolean;
  constitutionPassedRules: number;
  constitutionTotalRules: number;
  amendments: any[];
  insuranceClaims: any[];
  twinTokens: any[];
  events: any[];
  ledger: any[];
  decisions: string;
  amendmentsText: string;
  invariantViolations: string;
  ledgerText: string;
  eventsText: string;
  twinTokensText: string;
  treasuryText: string;
  objectiveScores: string;
  alternatives: string;
}

/**
 * Reduce a full SimulationResult (which can be 50KB+) into a compact, LLM-friendly
 * text context. We keep the high-signal fields (decisions, amendments, invariant
 * violations, top ledger entries, top events) and drop raw payloads.
 */
function buildScenarioContext(r: any): ScenarioContext | null {
  if (!r || typeof r !== 'object') return null;
  const plan = r.plan ?? {};
  const metrics = plan.metrics ?? {};
  const reasoning = plan.reasoning ?? {};
  const constitution = r.constitution ?? {};
  const amendments = Array.isArray(r.amendments) ? r.amendments : [];
  const insuranceClaims = Array.isArray(r.insuranceClaims) ? r.insuranceClaims : [];
  const twinTokens = Array.isArray(r.twinTokens) ? r.twinTokens : [];
  const events = Array.isArray(r.events) ? r.events : [];
  const ledger = Array.isArray(r.ledger) ? r.ledger : [];
  const treasuryRecs = Array.isArray(r.treasuryRecommendations) ? r.treasuryRecommendations : [];

  const scenarioName: string = r.scenario?.name ?? 'Untitled scenario';
  const currency: string = r.scenario?.transaction?.currency ?? 'USD';

  const decisions = (reasoning.decisions ?? [])
    .map((d: any, i: number) => `${i + 1}. ${d.step}: ${d.rationale}`)
    .join('\n') || '(no decisions recorded)';

  const amendmentsText = amendments
    .map(
      (a: any, i: number) =>
        `${i + 1}. triggeredBy=${a.triggeredBy?.label ?? a.triggeredBy?.type ?? 'unknown'}; reason=${a.reason}; recoveryStrategy=${a.recoveryStrategy}; insertedAtFrame=${a.insertedAtFrame}; steps=${a.steps?.length ?? 0}`,
    )
    .join('\n') || '(no amendments — no rollback/recovery occurred)';

  const invariantViolations = constitution.violations?.length
    ? constitution.violations
        .map(
          (v: any, i: number) =>
            `${i + 1}. section=${v.section}; invariant=${v.invariant}; severity=${v.severity}; detail=${v.detail}`,
        )
        .join('\n')
    : constitution.passed
      ? '(no invariant violations — all rules passed)'
      : '(constitution failed but no specific violations listed)';

  const ledgerText = ledger
    .slice(0, 12)
    .map(
      (e: any, i: number) =>
        `${i + 1}. f${e.frame ?? '?'} ${e.accountLabel} [${e.accountType}/${e.accountId}] DR=${e.debit ?? 0} CR=${e.credit ?? 0} bal=${e.balanceAfter} memo="${e.memo ?? ''}"`,
    )
    .join('\n') || '(no ledger entries)';

  const eventsText = events
    .slice(0, 20)
    .map((e: any, i: number) => `${i + 1}. f${e.frame ?? '?'} ${e.type} ts=${e.ts ?? '?'}`)
    .join('\n') || '(no events emitted)';

  const twinTokensText = twinTokens
    .map(
      (t: any, i: number) =>
        `${i + 1}. ${t.symbol} amount=${t.amount} ${t.currency} ${t.fromCountry}→${t.toCountry} status=${t.status} mintedAtFrame=${t.mintedAtFrame ?? '?'} burnedAtFrame=${t.burnedAtFrame ?? '?'}`,
    )
    .join('\n') || '(no twin tokens minted)';

  const treasuryText = treasuryRecs
    .slice(0, 6)
    .map(
      (t: any, i: number) =>
        `${i + 1}. ${t.action ?? t.type ?? 'recommendation'}: ${t.reason ?? t.rationale ?? ''} priority=${t.priority ?? 'medium'}`,
    )
    .join('\n') || '(no treasury recommendations)';

  const objectiveScores = (reasoning.objectiveScores ?? [])
    .map((s: any) => `${s.objective}=${s.score} (${s.rationale})`)
    .join('; ') || '(no objective scores)';

  const alternatives = (plan.alternatives ?? [])
    .slice(0, 4)
    .map(
      (a: any, i: number) =>
        `${i + 1}. ${a.description ?? a.label ?? '?'} cost=${a.costPercent ?? a.cost ?? '?'}% time=${a.settlementTimeMs ?? '?'}ms risk=${a.riskScore ?? '?'}`,
    )
    .join('\n') || '(no alternatives ranked)';

  return {
    scenarioName,
    runId: r.runId ?? 'unknown',
    settled: !!r.settled,
    status: plan.status ?? 'unknown',
    strategy: plan.strategy ?? reasoning.strategy ?? 'unknown',
    costPercent: metrics.costPercent ?? 0,
    totalFees: metrics.totalFees ?? 0,
    currency,
    settlementTimeLabel: metrics.settlementTimeLabel ?? 'unknown',
    settlementTimeMs: metrics.settlementTimeMs ?? 0,
    riskScore: metrics.riskScore ?? 0,
    riskLabel: metrics.riskLabel ?? 'unknown',
    confidence: metrics.confidence ?? 0,
    constitutionPassed: !!constitution.passed,
    constitutionPassedRules: constitution.passedRules ?? 0,
    constitutionTotalRules: constitution.totalRules ?? 0,
    amendments,
    insuranceClaims,
    twinTokens,
    events,
    ledger,
    decisions,
    amendmentsText,
    invariantViolations,
    ledgerText,
    eventsText,
    twinTokensText,
    treasuryText,
    objectiveScores,
    alternatives,
  };
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

/**
 * Deterministic fallback answers for the most common admin questions, mirroring
 * the pattern in `src/runtime/platform/engine.ts:askAI()`. Used when the LLM is
 * unavailable so the AI Director still returns a useful, data-grounded answer.
 */
function computeFallbackAnswer(question: string, ctx: ScenarioContext): {
  answer: string;
  reasoning: string[];
  suggestedActions: string[];
  escalate: boolean;
  citations: any[];
} {
  const q = question.toLowerCase();

  // Why did this route use strategy X?
  const strategyMatch = ctx.strategy && q.includes(ctx.strategy.toLowerCase());
  if (q.includes('why') && q.includes('route')) {
    return {
      answer: `This run used the "${ctx.strategy}" strategy. The planner's recorded decisions for this scenario are listed below — they explain the trade-offs that led to this route. ${
        ctx.amendments.length > 0
          ? `Note: the executor had to make ${ctx.amendments.length} amendment(s) during execution (rollback/recovery), which means the original plan was altered at runtime.`
          : 'No plan amendments occurred — the plan executed as designed.'
      }`,
      reasoning: [
        `Strategy: ${ctx.strategy}`,
        `Cost: ${ctx.costPercent}% (${ctx.totalFees} ${ctx.currency})`,
        `Risk: ${ctx.riskScore} (${ctx.riskLabel})`,
        `Confidence: ${ctx.confidence}%`,
        `Decisions recorded: see AI Reasoning tab`,
      ],
      suggestedActions:
        ctx.amendments.length > 0
          ? ['Open the Execution tab and inspect each amendment to see what triggered the recovery.']
          : ['Open the AI Reasoning tab to see the planner\'s objective scores and trade-offs.'],
      escalate: ctx.amendments.length > 0,
      citations: [{ field: 'plan.strategy', snippet: ctx.strategy }],
    };
  }

  if (strategyMatch) {
    return {
      answer: `The planner chose "${ctx.strategy}" because it scored highest on the priority objective for this scenario (see AI Reasoning tab). Cost was ${ctx.costPercent}%, settlement time was ${ctx.settlementTimeLabel}, risk was ${ctx.riskScore} (${ctx.riskLabel}), and planner confidence was ${ctx.confidence}%.`,
      reasoning: [
        `Strategy: ${ctx.strategy}`,
        `Cost: ${ctx.costPercent}%, time: ${ctx.settlementTimeLabel}, risk: ${ctx.riskScore}`,
        `Confidence: ${ctx.confidence}%`,
      ],
      suggestedActions: ['Compare with alternatives in the Solver tab to see why other plans ranked lower.'],
      escalate: false,
      citations: [{ field: 'plan.metrics', snippet: `cost=${ctx.costPercent}% risk=${ctx.riskScore} conf=${ctx.confidence}%` }],
    };
  }

  // What caused the rollback?
  if (q.includes('rollback') || q.includes('amendment') || q.includes('recovery')) {
    if (ctx.amendments.length === 0) {
      return {
        answer: `No rollback occurred in this run. The plan executed as designed — 0 amendments were inserted. Status is "${ctx.status}" and settled=${ctx.settled}.`,
        reasoning: [`Amendments: 0`, `Status: ${ctx.status}`, `Settled: ${ctx.settled}`],
        suggestedActions: [],
        escalate: false,
        citations: [{ field: 'amendments', snippet: '[]' }],
      };
    }
    return {
      answer: `${ctx.amendments.length} amendment(s) were inserted during execution, which means the executor detected a failure mid-flight and switched to a recovery strategy. The first amendment was triggered by "${ctx.amendments[0]?.triggeredBy?.label ?? 'an unknown failure'}" and used the "${ctx.amendments[0]?.recoveryStrategy}" recovery strategy. See the Execution tab > Plan Amendments for the full timeline.`,
      reasoning: ctx.amendments.slice(0, 4).map(
        (a: any, i: number) =>
          `Amendment ${i + 1}: triggeredBy=${a.triggeredBy?.label ?? a.triggeredBy?.type}; recovery=${a.recoveryStrategy}; atFrame=${a.insertedAtFrame}; reason=${a.reason}`,
      ),
      suggestedActions: [
        'Inspect each amendment in the Execution tab to see what step the executor took to recover.',
        'If this is a recurring failure pattern, consider filing an incident.',
      ],
      escalate: true,
      citations: ctx.amendments.slice(0, 3).map((a: any, i: number) => ({
        frame: a.insertedAtFrame,
        field: `amendments[${i}]`,
        snippet: `${a.triggeredBy?.label ?? a.triggeredBy?.type} → ${a.recoveryStrategy}`,
      })),
    };
  }

  // Which invariant failed?
  if (q.includes('invariant') || q.includes('constitution')) {
    return {
      answer: ctx.constitutionPassed
        ? `All ${ctx.constitutionTotalRules} constitutional invariants PASSED for this run. No invariant failed.`
        : `Constitution FAILED: ${ctx.constitutionPassedRules}/${ctx.constitutionTotalRules} rules passed. See the violations listed in the Constitution tab — each violation has a section, invariant name, severity (block/warn), and detail.`,
      reasoning: [
        `Constitution passed: ${ctx.constitutionPassed}`,
        `Rules passed: ${ctx.constitutionPassedRules}/${ctx.constitutionTotalRules}`,
      ],
      suggestedActions: ctx.constitutionPassed
        ? []
        : ['Open the Accounting > Constitution tab to see which invariant failed and why.'],
      escalate: !ctx.constitutionPassed,
      citations: [{ field: 'constitution.passed', snippet: String(ctx.constitutionPassed) }],
    };
  }

  // Settled?
  if (q.includes('settle') || q.includes('blocked')) {
    return {
      answer: ctx.settled
        ? `The transaction SETTLED. Final status: ${ctx.status}. The plan executed end-to-end without being blocked.`
        : `The transaction was NOT settled. Final status: ${ctx.status}. ${
            !ctx.constitutionPassed
              ? 'The constitution blocked it.'
              : ctx.amendments.length > 0
                ? 'A failure during execution forced a recovery, but settlement did not complete.'
                : 'The plan was not feasible or was rolled back.'
          }`,
      reasoning: [
        `Settled: ${ctx.settled}`,
        `Status: ${ctx.status}`,
        `Constitution passed: ${ctx.constitutionPassed}`,
        `Amendments: ${ctx.amendments.length}`,
      ],
      suggestedActions: ctx.settled
        ? []
        : ['Inspect the constitution verdict and amendments to understand the block reason.'],
      escalate: !ctx.settled,
      citations: [{ field: 'settled', snippet: String(ctx.settled) }],
    };
  }

  // Cheapest route / alternatives
  if (q.includes('cheapest') || q.includes('alternative') || q.includes('other route')) {
    return {
      answer: `The chosen plan cost ${ctx.costPercent}% (${ctx.totalFees} ${ctx.currency}). The planner evaluated several alternatives — see the Solver tab for the full ranked list. The next-best alternatives are listed in the AI Reasoning tab > Alternatives.`,
      reasoning: [
        `Chosen cost: ${ctx.costPercent}%`,
        `Alternatives evaluated: see plan.alternatives`,
      ],
      suggestedActions: ['Open the Solver tab to compare all candidate plans by cost, time, and risk.'],
      escalate: false,
      citations: [{ field: 'plan.metrics.costPercent', snippet: String(ctx.costPercent) }],
    };
  }

  // Cost / fees
  if (q.includes('cost') || q.includes('fee')) {
    return {
      answer: `This run cost ${ctx.costPercent}% in fees (${ctx.totalFees} ${ctx.currency}). Risk score was ${ctx.riskScore} (${ctx.riskLabel}) and settlement time was ${ctx.settlementTimeLabel} (${ctx.settlementTimeMs}ms).`,
      reasoning: [
        `Cost: ${ctx.costPercent}%`,
        `Total fees: ${ctx.totalFees} ${ctx.currency}`,
        `Settlement time: ${ctx.settlementTimeLabel}`,
        `Risk: ${ctx.riskScore} (${ctx.riskLabel})`,
      ],
      suggestedActions: [],
      escalate: false,
      citations: [{ field: 'plan.metrics', snippet: `cost=${ctx.costPercent}% fees=${ctx.totalFees}` }],
    };
  }

  // Generic fallback — list the run summary.
  return {
    answer: `Here's the summary of run ${ctx.runId.slice(0, 16)} (${ctx.scenarioName}). Status: ${ctx.status}, settled: ${ctx.settled}. Strategy: ${ctx.strategy}. Cost: ${ctx.costPercent}%, risk: ${ctx.riskScore}, confidence: ${ctx.confidence}%. Constitution: ${ctx.constitutionPassedRules}/${ctx.constitutionTotalRules} rules passed. ${ctx.amendments.length} amendment(s) during execution. Ask me specifically about routing decisions, rollback reasons, invariant failures, or alternatives for a detailed answer.`,
    reasoning: [
      `Run: ${ctx.runId}`,
      `Status: ${ctx.status}, settled: ${ctx.settled}`,
      `Strategy: ${ctx.strategy}`,
      `Cost: ${ctx.costPercent}%, Risk: ${ctx.riskScore}, Confidence: ${ctx.confidence}%`,
      `Constitution: ${ctx.constitutionPassedRules}/${ctx.constitutionTotalRules}`,
      `Amendments: ${ctx.amendments.length}, Events: ${ctx.events.length}, Ledger: ${ctx.ledger.length}`,
    ],
    suggestedActions: [
      'Ask "Why did this route use ' + ctx.strategy + '?" for routing rationale.',
      'Ask "What caused the rollback?" if amendments occurred.',
      'Ask "Which invariant failed?" if the constitution did not pass.',
    ],
    escalate: !ctx.settled || !ctx.constitutionPassed,
    citations: [{ field: 'runId', snippet: ctx.runId }],
  };
}
