import { requireAdmin } from '@/lib/auth-guards';
import { PageHeader } from '@/components/page-header';
import { settlementContractEngine } from '@/runtime/liquidity';
import type { SettlementContract } from '@/runtime/liquidity';
import {
  SettlementTimelineViewer,
  type SettlementContractDTO,
} from './settlement-timeline-viewer';

export const dynamic = 'force-dynamic';

/**
 * /admin/settlement-timeline — visual settlement contract lifecycle.
 *
 * Lists every settlement contract in the runtime and renders each one's
 * lifecycle as a horizontal timeline (Created → Funded → Claimed →
 * Accepted → AwaitingRecipient → Confirmed → Released → Closed).
 * Completed steps are green, pending steps are gray, and the current
 * step is highlighted. Filter by status, search by contract ID, and
 * click a contract to see full detail.
 */
export default async function SettlementTimelinePage() {
  await requireAdmin();

  const contracts = settlementContractEngine.list();
  const dto: SettlementContractDTO[] = contracts.map(serialize);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settlement Timeline"
        description="Every escrowed contract as a visual lifecycle — Created → Funded → Claimed → Confirmed → Released → Closed."
      />
      <SettlementTimelineViewer initial={dto} />
    </div>
  );
}

function serialize(c: SettlementContract): SettlementContractDTO {
  return { ...c };
}
