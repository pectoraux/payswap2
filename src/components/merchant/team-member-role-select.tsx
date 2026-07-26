'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'DEVELOPER', label: 'Developer' },
  { value: 'ANALYST', label: 'Analyst' },
  { value: 'VIEWER', label: 'Viewer' },
  { value: 'SUPPORT', label: 'Support' },
] as const;

type Props = {
  id: string;
  role: string;
};

/**
 * Inline role selector for a team member row. On change, PATCHes the new role
 * to /api/team/[id].
 */
export function TeamMemberRoleSelect({ id, role }: Props) {
  const [value, setValue] = useState(role);
  const [busy, setBusy] = useState(false);

  async function handleChange(next: string) {
    if (next === value) return;
    setValue(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/team/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Revert on failure.
        setValue(role);
        throw new Error(data?.error || 'Failed to update role');
      }
      toast.success('Role updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select value={value} onValueChange={handleChange} disabled={busy}>
        <SelectTrigger size="sm" className="w-[130px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLE_OPTIONS.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
}
