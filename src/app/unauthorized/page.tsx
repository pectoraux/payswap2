import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ShieldAlert, ArrowLeft, ArrowRight } from 'lucide-react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Unauthorized page.
 *
 * Shown when a user attempts to access a route their role does not permit.
 * Directs them to the appropriate landing page based on their roles.
 */
export default async function UnauthorizedPage() {
  const session = await getServerSession(authOptions);
  const roles = ((session?.user as { roles?: string[] })?.roles) ?? [];

  const target =
    roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN')
      ? '/admin'
      : roles.some((r) => r === 'MERCHANT' || r === 'MERCHANT_STAFF')
        ? '/dashboard'
        : roles.some((r) => r === 'TREASURY')
          ? '/treasury'
          : roles.some((r) => r === 'COMPLIANCE')
            ? '/compliance'
            : roles.some((r) => r === 'LP')
              ? '/lp'
              : roles.some((r) => r === 'SUPPORT')
                ? '/support'
                : roles.some((r) => r === 'OPERATIONS')
                  ? '/ops'
                  : roles.some((r) => r === 'CUSTOMER')
                    ? '/portal'
                    : '/login';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-rose-500/5 p-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account doesn&apos;t have the required role. If you think this is a mistake, ask an
          administrator to update your permissions.
        </p>

        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" /> Back to home
            </Link>
          </Button>
          <Button asChild className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Link href={target}>
              Go to your dashboard <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        {!session?.user && (
          <div className="mt-6 text-xs text-muted-foreground">
            <Link href="/login" className="font-medium text-emerald-600 hover:underline">
              Sign in
            </Link>{' '}
            with a different account.
          </div>
        )}
      </div>
    </div>
  );
}
