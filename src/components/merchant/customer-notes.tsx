'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface CustomerNotesProps {
  /** CustomerRecord ID the notes belong to. */
  customerId: string;
  /** Initial notes text (parsed from metadata.notes). */
  initialNotes: string;
  /** ISO timestamp of the last notes update, if any. */
  initialUpdatedAt?: string | null;
}

/**
 * CustomerNotes — inline notes editor for a customer record.
 *
 * The notes are persisted to CustomerRecord.metadata (JSON) via
 * PATCH /api/customers/[id]/notes. The textarea is uncontrolled-ish: we
 * keep a local draft and only persist on explicit save so the merchant
 * can experiment without clobbering existing notes.
 */
export function CustomerNotes({
  customerId,
  initialNotes,
  initialUpdatedAt,
}: CustomerNotesProps) {
  const [draft, setDraft] = useState(initialNotes);
  const [updatedAt, setUpdatedAt] = useState<string | null>(
    initialUpdatedAt ?? null,
  );
  const [saving, setSaving] = useState(false);
  // Track the last successfully-saved draft so the Save button reflects
  // real unsaved changes rather than just diffing against the prop.
  const [savedBaseline, setSavedBaseline] = useState(initialNotes);

  // If the server-rendered initial notes change (e.g. after a parent
  // refresh), resync the draft and the saved baseline.
  useEffect(() => {
    setDraft(initialNotes);
    setSavedBaseline(initialNotes);
  }, [initialNotes]);

  function fmtTimestamp(iso: string | null) {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save notes');
      }
      toast.success('Notes saved');
      setUpdatedAt(data?.updatedAt ?? null);
      // Realign the "dirty" baseline so the Save button disables.
      // We can't mutate the prop, so we track the saved value locally.
      setSavedBaseline(draft);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save notes');
    } finally {
      setSaving(false);
    }
  }

  const hasUnsavedChanges = draft !== savedBaseline;
  const lastSavedLabel = fmtTimestamp(updatedAt);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <StickyNote className="h-3.5 w-3.5 text-emerald-500" />
        <span>
          Private notes about this customer — only visible to your team.
        </span>
      </div>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Add context about this customer: preferences, history, risk notes…"
        className="min-h-28 resize-y"
        maxLength={10000}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {lastSavedLabel ? `Last saved ${lastSavedLabel}` : 'Not saved yet'}
          {' · '}
          {draft.length.toLocaleString()} / 10,000
        </span>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={saving || !hasUnsavedChanges}
          className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save notes
        </Button>
      </div>
    </div>
  );
}
