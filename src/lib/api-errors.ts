/**
 * Standardized API Error Handler (L-4)
 *
 * All API routes should use these helpers to return consistent error
 * responses. This replaces ad-hoc { error: string } / { ok: false, error }
 * patterns with a unified format.
 *
 * Standard error response format:
 *   {
 *     ok: false,
 *     error: {
 *       code: string,       // machine-readable error code
 *       message: string,    // human-readable message
 *       details?: any,      // optional structured details
 *     },
 *     requestId?: string,   // correlation ID for tracing
 *   }
 */

import { NextResponse } from 'next/server';
import { logger } from './logger';

// ─── Error Codes ───────────────────────────────────────────────────────────

export const ErrorCodes = {
  // Auth errors (401)
  UNAUTHORIZED: 'UNAUTHORIZED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',

  // Authorization errors (403)
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_ROLE: 'INSUFFICIENT_ROLE',

  // Validation errors (400)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_CURRENCY: 'INVALID_CURRENCY',
  INVALID_METHOD: 'INVALID_METHOD',

  // Business logic errors (400/409)
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  REFUND_EXCEEDS_PAYMENT: 'REFUND_EXCEEDS_PAYMENT',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',

  // Rate limiting (429)
  RATE_LIMITED: 'RATE_LIMITED',

  // Invariant / constitution errors (500)
  INVARIANT_VIOLATION: 'INVARIANT_VIOLATION',
  SOLVENCY_VIOLATION: 'SOLVENCY_VIOLATION',

  // System errors (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  DISPATCH_FAILED: 'DISPATCH_FAILED',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// ─── Error Response Helper ─────────────────────────────────────────────────

interface ApiErrorOptions {
  code: ErrorCode;
  message: string;
  statusCode: number;
  details?: unknown;
  requestId?: string;
}

/**
 * Create a standardized error response.
 */
export function apiError(opts: ApiErrorOptions): NextResponse {
  const { code, message, statusCode, details, requestId } = opts;

  // Log the error (with context for tracing)
  if (statusCode >= 500) {
    logger.error('API error', { code, message, statusCode, requestId, details });
  } else if (statusCode >= 400) {
    logger.warn('API client error', { code, message, statusCode, requestId });
  }

  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
      ...(requestId ? { requestId } : {}),
    },
    { status: statusCode },
  );
}

// ─── Success Response Helper ───────────────────────────────────────────────

/**
 * Create a standardized success response.
 */
export function apiSuccess<T>(data: T, statusCode: number = 200): NextResponse {
  return NextResponse.json(
    { ok: true, ...data },
    { status: statusCode },
  );
}

// ─── Common Error Helpers ──────────────────────────────────────────────────

export const errors = {
  unauthorized: (requestId?: string) =>
    apiError({ code: ErrorCodes.UNAUTHORIZED, message: 'Authentication required', statusCode: 401, requestId }),

  forbidden: (requestId?: string) =>
    apiError({ code: ErrorCodes.FORBIDDEN, message: 'Insufficient permissions', statusCode: 403, requestId }),

  forbiddenRole: (requiredRole: string, requestId?: string) =>
    apiError({ code: ErrorCodes.INSUFFICIENT_ROLE, message: `Requires role: ${requiredRole}`, statusCode: 403, requestId }),

  notFound: (resource: string, requestId?: string) =>
    apiError({ code: ErrorCodes.PAYMENT_NOT_FOUND, message: `${resource} not found`, statusCode: 404, requestId }),

  validation: (details: unknown, requestId?: string) =>
    apiError({ code: ErrorCodes.VALIDATION_ERROR, message: 'Validation failed', statusCode: 400, details, requestId }),

  insufficientFunds: (requestId?: string) =>
    apiError({ code: ErrorCodes.INSUFFICIENT_FUNDS, message: 'Insufficient funds', statusCode: 400, requestId }),

  rateLimited: (retryAfterSec: number, requestId?: string) =>
    apiError({
      code: ErrorCodes.RATE_LIMITED,
      message: 'Too many requests. Please try again later.',
      statusCode: 429,
      details: { retryAfter: retryAfterSec },
      requestId,
    }),

  invariantViolation: (violations: string[], requestId?: string) =>
    apiError({
      code: ErrorCodes.INVARIANT_VIOLATION,
      message: 'Transaction rejected by constitution',
      statusCode: 500,
      details: { violations },
      requestId,
    }),

  dispatchFailed: (error: string, requestId?: string) =>
    apiError({ code: ErrorCodes.DISPATCH_FAILED, message: error, statusCode: 500, requestId }),

  internal: (error: string, requestId?: string) =>
    apiError({ code: ErrorCodes.INTERNAL_ERROR, message: error, statusCode: 500, requestId }),

  badRequest: (message: string, requestId?: string) =>
    apiError({ code: ErrorCodes.VALIDATION_ERROR, message, statusCode: 400, requestId }),
};

// ─── Error Handler Wrapper ─────────────────────────────────────────────────

/**
 * Wrap an API handler with standardized error handling.
 * Catches thrown errors and returns a consistent error response.
 */
export function withErrorHandler<T extends (...args: any[]) => Promise<NextResponse>>(
  handler: T,
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      // Check for known error patterns
      if (message.includes('INSUFFICIENT_FUNDS')) {
        return errors.insufficientFunds();
      }
      if (message.includes('Invariant violation')) {
        return errors.invariantViolation([message]);
      }
      if (message.includes('dispatch failed') || message.includes('Dispatch failed')) {
        return errors.dispatchFailed(message);
      }

      // Default to internal error
      return errors.internal(message);
    }
  }) as T;
}
