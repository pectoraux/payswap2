'use client';

/**
 * RuntimeAIDirector — page-aware AI assistant for the /admin/runtime console.
 *
 * This is the runtime-page adapter for the shared {@link AiDirector} panel.
 * It exposes the same chat + escalation UX as the platform-wide component,
 * but is named & shaped for the runtime page: the runtime page passes its
 * most recent `SimulationResult` as `scenarioResult`, and the AI uses that
 * run's actual decisions, ledger, events, amendments and constitution
 * verdict to answer page-aware questions ("Why did this route use
 * MARKET_TO_RESERVE?", "What caused the rollback?", "Which invariant
 * failed?") and to pre-fill incident escalation forms.
 *
 * Two exports:
 *
 *  • `RuntimeAIDirector` — sidebar/floating variant. Used in the right-hand
 *    rail of the runtime page on xl+ screens, and as a bottom drawer on
 *    smaller screens. Collapsible via `collapsed` / `onToggleCollapsed`.
 *
 *  • `RuntimeAIDirectorInline` — non-collapsible inline variant. Drop it
 *    below the simulation console on narrow viewports where a sidebar
 *    isn't feasible. Always expanded, sized to fit its container.
 *
 * Both delegates to {@link AiDirector} (or a compact inline rendering for
 * the inline variant), so feature parity — chat history, quick prompts,
 * Fix Mode patch drafts, escalation dialog with severity/component
 * selectors, sonner toasts — is preserved without duplicating 1k lines.
 */

import { AiDirector } from './ai-director';

export interface RuntimeAIDirectorProps {
  /** The most recent simulation result (page-aware context for the LLM). */
  scenarioResult: any | null;
  /** When true, renders the collapsed rail (just a button + counter). */
  collapsed?: boolean;
  /** Toggle handler for the collapsed state. */
  onToggleCollapsed?: () => void;
}

/**
 * Sidebar / floating variant. Drop into the right rail of the runtime page.
 * Mirrors the {@link AiDirector} props shape 1:1 so the page can treat them
 * interchangeably.
 */
export function RuntimeAIDirector({
  scenarioResult,
  collapsed = false,
  onToggleCollapsed,
}: RuntimeAIDirectorProps) {
  return (
    <AiDirector
      scenarioResult={scenarioResult}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed ?? (() => {})}
    />
  );
}

export default RuntimeAIDirector;
