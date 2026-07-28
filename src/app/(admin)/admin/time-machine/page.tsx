import { TimeMachineConsole } from '@/app/(developer)/developers/time-machine/time-machine-console';

export const dynamic = 'force-dynamic';

/**
 * /admin/time-machine — admin mirror of the developer Runtime Time Machine.
 *
 * Auth is enforced by the (admin) layout (requireAdmin). The same client
 * component is reused so feature parity is automatic.
 */
export default function AdminTimeMachinePage() {
  return <TimeMachineConsole />;
}
