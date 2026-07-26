import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  cellClassName?: string;
  render?: (row: T, index: number) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  loadingRows?: number;
  empty?: {
    icon?: React.ReactNode;
    title: string;
    description?: string;
    action?: { label: string; href?: string; onClick?: () => void };
  };
  className?: string;
}

/**
 * Lightweight table wrapper with consistent header / row layout,
 * a loading skeleton, and an empty state.
 */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  loading,
  loadingRows = 5,
  empty,
  className,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <Card className={cn('overflow-hidden', className)}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className="h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: loadingRows }).map((_, i) => (
                <tr key={i} className="border-b">
                  {columns.map((c) => (
                    <td key={c.key} className="p-3 align-middle">
                      <div className="h-4 w-full max-w-[180px] animate-pulse rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    if (empty) {
      return (
        <Card className={className}>
          <CardContent className="p-0">
            <EmptyState
              icon={empty.icon}
              title={empty.title}
              description={empty.description}
              action={
                empty.action
                  ? {
                      label: empty.action.label,
                      href: empty.action.href,
                      onClick: empty.action.onClick,
                    }
                  : undefined
              }
            />
          </CardContent>
        </Card>
      );
    }
    return (
      <Card className={className}>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No data available.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground',
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={rowKey(row, i)} className="border-b last:border-0 transition-colors hover:bg-muted/40">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn('p-3 align-middle text-sm', c.cellClassName)}
                  >
                    {c.render
                      ? c.render(row, i)
                      : String((row as Record<string, unknown>)[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export { Button };
