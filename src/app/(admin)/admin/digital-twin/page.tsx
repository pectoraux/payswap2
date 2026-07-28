import { DigitalTwinConsole } from '@/app/(developer)/developers/digital-twin/digital-twin-console';

export const dynamic = 'force-dynamic';

/**
 * /admin/digital-twin — admin mirror of the developer Digital Twin Console.
 *
 * Auth is enforced by the (admin) layout (requireAdmin). The same client
 * component is reused so feature parity is automatic.
 */
export default function AdminDigitalTwinPage() {
  return <DigitalTwinConsole />;
}
