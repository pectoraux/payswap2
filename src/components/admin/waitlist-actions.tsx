'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';

export function WaitlistActions({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);
  const act = async (action: string) => {
    setLoading(true);
    const res = await fetch('/api/admin/waitlist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    setLoading(false);
    if (res.ok) toast.success(`Entry ${action.toLowerCase()}`);
    else toast.error('Failed');
    window.location.reload();
  };
  return (
    <div className="flex gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={loading}
        onClick={() => act('APPROVED')}
        className="h-7 text-xs text-emerald-600"
      >
        <Check className="h-3 w-3" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={loading}
        onClick={() => act('REJECTED')}
        className="h-7 text-xs text-rose-600"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
