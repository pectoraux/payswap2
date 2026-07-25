import { redirect } from 'next/navigation';
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
import { Package } from 'lucide-react';
import { CreateProductDialog } from '@/components/merchant/create-product-dialog';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session?.user as any)?.id;
  const userRole = await db.userRole.findFirst({
    where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF'] } },
  });
  const merchantId = userRole?.merchantId;
  if (!merchantId) redirect('/unauthorized');

  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  const products = await db.product.findMany({
    where: { merchantId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  const fmt = (n: number, c: string = merchant?.currency || 'GHS') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground">
            Catalog items your customers can purchase.
          </p>
        </div>
        <CreateProductDialog />
      </div>

      {products.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Package className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No products yet</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Add products to start selling through PaySwap checkout.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <StatusBadge status={p.status} />
                </div>
                <CardDescription className="line-clamp-2 min-h-[2.5rem]">
                  {p.description || 'No description provided.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Price
                    </div>
                    <div className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {fmt(p.price, p.currency)}
                    </div>
                  </div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {p.type}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
