import { requireAdmin } from '@/lib/auth-guards';
import { PageHeader } from '@/components/page-header';
import { settlementContractEngine } from '@/runtime/liquidity';
import type { SettlementContract } from '@/runtime/liquidity';
import {
  SettlementContractsViewer,
  type SettlementContractDTO,
} from './settlement-contracts-viewer';

export const dynamic = 'force-dynamic';

function serialize(c: SettlementContract): SettlementContractDTO {
  return { ...c };
}

/**
 * /admin/settlement-contracts — admin console for settlement contracts.
 *
 * Lists every settlement contract in the runtime (with a status filter and
 * full-text search). Click a contract to open a detail Sheet showing its full
 * lifecycle (created → funded → claimed → accepted → awaiting recipient →
 * confirmed → released → closed) and escrow/amount details.
 */
export default async function SettlementContractsPage() {
  await requireAdmin();

  const contracts = settlementContractEngine.list();
  const initial: SettlementContractDTO[] = contracts.map(serialize);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settlement Contracts"
        description="Every escrowed cross-border settlement in the runtime, from creation through release. Click a contract for the full lifecycle."
      />
      <SettlementContractsViewer initial={initial} />
    </div>
  );
}
