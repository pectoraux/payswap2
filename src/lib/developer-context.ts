/**
 * Developer Console context helpers.
 *
 * The developer portal is rooted at /developers and lets a developer exercise
 * the full PaySwap API surface against an isolated sandbox. A developer may
 * or may not also be a merchant — when they are, their API keys, webhooks
 * and other resources are scoped to that merchant. When they aren't (e.g.
 * the demo `developer@payswap.demo` user), we fall back to the first
 * merchant in the system so the developer can still create keys and
 * register endpoints without 404'ing.
 */
import { db } from '@/lib/db';

/**
 * Resolve the developer's merchantId — the merchant whose API keys, webhooks
 * and other resources the developer will manage. Falls back to the first
 * merchant in the system if the developer has no merchant association.
 */
export async function resolveDeveloperMerchantId(
  userId: string,
): Promise<string | null> {
  // Look for a UserRole that carries a merchantId (DEVELOPER, MERCHANT, or
  // MERCHANT_STAFF). Use the first one found — the demo user only has one.
  const role = await db.userRole.findFirst({
    where: {
      userId,
      role: { in: ['DEVELOPER', 'MERCHANT', 'MERCHANT_STAFF'] },
      merchantId: { not: null },
    },
    select: { merchantId: true },
  });
  if (role?.merchantId) return role.merchantId;

  // Fall back to the first merchant in the system. The developer portal is
  // intended for testing — having them act on the demo merchant is fine.
  const merchant = await db.merchant.findFirst({
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return merchant?.id ?? null;
}

/**
 * Resolve the developer's sandbox ID. We use a stable identifier derived
 * from the user id so the in-memory sandbox persists across page reloads
 * (within the lifetime of the server process).
 */
export function developerSandboxId(userId: string): string {
  return `sbx_dev_${userId}`;
}
