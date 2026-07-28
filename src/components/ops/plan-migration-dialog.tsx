'use client';

import { useState } from 'react';
import { Plus, Loader2, X } from 'lucide-react';
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

const TYPES = [
  { value: 'schema', label: 'Schema' },
  { value: 'data', label: 'Data' },
  { value: 'code', label: 'Code' },
  { value: 'config', label: 'Config' },
] as const;

interface StepInput {
  order: number;
  description: string;
}

/**
 * Dialog that plans a new migration. Each migration requires a name, type,
 * version, rollback plan and at least one step. Submits to POST
 * /api/ops/migrations. On success: toast + reload.
 */
export function PlanMigrationDialog() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<string>('schema');
  const [version, setVersion] = useState('');
  const [rollbackPlan, setRollbackPlan] = useState('');
  const [steps, setSteps] = useState<StepInput[]>([
    { order: 1, description: '' },
  ]);

  function reset() {
    setName('');
    setDescription('');
    setType('schema');
    setVersion('');
    setRollbackPlan('');
    setSteps([{ order: 1, description: '' }]);
  }

  function addStep() {
    setSteps((prev) => [
      ...prev,
      { order: prev.length + 1, description: '' },
    ]);
  }

  function removeStep(idx: number) {
    setSteps((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, order: i + 1 })),
    );
  }

  function updateStep(idx: number, description: string) {
    setSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, description } : s)),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Please provide a name');
      return;
    }
    if (!version.trim()) {
      toast.error('Please provide a version');
      return;
    }
    if (!rollbackPlan.trim()) {
      toast.error('Please provide a rollback plan');
      return;
    }
    const cleanSteps = steps
      .map((s) => ({ order: s.order, description: s.description.trim() }))
      .filter((s) => s.description);
    if (cleanSteps.length === 0) {
      toast.error('At least one step is required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/ops/migrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          type,
          version: version.trim(),
          rollbackPlan: rollbackPlan.trim(),
          steps: cleanSteps,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to plan migration');
      }
      toast.success('Migration planned');
      reset();
      setOpen(false);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to plan migration',
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
          Plan migration
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Plan migration</DialogTitle>
            <DialogDescription>
              Author a new migration with a rollback plan and ordered steps.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="mig-name">Name</Label>
            <Input
              id="mig-name"
              placeholder="e.g. Add payouts table index"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mig-type">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="mig-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mig-version">Version</Label>
              <Input
                id="mig-version"
                placeholder="e.g. 2024.03.22-01"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mig-desc">Description</Label>
            <Textarea
              id="mig-desc"
              placeholder="What does this migration do?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-16"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mig-rollback">Rollback plan</Label>
            <Textarea
              id="mig-rollback"
              placeholder="How to undo this migration if something goes wrong."
              value={rollbackPlan}
              onChange={(e) => setRollbackPlan(e.target.value)}
              className="min-h-20 font-mono text-[11px]"
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Steps</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addStep}
                className="h-7 text-[11px]"
              >
                <Plus className="mr-1 h-3 w-3" /> Add step
              </Button>
            </div>
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
                    {s.order}
                  </div>
                  <Textarea
                    placeholder={`Step ${s.order} description`}
                    value={s.description}
                    onChange={(e) => updateStep(i, e.target.value)}
                    className="min-h-10 text-xs"
                  />
                  {steps.length > 1 && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => removeStep(i)}
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-rose-600"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Planning…
                </>
              ) : (
                'Plan migration'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
