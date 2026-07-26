'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Filter } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

/**
 * Client-side filter bar for the incidents list. Updates the URL query
 * params so the server can re-render the filtered list. Supports status
 * (all / open / resolved) and severity (all / P1 / P2 / P3 / P4).
 */
export function IncidentFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const status = searchParams.get('status') ?? 'all';
  const severity = searchParams.get('severity') ?? 'all';

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'all' || !value) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const qs = params.toString();
    router.push(qs ? `/ops/incidents?${qs}` : '/ops/incidents');
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Filter className="h-3.5 w-3.5" />
        <span>Filters</span>
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-status" className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Status
        </Label>
        <Select value={status} onValueChange={(v) => update('status', v)}>
          <SelectTrigger id="filter-status" size="sm" className="w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="filter-severity" className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Severity
        </Label>
        <Select value={severity} onValueChange={(v) => update('severity', v)}>
          <SelectTrigger id="filter-severity" size="sm" className="w-32">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="P1">P1</SelectItem>
            <SelectItem value="P2">P2</SelectItem>
            <SelectItem value="P3">P3</SelectItem>
            <SelectItem value="P4">P4</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
