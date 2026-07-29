import { requireAdmin } from '@/lib/auth-guards';
import { PageHeader } from '@/components/page-header';
import { proofOfReservesService } from '@/lib/proof-of-reserves';
import {
  ProofOfReservesViewer,
  type ProofOfReservesDTO,
} from './proof-of-reserves-viewer';

export const dynamic = 'force-dynamic';

/**
 * /admin/proof-of-reserves — admin console for Proof of Reserves.
 *
 * Generates a cryptographic proof that the system is solvent and twin tokens
 * are fully backed. The proof is rendered server-side on first load and can
 * be regenerated with the "Generate Proof" button.
 */
export default async function ProofOfReservesPage() {
  await requireAdmin();

  let initial: ProofOfReservesDTO | null = null;
  try {
    initial = await proofOfReservesService.generate();
  } catch {
    // Best-effort — the viewer gracefully handles the null state.
    initial = null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proof of Reserves"
        description="Cryptographic proof that the system is solvent and every twin token is fully backed by reserves."
      />
      <ProofOfReservesViewer initial={initial} />
    </div>
  );
}
