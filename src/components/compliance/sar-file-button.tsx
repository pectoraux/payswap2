'use client';

import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface SarFileButtonProps {
  sarId: string;
}

export function SarFileButton({ sarId }: SarFileButtonProps) {
  const [busy, setBusy] = useState(false);

  async function file() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/trust/sars/${encodeURIComponent(sarId)}/file`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `File failed (${res.status})`);
      }
      toast.success(`SAR filed — ref ${data.sar.regulatorReference}`);
      setTimeout(() => window.location.reload(), 350);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'File failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={file}
      disabled={busy}
      className="h-7 gap-1 px-2 text-[11px] border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Send className="h-3 w-3" />
      )}
      File
    </Button>
  );
}
