'use client';

import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import { formatDate, formatRelative, statusBadgeClass } from '@/lib/format';

export interface WaitlistRow {
  id: string;
  name: string;
  email: string;
  company: string | null;
  country: string;
  businessType: string | null;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
}

const FILTERS = [
  { label: 'All', value: 'ALL' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Converted', value: 'CONVERTED' },
] as const;

type FilterValue = (typeof FILTERS)[number]['value'];

interface Props {
  entries: WaitlistRow[];
}

export function WaitlistManager({ entries }: Props) {
  const [filter, setFilter] = useState<FilterValue>('ALL');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // local state for instant feedback
  const [localEntries, setLocalEntries] = useState<WaitlistRow[]>(entries);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return localEntries.filter((e) => {
      if (filter !== 'ALL' && e.status !== filter) return false;
      if (!q) return true;
      return [e.name, e.email, e.company, e.country, e.businessType]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [localEntries, filter, query]);

  const handleAction = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    setBusyId(id);
    try {
      const res = await fetch('/api/admin/waitlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Action failed');
      }
      setLocalEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, status: action, reviewedAt: new Date().toISOString() } : e)),
      );
      toast.success(`Entry ${action.toLowerCase()}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Filters + search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filter === f.value ? 'default' : 'outline'}
              className={
                filter === f.value
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : ''
              }
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, company…"
          className="h-9 max-w-xs"
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="No waitlist entries"
            description="When prospective merchants join the waitlist, they'll appear here for review."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Business type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Applied</TableHead>
                <TableHead className="text-right">Reviewed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell className="text-muted-foreground">{e.email}</TableCell>
                  <TableCell className="text-muted-foreground">{e.company ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{e.country}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.businessType ? e.businessType.replace(/_/g, ' ') : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(e.status)}>
                      {e.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(e.createdAt, true)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatRelative(e.reviewedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {e.status === 'PENDING' ? (
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                          onClick={() => handleAction(e.id, 'APPROVED')}
                          disabled={busyId === e.id}
                          aria-label="Approve"
                        >
                          {busyId === e.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7 border-rose-500/30 text-rose-600 hover:bg-rose-500/10"
                          onClick={() => handleAction(e.id, 'REJECTED')}
                          disabled={busyId === e.id}
                          aria-label="Reject"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {filtered.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Showing {filtered.length} of {localEntries.length} entries
        </div>
      )}
    </div>
  );
}
