'use client';

import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const NEXT_STATUSES = [
  { value: 'investigating', label: 'Investigating' },
  { value: 'identified', label: 'Identified' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'resolved', label: 'Resolved' },
] as const;

interface AddUpdateFormProps {
  incidentId: string;
}

/**
 * Add-update form for an incident. Submits to
 * POST /api/incidents/[id]/updates with `{ message, status }`. On success:
 * toast + reload so the new timeline entry reflects immediately.
 */
export function AddUpdateForm({ incidentId }: AddUpdateFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<string>('investigating');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) {
      toast.error('Please write a message');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/incidents/${encodeURIComponent(incidentId)}/updates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: message.trim(),
            status,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to add update');
      }
      toast.success('Update added');
      setMessage('');
      setStatus('investigating');
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add update');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="update-message" className="text-xs">
          Update message
        </Label>
        <Textarea
          id="update-message"
          placeholder="Share an update on the incident — what's been found, what's being tried, what's next…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="min-h-24 resize-y"
          required
        />
      </div>

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <Label htmlFor="update-status" className="text-xs">
            Status
          </Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="update-status" size="sm" className="w-44">
              <SelectValue placeholder="Pick status" />
            </SelectTrigger>
            <SelectContent>
              {NEXT_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          type="submit"
          className="bg-emerald-600 text-white hover:bg-emerald-700"
          disabled={submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Posting…
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" /> Post update
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
