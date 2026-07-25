'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, RefreshCw, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[400px] items-center justify-center p-4">
      <Card className="max-w-md w-full border-emerald-500/20">
        <CardContent className="pt-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10">
            <AlertCircle className="h-6 w-6 text-rose-500" />
          </div>
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="mt-1 text-sm text-muted-foreground line-clamp-3 break-words">
            {error.message || 'An unexpected error occurred'}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={reset} variant="outline" size="sm" className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </Button>
            <Button asChild size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
              <Link href="/treasury">
                <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
