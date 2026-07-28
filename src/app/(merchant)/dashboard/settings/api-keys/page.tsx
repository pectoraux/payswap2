import { KeyRound } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { formatRelative, statusBadgeClass } from '@/lib/format';
import { CreateApiKeyDialog } from '@/components/merchant/create-api-key-dialog';

export const dynamic = 'force-dynamic';

function parseScopes(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export default async function ApiKeysPage() {
  const { merchant } = await requireMerchant();

  const keys = await db.apiKey.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Keys"
        description="Use API keys to authenticate requests to the PaySwap REST API."
        actions={<CreateApiKeyDialog />}
      />

      {keys.length === 0 ? (
        <Card>
          <EmptyState
            icon={<KeyRound className="h-5 w-5" />}
            title="No API keys yet"
            description="Create a key to start integrating PaySwap. Keys come in test and live modes — test keys never move real money."
            action={{ label: 'Create key', href: '/dashboard/settings/api-keys' }}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => {
                const scopes = parseScopes(k.scopes);
                return (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.label}</TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-2 py-0.5 text-xs font-mono">
                        {k.keyPrefix}…
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[260px] flex-wrap gap-1">
                        {scopes.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No scopes</span>
                        ) : (
                          scopes.map((s) => (
                            <Badge key={s} variant="secondary" className="text-[10px]">
                              {s}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelative(k.lastUsedAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusBadgeClass(k.status)}>
                        {k.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelative(k.createdAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card className="border-emerald-500/15 bg-emerald-500/5">
        <EmptyState
          icon={<KeyRound className="h-5 w-5" />}
          title="Keep your keys safe"
          description="Never share secret keys in client-side code, public repos, or support channels. Rotate keys immediately if you suspect a leak."
        />
      </Card>
    </div>
  );
}
