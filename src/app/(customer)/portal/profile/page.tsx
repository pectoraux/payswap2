import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { PageHeader } from '@/components/role-ui';
import {
  Mail,
  Phone,
  User,
  Globe,
  CalendarDays,
  ShieldCheck,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

function Field({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card/50 p-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="truncate text-sm font-medium">{value || '—'}</div>
      </div>
    </div>
  );
}

export default async function CustomerProfilePage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  const user = userId
    ? await db.user.findUnique({
        where: { id: userId },
        include: { roles: true },
      })
    : null;

  if (!user) {
    return (
      <div className="text-sm text-muted-foreground">Unable to load profile.</div>
    );
  }

  const account = await db.account.findFirst({
    where: { userId: user.id, type: 'CUSTOMER' },
    include: { customer: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Your personal details and account information."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Personal information</CardTitle>
            <CardDescription>
              Displayed to merchants when you check out.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field icon={<User className="h-4 w-4" />} label="Full name" value={user.name} />
              <Field icon={<Mail className="h-4 w-4" />} label="Email" value={user.email} />
              <Field icon={<Phone className="h-4 w-4" />} label="Phone" value={user.phone} />
              <Field
                icon={<Globe className="h-4 w-4" />}
                label="Country"
                value={account?.customer?.country ?? null}
              />
              <Field
                icon={<CalendarDays className="h-4 w-4" />}
                label="Joined"
                value={new Date(user.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              />
              <Field
                icon={<CalendarDays className="h-4 w-4" />}
                label="Last login"
                value={
                  user.lastLoginAt
                    ? new Date(user.lastLoginAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : null
                }
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </span>
                <StatusBadge status={user.status} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Role
                </span>
                <span className="rounded bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-400">
                  {user.roles[0]?.role || 'CUSTOMER'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Email verified
                </span>
                <span className="text-xs font-medium">
                  {user.emailVerified ? 'Yes' : 'Pending'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  MFA
                </span>
                <span className="text-xs font-medium">
                  {user.mfaEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer record</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {account?.customer ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Name</span>
                    <span className="font-medium">{account.customer.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Email</span>
                    <span className="font-medium truncate">{account.customer.email}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Phone</span>
                    <span className="font-medium">{account.customer.phone || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Country</span>
                    <span className="font-medium">{account.customer.country || '—'}</span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-amber-500" />
                  No customer record linked to this account.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
