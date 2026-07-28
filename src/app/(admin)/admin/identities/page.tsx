import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/auth-guards';
import { identityRegistry, identityEngine } from '@/identity';
import { IdentitiesManager, type IdentitySummary, type IdentityOverviewSnapshot } from './identities-manager';

export const dynamic = 'force-dynamic';

/**
 * /admin/identities — Identity OS dashboard.
 *
 * Shows the unified identity index: every PaySwap participant (person,
 * merchant, LP, organization, government, wallet, AI agent, device) in one
 * place, with their credentials, attestations, delegations, and recovery
 * methods.
 *
 * Admins can suspend / revoke / reactivate identities, add credentials and
 * attestations, create delegations, and add recovery methods from the UI.
 */
export default async function IdentitiesAdminPage() {
  await requireAdmin();

  // Load the initial state from the Identity Engine singleton. The manager
  // component refreshes via /api/identities/* after each action.
  const all = identityRegistry.list();
  const overview = identityEngine.overview();

  const identities: IdentitySummary[] = all.map((i) => ({
    id: i.id,
    type: i.type,
    name: i.name,
    entityId: i.entityId,
    entityType: i.entityType,
    trustScore: i.trustScore,
    trustLevel: i.trustLevel,
    status: i.status,
    credentialCount: i.credentials.length,
    attestationCount: i.attestations.length,
    delegationCount: i.delegations.length,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  }));

  // Sort newest first.
  identities.sort((a, b) => b.createdAt - a.createdAt);

  const snapshot: IdentityOverviewSnapshot = overview;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Identity OS"
        description="Unified identity index — people, merchants, LPs, organizations, governments, wallets, AI agents, and devices."
      />
      <IdentitiesManager identities={identities} overview={snapshot} />
    </div>
  );
}
