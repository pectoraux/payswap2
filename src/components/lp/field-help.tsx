'use client';

import * as React from 'react';
import { Info } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface FieldHelpProps {
  /**
   * Short heading rendered in bold at the top of the popover. Usually the
   * field label itself ("Source currency", "Fee (bps)", etc.).
   */
  title: string;
  /**
   * 1-2 sentence explanation of what the field means and why it matters.
   * Rendered as the body paragraph.
   */
  description: string;
  /**
   * Optional concrete example ("e.g., GHS for Ghanaian Cedi"). Rendered in a
   * tinted callout so the LP can scan for it quickly.
   */
  example?: string;
  /** Optional smaller className override for the trigger icon. */
  className?: string;
  /** Size variant for the trigger button. */
  size?: 'sm' | 'md';
}

/**
 * `<FieldHelp />` — a small info icon that opens a popover explaining a form
 * field. Used on every LP form (Add Capital, Adjust Reserve, Add Corridor,
 * Settings) so LPs always have inline documentation for what they're
 * configuring and an example to copy.
 *
 * Implementation notes:
 *  - Uses Popover (not Tooltip) because the help text is multi-line and
 *    tooltips truncate long content.
 *  - Trigger is a real <button> so keyboard / screen-reader users can open it
 *    with Enter / Space.
 *  - Stops propagation on click so it can be safely embedded inside form
 *    submit handlers / Select triggers without toggling them.
 */
export function FieldHelp({
  title,
  description,
  example,
  className,
  size = 'sm',
}: FieldHelpProps) {
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Help for ${title}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className={cn(
            'inline-flex items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30',
            className,
          )}
        >
          <Info className={iconSize} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-72 p-3 text-xs leading-relaxed"
      >
        <div className="font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-muted-foreground">{description}</p>
        {example && (
          <div className="mt-2 rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] px-2 py-1.5 font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
            {example}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Convenience wrapper: renders the field label + FieldHelp in a single row.
 * Standard usage in LP forms:
 *
 *   <FieldLabel help={{ title: 'Fee', description: '...', example: '...' }}>
 *     Fee (bps)
 *   </FieldLabel>
 */
export function FieldLabel({
  children,
  help,
  htmlFor,
  className,
}: {
  children: React.ReactNode;
  help?: Omit<FieldHelpProps, 'className' | 'size'>;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {children}
        </label>
      ) : (
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {children}
        </span>
      )}
      {help && <FieldHelp {...help} />}
    </div>
  );
}
