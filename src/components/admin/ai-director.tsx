'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Brain,
  Send,
  Loader2,
  ShieldAlert,
  Wand2,
  X,
  ChevronRight,
  Sparkles,
  AlertTriangle,
  FileText,
  ListChecks,
  Quote,
  Save,
  RotateCcw,
  Lightbulb,
  CornerDownRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface AiDirectorMessage {
  id: string;
  role: 'user' | 'assistant';
  question?: string;
  answer?: string;
  reasoning?: string[];
  suggestedActions?: string[];
  citations?: { frame?: number; field?: string; snippet: string }[];
  escalate?: boolean;
  llmPowered?: boolean;
  scenarioName?: string;
  runId?: string;
  timestamp: number;
  loading?: boolean;
  error?: boolean;
}

interface PatchDraft {
  problem: string;
  currentBehavior: string;
  reason: string;
  suggestedFix: string;
  files: string[];
  tests: string[];
  expectedImpact: string;
}

interface AiDirectorProps {
  scenarioResult: any | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function AiDirector({
  scenarioResult,
  collapsed,
  onToggleCollapsed,
}: AiDirectorProps) {
  const [messages, setMessages] = useState<AiDirectorMessage[]>([]);
  const [input, setInput] = useState('');
  const [fixMode, setFixMode] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateDraft, setEscalateDraft] = useState<PatchDraft | null>(null);
  const [escalateSeverity, setEscalateSeverity] = useState<'P1' | 'P2' | 'P3' | 'P4'>('P2');
  const [escalateComponent, setEscalateComponent] = useState('runtime');
  const [escalating, setEscalating] = useState(false);
  const [patchDraft, setPatchDraft] = useState<PatchDraft | null>(null);
  const [patchLoading, setPatchLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const scenarioName = scenarioResult?.scenario?.name ?? undefined;
  const runId = scenarioResult?.runId;
  const strategy = scenarioResult?.plan?.strategy;
  const hasAmendments = (scenarioResult?.amendments?.length ?? 0) > 0;
  const constitutionPassed = scenarioResult?.constitution?.passed;
  const settled = scenarioResult?.settled;

  // ── Send question ──────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || pendingId) return;

    const userMsg: AiDirectorMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      question,
      timestamp: Date.now(),
    };
    const loadingMsg: AiDirectorMessage = {
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      loading: true,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInput('');
    setPendingId(loadingMsg.id);

    try {
      const res = await fetch('/api/runtime/ai-director', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          scenarioResult,
          scenarioId: runId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? {
                ...m,
                loading: false,
                answer: data.answer,
                reasoning: data.reasoning ?? [],
                suggestedActions: data.suggestedActions ?? [],
                citations: data.citations ?? [],
                escalate: data.escalate ?? false,
                llmPowered: data.llmPowered ?? false,
                scenarioName: data.scenarioName,
                runId: data.runId,
              }
            : m,
        ),
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? {
                ...m,
                loading: false,
                error: true,
                answer:
                  err instanceof Error
                    ? `Failed to reach AI Director: ${err.message}`
                    : 'Failed to reach AI Director.',
              }
            : m,
        ),
      );
    } finally {
      setPendingId(null);
    }
  }, [input, pendingId, scenarioResult, runId]);

  // ── Generate patch (Fix Mode) ──────────────────────────────────────
  const handleGeneratePatch = useCallback(async () => {
    const observation = input.trim();
    if (!observation || patchLoading) return;

    setPatchLoading(true);
    setPatchDraft(null);
    try {
      const res = await fetch('/api/runtime/ai-director/fix-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observation, scenarioResult }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setPatchDraft(data.patch);
      toast.success('Patch draft generated', {
        description: 'Review the structured proposal below. No code was changed.',
      });
    } catch (err) {
      toast.error('Failed to generate patch', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setPatchLoading(false);
    }
  }, [input, scenarioResult, patchLoading]);

  // ── Escalate ───────────────────────────────────────────────────────
  const openEscalate = (draft?: Partial<PatchDraft>) => {
    setEscalateDraft({
      problem: draft?.problem ?? '',
      currentBehavior: draft?.currentBehavior ?? '',
      reason: draft?.reason ?? '',
      suggestedFix: draft?.suggestedFix ?? '',
      files: draft?.files ?? [],
      tests: draft?.tests ?? [],
      expectedImpact: draft?.expectedImpact ?? '',
    });
    setEscalateOpen(true);
  };

  const submitEscalate = useCallback(async () => {
    if (!escalateDraft || escalating) return;
    if (!escalateDraft.problem.trim()) {
      toast.error('Problem is required');
      return;
    }
    setEscalating(true);
    try {
      const res = await fetch('/api/runtime/ai-director/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...escalateDraft,
          severity: escalateSeverity,
          component: escalateComponent,
          scenarioName,
          runId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      toast.success('Incident filed', {
        description: `${data.incident.id} · ${data.incident.severity} · ${data.incident.component}`,
      });
      setEscalateOpen(false);
      setEscalateDraft(null);
    } catch (err) {
      toast.error('Failed to file incident', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setEscalating(false);
    }
  }, [escalateDraft, escalating, escalateSeverity, escalateComponent, scenarioName, runId]);

  // ── Quick prompts ──────────────────────────────────────────────────
  const quickPrompts: { label: string; question: string; show: boolean }[] = [
    {
      label: 'Why this route?',
      question: strategy
        ? `Why did this route use ${strategy}?`
        : 'Why did this route use this strategy?',
      show: !!scenarioResult,
    },
    {
      label: 'What caused rollback?',
      question: 'What caused the rollback?',
      show: hasAmendments,
    },
    {
      label: 'Which invariant failed?',
      question: 'Which invariant failed?',
      show: !!scenarioResult && constitutionPassed === false,
    },
    {
      label: 'Did it settle?',
      question: 'Did the transaction settle, and if not why?',
      show: !!scenarioResult,
    },
    {
      label: 'Cheapest route?',
      question: 'What was the cheapest route considered?',
      show: !!scenarioResult,
    },
    {
      label: 'Risks?',
      question: 'What are the risks in this run?',
      show: !!scenarioResult,
    },
  ];

  // ── Collapsed rail ─────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-2 border-l bg-card/60 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={onToggleCollapsed}
          title="Open AI Director"
        >
          <Brain className="h-4 w-4 text-emerald-500" />
          <span className="hidden text-xs lg:inline">AI Director</span>
          <ChevronRight className="h-3 w-3" />
        </Button>
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          <span className="rotate-180 text-[10px] uppercase tracking-wide [writing-mode:vertical-rl]">
            Ask the kernel
          </span>
        </div>
        {messages.length > 0 && (
          <Badge variant="secondary" className="text-[9px]">
            {messages.filter((m) => m.role === 'user').length} q
          </Badge>
        )}
      </div>
    );
  }

  // ── Expanded panel ─────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col border-l bg-card/60">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Brain className="h-4 w-4 shrink-0 text-emerald-500" />
          <div className="min-w-0">
            <div className="text-xs font-semibold leading-tight">AI Director</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {scenarioResult
                ? `Page-aware · run ${String(runId ?? '').slice(0, 12)}`
                : 'No scenario yet'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1.5 rounded-md border bg-background/60 px-2 py-1">
            <Wand2 className={cn('h-3 w-3', fixMode ? 'text-amber-500' : 'text-muted-foreground')} />
            <span className="text-[10px] font-medium">Fix Mode</span>
            <Switch
              checked={fixMode}
              onCheckedChange={setFixMode}
              className="h-3.5 w-7"
              aria-label="Toggle AI Fix Mode"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onToggleCollapsed}
            title="Collapse AI Director"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Fix Mode banner */}
      {fixMode && (
        <div className="border-b bg-amber-500/5 px-3 py-2 text-[10px] text-amber-700 dark:text-amber-400">
          <div className="flex items-center gap-1.5 font-medium">
            <Wand2 className="h-3 w-3" /> AI Fix Mode
          </div>
          <p className="mt-0.5 leading-snug">
            Describe a concern (e.g. "corridor routing is too aggressive"). The AI
            will produce a structured patch draft. No code is changed — the draft
            must be approved and filed as an incident for engineering.
          </p>
        </div>
      )}

      {/* Message list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3
          [&::-webkit-scrollbar]:w-1.5
          [&::-webkit-scrollbar-thumb]:rounded
          [&::-webkit-scrollbar-thumb]:bg-muted"
      >
        {messages.length === 0 && !patchDraft && (
          <EmptyState
            hasScenario={!!scenarioResult}
            fixMode={fixMode}
            onQuickPrompt={(q) => setInput(q)}
          />
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} onEscalate={() => openEscalate({
            problem: m.question,
            currentBehavior: m.answer,
            reason: m.reasoning?.join(' '),
          })} />
        ))}

        {patchDraft && (
          <PatchCard
            patch={patchDraft}
            loading={patchLoading}
            onEscalate={() => openEscalate(patchDraft)}
            onDismiss={() => setPatchDraft(null)}
          />
        )}
      </div>

      {/* Quick prompts */}
      {!fixMode && scenarioResult && (
        <div className="border-t px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {quickPrompts
              .filter((p) => p.show)
              .slice(0, 4)
              .map((p) => (
                <button
                  key={p.label}
                  onClick={() => setInput(p.question)}
                  disabled={!!pendingId}
                  className="rounded-full border bg-background/60 px-2 py-0.5 text-[10px] text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {p.label}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t p-3 space-y-2">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              fixMode
                ? 'Describe the concern (e.g. "corridor routing is too aggressive")...'
                : scenarioResult
                  ? 'Ask about this run — routing, rollback, invariants, costs...'
                  : 'Run a simulation first, then ask about the result.'
            }
            disabled={!!pendingId || patchLoading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (fixMode) {
                  handleGeneratePatch();
                } else {
                  handleSend();
                }
              }
            }}
            rows={2}
            className="min-h-[44px] resize-none text-xs"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] text-muted-foreground">
            {fixMode ? 'Enter generates patch' : 'Enter sends · Shift+Enter for newline'}
          </span>
          <Button
            size="sm"
            disabled={!input.trim() || !!pendingId || patchLoading}
            onClick={fixMode ? handleGeneratePatch : handleSend}
            className={cn(
              'gap-1.5 h-7 text-xs',
              fixMode
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white',
            )}
          >
            {pendingId || patchLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : fixMode ? (
              <Wand2 className="h-3 w-3" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            {fixMode ? 'Generate Patch' : 'Ask'}
          </Button>
        </div>
      </div>

      {/* Escalate Dialog */}
      <Dialog open={escalateOpen} onOpenChange={setEscalateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-muted">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-rose-500" />
              Escalate Issue
            </DialogTitle>
            <DialogDescription>
              File this as an Incident in the PaySwap ops system. The structured
              report will be saved as the first incident update.
            </DialogDescription>
          </DialogHeader>

          {escalateDraft && (
            <div className="space-y-3 py-2">
              <EscalateField
                label="Problem"
                value={escalateDraft.problem}
                onChange={(v) => setEscalateDraft({ ...escalateDraft, problem: v })}
                required
                placeholder="One-sentence problem statement"
              />
              <EscalateField
                label="Current behavior"
                value={escalateDraft.currentBehavior}
                onChange={(v) => setEscalateDraft({ ...escalateDraft, currentBehavior: v })}
                textarea
                placeholder="What the kernel actually did in this run"
              />
              <EscalateField
                label="Reason"
                value={escalateDraft.reason}
                onChange={(v) => setEscalateDraft({ ...escalateDraft, reason: v })}
                textarea
                placeholder="Why this is a problem (cost, risk, correctness, user impact)"
              />
              <EscalateField
                label="Suggested fix"
                value={escalateDraft.suggestedFix}
                onChange={(v) => setEscalateDraft({ ...escalateDraft, suggestedFix: v })}
                textarea
                placeholder="High-level modification (no code)"
              />
              <EscalateField
                label="Files (comma-separated)"
                value={escalateDraft.files.join(', ')}
                onChange={(v) =>
                  setEscalateDraft({
                    ...escalateDraft,
                    files: v.split(',').map((s) => s.trim()).filter(Boolean),
                  })
                }
                placeholder="src/kernel/planner.ts, src/kernel/support.ts"
              />
              <EscalateField
                label="Tests (comma-separated)"
                value={escalateDraft.tests.join(', ')}
                onChange={(v) =>
                  setEscalateDraft({
                    ...escalateDraft,
                    tests: v.split(',').map((s) => s.trim()).filter(Boolean),
                  })
                }
                placeholder="planner-cost-priority.test, corridor-aggression-regression.scenario"
              />
              <EscalateField
                label="Expected impact"
                value={escalateDraft.expectedImpact}
                onChange={(v) => setEscalateDraft({ ...escalateDraft, expectedImpact: v })}
                textarea
                placeholder="What the fix accomplishes"
              />

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Severity</label>
                  <Select
                    value={escalateSeverity}
                    onValueChange={(v) => setEscalateSeverity(v as 'P1' | 'P2' | 'P3' | 'P4')}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="P1">P1 — Critical</SelectItem>
                      <SelectItem value="P2">P2 — High</SelectItem>
                      <SelectItem value="P3">P3 — Medium</SelectItem>
                      <SelectItem value="P4">P4 — Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Component</label>
                  <Select value={escalateComponent} onValueChange={setEscalateComponent}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="runtime">runtime</SelectItem>
                      <SelectItem value="api">api</SelectItem>
                      <SelectItem value="payments">payments</SelectItem>
                      <SelectItem value="payouts">payouts</SelectItem>
                      <SelectItem value="webhooks">webhooks</SelectItem>
                      <SelectItem value="connectors">connectors</SelectItem>
                      <SelectItem value="blockchain">blockchain</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEscalateOpen(false)}
              disabled={escalating}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submitEscalate}
              disabled={escalating || !escalateDraft?.problem.trim()}
              className="gap-1.5 bg-rose-600 hover:bg-rose-700 text-white"
            >
              {escalating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5" />
              )}
              File Incident
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function EmptyState({
  hasScenario,
  fixMode,
  onQuickPrompt,
}: {
  hasScenario: boolean;
  fixMode: boolean;
  onQuickPrompt: (q: string) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
        {fixMode ? (
          <Wand2 className="h-5 w-5 text-amber-500" />
        ) : (
          <Brain className="h-5 w-5 text-emerald-500" />
        )}
      </div>
      <div>
        <p className="text-sm font-medium">
          {fixMode ? 'AI Fix Mode' : 'AI Director'}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {fixMode
            ? 'Describe a concern about the kernel\'s behaviour. The AI will draft a structured patch proposal — no code is changed.'
            : hasScenario
              ? 'Ask me about this run. I have the full scenario result (timeline, decisions, ledger, events, amendments, invariants) as context.'
              : 'Run a simulation first. Once you have a result, I can answer questions about routing decisions, rollbacks, invariant failures, and costs.'}
        </p>
      </div>
      {!fixMode && hasScenario && (
        <div className="flex flex-col items-start gap-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Try asking
          </p>
          {[
            'Why did this route use this strategy?',
            'What caused the rollback?',
            'Which invariant failed?',
            'What was the cheapest route considered?',
          ].map((q) => (
            <button
              key={q}
              onClick={() => onQuickPrompt(q)}
              className="flex items-center gap-1.5 rounded-md border bg-background/60 px-2 py-1 text-left text-[11px] hover:bg-muted transition-colors"
            >
              <Lightbulb className="h-3 w-3 shrink-0 text-amber-500" />
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  onEscalate,
}: {
  message: AiDirectorMessage;
  onEscalate: () => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[90%] rounded-lg rounded-br-sm bg-emerald-600 px-2.5 py-1.5 text-xs text-white">
          {message.question}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Brain className="h-3 w-3 text-emerald-500" />
        <span className="font-medium">AI Director</span>
        {message.llmPowered === false && (
          <Badge variant="outline" className="h-3.5 px-1 text-[9px]">
            fallback
          </Badge>
        )}
        {message.llmPowered === true && (
          <Badge variant="outline" className="h-3.5 px-1 text-[9px] text-emerald-600">
            LLM
          </Badge>
        )}
      </div>

      <div
        className={cn(
          'rounded-lg rounded-tl-sm border bg-background/60 px-2.5 py-2 text-xs leading-relaxed',
          message.error ? 'border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-400' : '',
        )}
      >
        {message.loading ? (
          <div className="flex items-center gap-1.5 py-1 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-[11px]">Thinking...</span>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="whitespace-pre-wrap">{message.answer}</p>

            {message.reasoning && message.reasoning.length > 0 && (
              <div className="space-y-1 border-t pt-1.5">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
                  <ListChecks className="h-3 w-3" /> Reasoning
                </div>
                <ul className="space-y-0.5">
                  {message.reasoning.map((r, i) => (
                    <li key={i} className="flex gap-1.5 text-[11px] text-muted-foreground">
                      <CornerDownRight className="mt-0.5 h-2.5 w-2.5 shrink-0" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {message.citations && message.citations.length > 0 && (
              <div className="space-y-1 border-t pt-1.5">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
                  <Quote className="h-3 w-3" /> Citations
                </div>
                <ul className="space-y-0.5">
                  {message.citations.map((c, i) => (
                    <li key={i} className="flex gap-1.5 text-[10px] font-mono text-muted-foreground">
                      <span className="shrink-0">
                        [{c.frame !== undefined ? `f${c.frame}` : c.field ?? 'ref'}]
                      </span>
                      <span className="truncate">{c.snippet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {message.suggestedActions && message.suggestedActions.length > 0 && (
              <div className="space-y-1 border-t pt-1.5">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
                  <Sparkles className="h-3 w-3" /> Suggested actions
                </div>
                <ul className="space-y-0.5">
                  {message.suggestedActions.map((a, i) => (
                    <li key={i} className="flex gap-1.5 text-[11px]">
                      <span className="text-emerald-500">→</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {message.escalate && !message.error && (
              <div className="flex items-center justify-between gap-2 border-t pt-2">
                <div className="flex items-center gap-1.5 text-[10px] text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-3 w-3" />
                  <span>This may warrant an incident.</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 gap-1 border-rose-500/40 text-[10px] text-rose-600 hover:bg-rose-500/10"
                  onClick={onEscalate}
                >
                  <ShieldAlert className="h-3 w-3" /> Escalate
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PatchCard({
  patch,
  loading,
  onEscalate,
  onDismiss,
}: {
  patch: PatchDraft | null;
  loading: boolean;
  onEscalate: () => void;
  onDismiss: () => void;
}) {
  if (loading && !patch) {
    return (
      <Card className="border-amber-500/30">
        <CardContent className="flex items-center gap-2 p-3 text-xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
          <span>Drafting patch proposal...</span>
        </CardContent>
      </Card>
    );
  }

  if (!patch) return null;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-1.5 text-xs">
            <Wand2 className="h-3.5 w-3.5 text-amber-500" />
            Patch Draft
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={onDismiss}
            title="Dismiss patch"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0 text-[11px]">
        <PatchField icon={<AlertTriangle className="h-3 w-3" />} label="Problem" value={patch.problem} />
        <PatchField icon={<FileText className="h-3 w-3" />} label="Current behavior" value={patch.currentBehavior} />
        <PatchField icon={<Lightbulb className="h-3 w-3" />} label="Reason" value={patch.reason} />
        <PatchField icon={<Wand2 className="h-3 w-3" />} label="Suggested fix" value={patch.suggestedFix} />
        {patch.files.length > 0 && (
          <div>
            <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
              <FileText className="h-3 w-3" /> Files
            </div>
            <div className="flex flex-wrap gap-1">
              {patch.files.map((f, i) => (
                <Badge key={i} variant="outline" className="font-mono text-[9px]">
                  {f}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {patch.tests.length > 0 && (
          <div>
            <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
              <ListChecks className="h-3 w-3" /> Tests
            </div>
            <div className="flex flex-wrap gap-1">
              {patch.tests.map((t, i) => (
                <Badge key={i} variant="outline" className="font-mono text-[9px]">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}
        <PatchField icon={<Sparkles className="h-3 w-3" />} label="Expected impact" value={patch.expectedImpact} />

        <Separator className="my-2" />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            No code changed. Approve to file as incident.
          </span>
          <Button
            size="sm"
            className="h-7 gap-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px]"
            onClick={onEscalate}
          >
            <Save className="h-3 w-3" /> Save as Incident
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PatchField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  if (!value) return null;
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
        {icon} {label}
      </div>
      <p className="whitespace-pre-wrap leading-snug text-foreground">{value}</p>
    </div>
  );
}

function EscalateField({
  label,
  value,
  onChange,
  placeholder,
  textarea,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {textarea ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="text-xs"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="text-xs"
        />
      )}
    </div>
  );
}
