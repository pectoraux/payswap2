'use client';

import { useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * "Rebuild Projections" button for the ops health page. This is a toast-only
 * action — the rebuild is a long-running job that's triggered out-of-band in
 * a real deployment. Here we just acknowledge the click so the SRE sees the
 * request was registered, mirroring the existing simulator pattern.
 */
export function RebuildProjectionsButton() {
  const [busy, setBusy] = useState(false);

  function handleClick() {
    setBusy(true);
    // Simulate the dispatch latency so the spinner is visible briefly.
    setTimeout(() => {
      setBusy(false);
      toast.success('Projection rebuild scheduled', {
        description:
          'Projections will be re-derived from the event stream in the background.',
      });
    }, 600);
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={busy}
      className="gap-1.5 border-teal-500/40 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="h-4 w-4" />
      )}
      Rebuild projections
    </Button>
  );
}
