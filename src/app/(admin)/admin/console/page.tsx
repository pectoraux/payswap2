import { requireAdmin } from '@/lib/auth-guards';
import { PlatformConsole } from '@/components/showcase/platform-console';

export const dynamic = 'force-dynamic';

export default async function AdminConsolePage() {
  await requireAdmin();
  return <PlatformConsole />;
}
