import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ShieldX } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-emerald-500/5 p-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/10">
        <ShieldX className="h-8 w-8 text-rose-500" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Access denied</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        You don&apos;t have access to this page. If you believe this is a mistake, contact your administrator.
      </p>
      <Button asChild className="mt-6 bg-emerald-600 text-white hover:bg-emerald-700">
        <Link href="/login">Back to login</Link>
      </Button>
    </div>
  );
}
