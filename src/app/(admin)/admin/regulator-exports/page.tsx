import { requireAdmin } from '@/lib/auth-guards';
import { PageHeader } from '@/components/page-header';
import { RegulatorExportsViewer } from './regulator-exports-viewer';

export const dynamic = 'force-dynamic';

/**
 * /admin/regulator-exports — admin console for generating regulator exports.
 *
 * Lets the admin pick a report type (full / AML / Travel Rule / Proof of
 * Reserves / Audit Trail) and a date range, then calls
 * /api/regulatory/export to generate a structured, hash-signed JSON payload.
 */
export default async function RegulatorExportsPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Regulator Exports"
        description="Generate cryptographically-signed compliance exports for regulators (AML, Travel Rule, Proof of Reserves, Audit Trail)."
      />
      <RegulatorExportsViewer />
    </div>
  );
}
