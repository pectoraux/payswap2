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

/**
 * Dialog that opens a new investigation. Submits to POST /api/ops/investigations.
 * On success: toast + reload.
 */
export function CreateInvestigationDialog() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [incidentId, setIncidentId] = useState('');

  function reset() {
    setTitle('');
    setDescription('');
    setAssignedTo('');
    setIncidentId('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Please provide a title');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/ops/investigations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          assignedTo: assignedTo.trim() || undefined,
          incidentId: incidentId.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to open investigation');
      }
      toast.success('Investigation opened');
      reset();
      setOpen(false);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to open investigation',
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
          Open investigation
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Open investigation</DialogTitle>
            <DialogDescription>
              Capture the root cause of an incident or anomaly.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="inv-title">Title</Label>
            <Input
              id="inv-title"
              placeholder="e.g. Settlement queue stall on 2024-03-12"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-desc">Description</Label>
            <Textarea
              id="inv-desc"
              placeholder="What happened? What is the suspected cause?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-20"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="inv-assignee">Assignee (optional)</Label>
              <Input
                id="inv-assignee"
                placeholder="user id"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-incident">Linked incident (optional)</Label>
              <Input
                id="inv-incident"
                placeholder="incident id"
                value={incidentId}
                onChange={(e) => setIncidentId(e.target.value)}
              />
            </div>
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening…
                </>
              ) : (
                'Open investigation'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
