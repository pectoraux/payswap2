'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';

const TEMP_PASSWORD = 'Payswap123456';

export function WaitlistActions({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);

  const act = async (action: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/waitlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data?.error || 'Failed');
        return;
      }

      if (action === 'APPROVED') {
        const email = data?.credentials?.email || data?.user?.email;
        if (email) {
          // Show the temp credentials clearly and keep them on screen long
          // enough for the admin to copy them down before the page reloads.
          toast.success(`Approved! Login: ${email} / ${TEMP_PASSWORD}`, {
            duration: 6000,
          });
          toast.message(
            'A merchant workspace, user account and default wallet have been created. Share the credentials above with the applicant.',
            { duration: 6000 },
          );
        } else {
          toast.success('Approved');
        }
        // Give the admin a moment to read the credentials toast before the
        // page refresh wipes the row's PENDING status.
        setTimeout(() => window.location.reload(), 1500);
      } else {
        toast.success(`Entry ${action.toLowerCase()}`);
        setTimeout(() => window.location.reload(), 350);
      }
    } catch {
      toast.error('Failed');
    } finally {
      setLoading(false);
    }
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
