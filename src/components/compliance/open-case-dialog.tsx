'use client';

import { useState } from 'react';
import { FolderPlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ENTITY_TYPES = [
  { value: 'PAYMENT', label: 'Payment' },
  { value: 'PAYOUT', label: 'Payout' },
  { value: 'MERCHANT', label: 'Merchant' },
  { value: 'CUSTOMER', label: 'Customer' },
  { value: 'ALERT', label: 'AML Alert' },
] as const;

interface OpenCaseDialogProps {
  /** Pre-fill the entity (e.g. "open case for this alert"). */
  defaultEntityId?: string;
  defaultEntityType?: string;
  /** Pre-selected alert ids to attach to the case. */
  defaultAlertIds?: string[];
  /** Optional trigger label override. */
  triggerLabel?: string;
  /** Optional alert candidates the user can attach to the case. */
  alertOptions?: Array<{ id: string; label: string }>;
}

/**
 * Dialog that opens a new compliance case. Submits to
 * POST /api/compliance/cases with `{ entityId, entityType, alertIds, description }`.
 *
 * The trigger button defaults to a primary emerald "Open Case" affordance but
 * can be rendered as a compact outline button via the `triggerLabel` prop
 * (used when the dialog is launched from an alert row).
 */
export function OpenCaseDialog({
  defaultEntityId = '',
  defaultEntityType = 'PAYMENT',
  defaultAlertIds = [],
  triggerLabel,
  alertOptions = [],
}: OpenCaseDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [entityId, setEntityId] = useState(defaultEntityId);
  const [entityType, setEntityType] = useState<string>(defaultEntityType);
  const [description, setDescription] = useState('');
  const [selectedAlerts, setSelectedAlerts] = useState<string[]>(
    defaultAlertIds,
  );

  function reset() {
    setEntityId(defaultEntityId);
    setEntityType(defaultEntityType);
    setDescription('');
    setSelectedAlertIds(defaultAlertIds);
  }

  function setSelectedAlertIds(next: string[]) {
    setSelectedAlerts(next);
  }

  function toggleAlert(id: string) {
    setSelectedAlerts((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!entityId.trim()) {
      toast.error('Please provide an entity ID');
      return;
    }
    if (!entityType) {
      toast.error('Please select an entity type');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/compliance/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId: entityId.trim(),
          entityType,
          alertIds: selectedAlerts,
          description: description.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to open case');
      }
      toast.success('Case opened');
      reset();
      setOpen(false);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open case');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button
          className={
            triggerLabel
              ? 'h-7 gap-1 px-2 text-[11px] border-teal-500/40 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400'
              : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }
          variant={triggerLabel ? 'outline' : 'default'}
          size={triggerLabel ? 'sm' : 'default'}
        >
          <FolderPlus className={triggerLabel ? 'h-3 w-3' : 'mr-2 h-4 w-4'} />
          {triggerLabel || 'Open Case'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Open compliance case</DialogTitle>
            <DialogDescription>
              Open a new investigation case tied to a specific entity. Alerts
              attached here will be referenced in the case file.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1 space-y-1.5">
              <Label htmlFor="case-type">Entity type</Label>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger id="case-type" className="w-full">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="case-eid">Entity ID</Label>
              <Input
                id="case-eid"
                placeholder="e.g. cm2abc…"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="case-desc">Description</Label>
            <Textarea
              id="case-desc"
              placeholder="Why is this case being opened?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-20"
            />
          </div>

          {alertOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Attach alerts</Label>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                {alertOptions.map((opt) => (
                  <label
                    key={opt.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-emerald-500/5"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAlerts.includes(opt.id)}
                      onChange={() => toggleAlert(opt.id)}
                      className="h-3.5 w-3.5 accent-emerald-600"
                    />
                    <span className="truncate">{opt.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {selectedAlerts.length} alert
                {selectedAlerts.length === 1 ? '' : 's'} selected
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { setOpen(false); reset(); }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening…
                </>
              ) : (
                'Open case'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
