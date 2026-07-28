/**
 * Idempotency helpers for API routes. (H-2 fix.)
 *
 * Clients can pass an `Idempotency-Key` header to safely retry requests
 * without creating duplicate transactions. The key is used as the
 * dispatcher's commandId, so the IdempotencyStore can deduplicate.
 */

import type { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';

/**
 * Extract the idempotency key from the request header.
 * If not provided, generates a new UUID (so every request has one).
 */
export function getIdempotencyKey(req: NextRequest): string {
  const header = req.headers.get('idempotency-key');
  if (header && header.trim().length > 0) {
    return header.trim();
  }
  // Generate a new key — the request will be processed as unique
  return randomUUID();
}

/**
 * Validate an idempotency key format (alphanumeric + dashes, max 128 chars).
 */
export function isValidIdempotencyKey(key: string): boolean {
  if (!key || key.length === 0 || key.length > 128) return false;
  return /^[a-zA-Z0-9_-]+$/.test(key);
}
