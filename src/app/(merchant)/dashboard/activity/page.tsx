import { requireMerchant } from '@/lib/auth-guards';
import { ActivityFeed } from '@/components/activity-feed';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function ActivityPage() {
  // requireMerchant() throws if the caller isn't a merchant / merchant staff
  // member. The (merchant) layout already redirects unauthenticated users to
  // /login, so this throws → the error boundary renders a friendly message.
  let merchantName = 'your business';
  try {
    const { merchant } = await requireMerchant();
    merchantName = merchant.name;
  } catch {
    return (
      <div className="text-sm text-muted-foreground">
        No merchant account found.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Activity Feed</h1>
        <p className="text-sm text-muted-foreground">
          Every payment, payout, refund, webhook delivery, and audit event for{' '}
          <span className="font-medium text-foreground">{merchantName}</span>,
          merged into a single timeline.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Timeline</CardTitle>
          <CardDescription>
            Auto-refreshes every 30 seconds. Use the filters to narrow by type.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityFeed
            variant="page"
            pageSize={50}
            showFilters
            emptyMessage="No activity yet"
          />
        </CardContent>
      </Card>
    </div>
  );
}
