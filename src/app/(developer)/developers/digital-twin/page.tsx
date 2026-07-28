import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { DigitalTwinConsole } from './digital-twin-console';

export const dynamic = 'force-dynamic';

export default async function DeveloperDigitalTwinPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as { roles?: string[] })?.roles;
  if (
    !roles ||
    !roles.some((r) =>
      ['DEVELOPER', 'ADMIN', 'SUPER_ADMIN', 'MERCHANT', 'MERCHANT_STAFF'].includes(r),
    )
  ) {
    redirect('/unauthorized');
  }

  return <DigitalTwinConsole />;
}
