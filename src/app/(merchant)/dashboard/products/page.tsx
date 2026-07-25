import { Plus, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { formatCurrency, statusBadgeClass } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const { merchant } = await requireMerchant();

  const products = await db.product.findMany({
    where: { merchantId: merchant.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Items you sell. Generate checkout links or QR codes from any product."
        actions={
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> New Product
          </Button>
        }
      />

      {products.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Package className="h-5 w-5" />}
            title="No products yet"
            description="Add your first product to start generating payment links, QR codes, and checkout URLs."
            action={{ label: 'New product', href: '/dashboard/products' }}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <Card key={p.id} className="overflow-hidden transition-colors hover:border-emerald-500/30">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{p.name}</div>
                    <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {p.type.replace(/_/g, ' ')}
                    </div>
                  </div>
                  <Badge variant="outline" className={statusBadgeClass(p.status)}>
                    {p.status}
                  </Badge>
                </div>
                <p className="line-clamp-2 min-h-[2.5rem] text-xs text-muted-foreground">
                  {p.description ?? 'No description provided.'}
                </p>
                <div className="flex items-center justify-between border-t pt-3">
                  <div className="text-lg font-semibold">
                    {formatCurrency(p.price, p.currency)}
                  </div>
                  <Button size="sm" variant="outline">Share</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
