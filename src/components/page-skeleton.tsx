import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface PageSkeletonProps {
  /**
   * Number of KPI cards to render in the summary row. Defaults to 4.
   */
  kpiCount?: number;
  /**
   * Number of skeleton rows to render inside the table card. Defaults to 6.
   */
  tableRows?: number;
  /**
   * When true, renders the fixed-width sidebar skeleton alongside the main
   * content. This is useful when the skeleton is rendered inside a layout
   * that does not already include the sidebar (e.g. a route-level
   * `loading.tsx`). Defaults to `false` because most authenticated layouts
   * already render the persistent sidebar shell.
   */
  withSidebar?: boolean;
  className?: string;
}

/**
 * Reusable page-level skeleton that mirrors the canonical dashboard layout:
 * a page header (title + description), a KPI summary row, and a primary
 * content card containing a stacked-table skeleton.
 *
 * Use this as the `loading.tsx` for any route group that follows the
 * standard "header → KPIs → table" layout.
 */
export function PageSkeleton({
  kpiCount = 4,
  tableRows = 6,
  withSidebar = false,
  className,
}: PageSkeletonProps) {
  const inner = (
    <div className={cn('space-y-6 p-4 lg:p-6', className)}>
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: kpiCount }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="mt-3 h-7 w-20" />
              <Skeleton className="mt-2 h-3 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Primary table card */}
      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: tableRows }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  if (!withSidebar) return inner;

  // Sidebar + content layout. Mirrors the `UnifiedShell` structure so the
  // skeleton fills the entire viewport during a route-group loading state.
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-background lg:flex">
        <div className="flex h-14 items-center gap-2.5 border-b px-4">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-2 w-12" />
          </div>
        </div>
        <div className="space-y-3 p-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-2.5 w-20" />
              {Array.from({ length: 3 }).map((_, j) => (
                <Skeleton key={j} className="h-8 w-full" />
              ))}
            </div>
          ))}
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-4 lg:px-6">
          <Skeleton className="h-7 w-40" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        </header>
        <main className="flex-1">{inner}</main>
      </div>
    </div>
  );
}
