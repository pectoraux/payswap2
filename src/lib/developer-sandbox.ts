/**
 * Developer Console — sandbox registry.
 *
 * The SandboxService issues random sandbox IDs at creation time. We want a
 * developer's sandbox to be stable across requests so the developer can
 * return to the same sandbox data later. This module keeps a per-process
 * map of `userId → sandboxId` so a developer always gets the same sandbox
 * back.
 */
import { sandboxService } from '@/protocol/developer';

const userSandboxMap = new Map<string, string>();

/**
 * Get or create the developer's personal sandbox.
 */
export function getOrCreateDeveloperSandbox(
  userId: string,
  merchantId: string | null,
): { id: string; state: string; apiKeys: unknown[]; connectors: unknown[]; customers: unknown[]; products: unknown[]; payments: unknown[]; invoices: unknown[]; createdAt: number; lastActivityAt: number; resetAt?: number } {
  const existing = userSandboxMap.get(userId);
  if (existing) {
    const s = (sandboxService as any).getSandbox(existing);
    if (s) return s;
  }
  // Create a new sandbox scoped to the developer's merchant (or a synthetic
  // merchant id if the developer has no merchant association).
  const created = (sandboxService as any).createSandbox(
    merchantId ?? `dev_${userId}`,
  );
  userSandboxMap.set(userId, created.id);
  return created;
}

/**
 * Reset the developer's sandbox in place — wipes customers/products/payments/
 * invoices and re-seeds the initial test data. API keys and connectors are
 * preserved.
 */
export function resetDeveloperSandbox(userId: string) {
  const sandboxId = userSandboxMap.get(userId);
  if (!sandboxId) {
    throw new Error('No sandbox found for this developer');
  }
  return (sandboxService as any).resetSandbox(sandboxId);
}

/**
 * Look up the developer's sandbox id (without creating one). Returns
 * undefined if the developer has no sandbox yet.
 */
export function peekDeveloperSandboxId(userId: string): string | undefined {
  return userSandboxMap.get(userId);
}
