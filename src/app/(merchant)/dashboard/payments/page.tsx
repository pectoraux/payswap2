import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { PaymentsTable, type PaymentRow } from '@/components/merchant/payments-table';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function PaymentsPage() {
  const { merchant } = await requireMerchant();

  const payments = await db.payment.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const rows: PaymentRow[] = payments.map((p) => ({
    id: p.id,
    reference: p.reference,
    amount: p.amount,
    currency: p.currency,
    method: p.method,
    status: p.status,
    description: p.description,
    createdAt: p.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="All payments accepted by your merchant account."
        actions={
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> New Payment Link
          </Button>
        }
      />
      <PaymentsTable payments={rows} />
    </div>
  );
}
