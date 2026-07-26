import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface EmptyStateAction {
  /** Visible label for the CTA button. */
  label: string;
  /** Optional internal href — renders the CTA as a Next.js `<Link>`. */
  href?: string;
  /** Optional click handler — used when no `href` is provided. */
  onClick?: () => void;
}

export interface EmptyStateProps {
  /** Lucide icon (or any React node) rendered inside a muted circle. */
  icon: React.ReactNode;
  /** Heading (rendered as `<h3>`). */
  title: string;
  /** Supporting description text shown beneath the title. */
  description: string;
  /** Optional call-to-action button rendered below the description. */
  action?: EmptyStateAction;
  className?: string;
}

/**
 * Single, reusable empty state used across the PaySwap dashboard.
 *
 * Centered layout with a muted icon (h-12 w-12), title, description, and an
 * optional CTA. Pass either `action.href` (renders a Next `<Link>`) or
 * `action.onClick` (renders a `<button>`) — not both.
 *
 *   <EmptyState
 *     icon={<Users className="h-6 w-6" />}
 *     title="No customers yet"
 *     description="Add your first customer to start tracking payments."
 *     action={{ label: 'Add customer', href: '/dashboard/customers' }}
 *   />
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-4 py-16 text-center',
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        {icon}
      </div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{description}</p>
      {action && (
        <div className="mt-5">
          {action.href ? (
            <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={action.onClick}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
