import { UserCog } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { formatDate, formatRelative, statusBadgeClass } from '@/lib/format';
import { InviteTeamMemberDialog } from '@/components/merchant/invite-team-member-dialog';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const { merchant } = await requireMerchant();

  const members = await db.teamMember.findMany({
    where: { merchantId: merchant.id },
    orderBy: { invitedAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="Invite teammates and grant scoped access to your merchant account."
        actions={<InviteTeamMemberDialog />}
      />

      {members.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UserCog className="h-5 w-5" />}
            title="No team members yet"
            description="Invite teammates to help manage payments, payouts, and analytics. Each member gets a scoped role with granular permissions."
            action={{ label: 'Invite member', href: '/dashboard/settings/team' }}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Invited</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      {m.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(m.status)}>
                      {m.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.joinedAt ? formatDate(m.joinedAt) : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelative(m.invitedAt)}
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
