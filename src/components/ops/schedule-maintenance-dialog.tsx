'use client';

import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
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

const COMPONENTS = [
  { value: 'runtime', label: 'Runtime' },
  { value: 'database', label: 'Database' },
  { value: 'connectors', label: 'Connectors' },
  { value: 'treasury', label: 'Treasury' },
  { value: 'settlement', label: 'Settlement' },
  { value: 'marketplace', label: 'Marketplace' },
] as const;

const IMPACTS = [
  { value: 'none', label: 'No impact' },
  { value: 'minor', label: 'Minor' },
  { value: 'major', label: 'Major' },
  { value: 'outage', label: 'Outage' },
] as const;

function toLocalInputValue(date: Date): string {
  // Format as yyyy-MM-ddTHH:mm for the datetime-local input.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Dialog that schedules a new maintenance window. Submits to POST
 * /api/ops/maintenance. On success: toast + reload.
 */
export function ScheduleMaintenanceDialog() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [component, setComponent] = useState<string>('runtime');
  const [impact, setImpact] = useState<string>('none');
  const startDefault = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const endDefault = new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000);
  const [startAt, setStartAt] = useState(toLocalInputValue(startDefault));
  const [endAt, setEndAt] = useState(toLocalInputValue(endDefault));

  function reset() {
    setTitle('');
    setDescription('');
    setComponent('runtime');
    setImpact('none');
    setStartAt(toLocalInputValue(startDefault));
    setEndAt(toLocalInputValue(endDefault));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Please provide a title');
      return;
    }
    const startMs = new Date(startAt).getTime();
    const endMs = new Date(endAt).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      toast.error('Please provide valid start and end times');
      return;
    }
    if (startMs >= endMs) {
      toast.error('Start must be before end');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/ops/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          component,
          impact,
          startAt: startMs,
          endAt: endMs,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to schedule maintenance');
      }
      toast.success('Maintenance scheduled');
      reset();
      setOpen(false);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to schedule maintenance',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          className="bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <Plus className="mr-2 h-4 w-4" />
          Schedule maintenance
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Schedule maintenance</DialogTitle>
            <DialogDescription>
              Plan a maintenance window. Operators will be notified and the
              dashboard will reflect the upcoming impact.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="mw-title">Title</Label>
            <Input
              id="mw-title"
              placeholder="e.g. Routine DB vacuum"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mw-component">Component</Label>
              <Select value={component} onValueChange={setComponent}>
                <SelectTrigger id="mw-component" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPONENTS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mw-impact">Impact</Label>
              <Select value={impact} onValueChange={setImpact}>
                <SelectTrigger id="mw-impact" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPACTS.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mw-start">Start</Label>
              <Input
                id="mw-start"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mw-end">End</Label>
              <Input
                id="mw-end"
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mw-desc">Description</Label>
            <Textarea
              id="mw-desc"
              placeholder="What is being maintained? What is the expected customer impact?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-20"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                reset();
              }}
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scheduling…
                </>
              ) : (
                'Schedule'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
