import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Users as UsersIcon } from 'lucide-react';
import { requireAdmin } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { formatDate, formatRelative, statusBadgeClass } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  await requireAdmin();

  const users = await db.user.findMany({
    include: { roles: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Every account on the PaySwap platform."
      />

      {users.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UsersIcon className="h-5 w-5" />}
            title="No users yet"
            description="When people sign up — either via waitlist approval or directly — they'll be listed here."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Last login</TableHead>
                <TableHead className="text-right">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <div className="flex max-w-[260px] flex-wrap gap-1">
                      {u.roles.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No roles</span>
                      ) : (
                        u.roles.map((r) => (
                          <Badge
                            key={r.id}
                            variant="outline"
                            className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]"
                          >
                            {r.role}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(u.status)}>
                      {u.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatRelative(u.lastLoginAt)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(u.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
