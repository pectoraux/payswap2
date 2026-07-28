'use client';

import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface TravelRuleTransmitButtonProps {
  recordId: string;
}

export function TravelRuleTransmitButton({
  recordId,
}: TravelRuleTransmitButtonProps) {
  const [busy, setBusy] = useState(false);

  async function transmit() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/trust/travel-rule/${encodeURIComponent(recordId)}/transmit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Transmit failed (${res.status})`);
      }
      toast.success('Travel rule record transmitted');
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Transmit failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={transmit}
      disabled={busy}
      className="h-7 gap-1 px-2 text-[11px] border-teal-500/40 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Send className="h-3 w-3" />
      )}
      Transmit
    </Button>
  );
}
