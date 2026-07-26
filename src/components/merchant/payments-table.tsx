'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Search } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { formatCurrency, formatDate, statusBadgeClass } from '@/lib/format';
import { Card } from '@/components/ui/card';

export interface PaymentRow {
  id: string;
  reference: string | null;
  amount: number;
  currency: string;
  method: string | null;
  status: string;
  description: string | null;
  createdAt: string;
}

interface Props {
  payments: PaymentRow[];
  loading?: boolean;
}

export function PaymentsTable({ payments, loading }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter((p) =>
      [p.reference, p.method, p.status, p.description, p.currency]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [payments, query]);

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by reference, method, status…"
          className="h-9 pl-8"
        />
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-4 w-24" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search className="h-5 w-5" />}
            title={query ? 'No matching payments' : 'No payments yet'}
            description={
              query
                ? 'Try a different search term.'
                : 'Accepted payments will show up here. Generate a QR code or payment link to start.'
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">
                    {p.reference ?? p.id.slice(0, 12)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(p.amount, p.currency)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {(p.method ?? '—').replace(/_/g, ' ')}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-muted-foreground">
                    {p.description ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(p.status)}>
                      {p.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(p.createdAt, true)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {filtered.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Showing {filtered.length} of {payments.length} payments
        </div>
      )}
    </div>
  );
}
