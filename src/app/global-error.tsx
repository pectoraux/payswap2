'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        <div className="flex min-h-screen items-center justify-center p-4">
          <Card className="max-w-md w-full border-emerald-500/20">
            <CardContent className="pt-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10">
                <AlertCircle className="h-6 w-6 text-rose-500" />
              </div>
              <h2 className="text-lg font-semibold">Application error</h2>
              <p className="mt-1 text-sm text-muted-foreground line-clamp-3 break-words">
                {error.message ||
                  'A critical error occurred while loading the application.'}
              </p>
              <div className="mt-6 flex justify-center">
                <Button
                  onClick={reset}
                  size="sm"
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Try again
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </body>
    </html>
  );
}
