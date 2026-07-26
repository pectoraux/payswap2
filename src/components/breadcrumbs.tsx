import Link from 'next/link';
import { Fragment } from 'react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { cn } from '@/lib/utils';

export interface BreadcrumbEntry {
  /** Visible label for the crumb. */
  label: string;
  /** Optional internal href. When omitted, the crumb is rendered as the
   * current (non-clickable) page — typically the last item in the list. */
  href?: string;
}

export interface PageBreadcrumbsProps {
  items: BreadcrumbEntry[];
  className?: string;
}

/**
 * Reusable breadcrumb component built on the shadcn Breadcrumb primitive.
 *
 * The last item is always rendered as the current page (non-clickable) —
 * pass its `href` as `undefined` (or omit `href` entirely) to opt in. If
 * every item has an `href`, the final one is still promoted to the current
 * page so the UX matches user expectations on detail pages.
 *
 *   <PageBreadcrumbs
 *     items={[
 *       { label: 'Dashboard', href: '/dashboard' },
 *       { label: 'Payments', href: '/dashboard/payments' },
 *       { label: 'PAY-0012' },
 *     ]}
 *   />
 */
export function PageBreadcrumbs({ items, className }: PageBreadcrumbsProps) {
  if (!items || items.length === 0) return null;

  return (
    <Breadcrumb className={cn(className)}>
      <BreadcrumbList>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          const isCurrent = isLast || !item.href;

          return (
            <Fragment key={`${item.label}-${idx}`}>
              <BreadcrumbItem>
                {isCurrent ? (
                  <BreadcrumbPage className="text-xs text-foreground">
                    {item.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link
                      href={item.href as string}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {item.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator className="text-muted-foreground/60" />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
