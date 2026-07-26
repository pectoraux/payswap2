'use client';

import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface HelpIconProps {
  text: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * A help icon with a tooltip that shows explanatory text on hover.
 * Use anywhere users might need context about what a section does.
 */
export function HelpIcon({ text, className, size = 'sm' }: HelpIconProps) {
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : size === 'md' ? 'h-4 w-4' : 'h-5 w-5';

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-muted-foreground hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/30',
              className,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <HelpCircle className={iconSize} />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="center"
          className="max-w-xs bg-popover/95 border-border/60 text-popover-foreground shadow-lg text-xs leading-relaxed p-3 rounded-lg"
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * A section header with title + optional help icon.
 * Use to label sections within the runtime console.
 */
export function HelpSection({
  title,
  helpText,
  children,
  className,
}: {
  title?: string;
  helpText?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {title && <span className="text-sm font-semibold">{title}</span>}
      {helpText && <HelpIcon text={helpText} />}
      {children}
    </div>
  );
}
