'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface RiskRecomputeButtonProps {
  entityId: string;
}

export function RiskRecomputeButton({ entityId }: RiskRecomputeButtonProps) {
  const [busy, setBusy] = useState(false);

  async function recompute() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/trust/risk/${encodeURIComponent(entityId)}/recompute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Recompute failed (${res.status})`);
      }
      toast.success(`Risk score recomputed: ${data.score.score.toFixed(1)} (${data.score.level})`);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Recompute failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={recompute}
      disabled={busy}
      className="h-7 gap-1 px-2 text-[11px]"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <RefreshCw className="h-3 w-3" />
      )}
      Recompute
    </Button>
  );
}
