/**
 * PaySwap Protocol — Operational Readiness — Distributed Correlation IDs.
 *
 * Uses Node's `AsyncLocalStorage` to propagate a `CorrelationContext`
 * (traceId + spanId + parentSpanId + requestId/userId/merchantId) across
 * async boundaries without explicit parameter passing. This mirrors the
 * OpenTelemetry `Context` propagation model so that swapping to the real
 * `@opentelemetry/api` package later is mechanical.
 *
 * Conventions:
 *   - `traceId`  : 32-char lowercase hex (OTel W3C trace-id).
 *   - `spanId`   : 16-char lowercase hex (OTel W3C span-id).
 *   - `requestId`: opaque string from the `x-request-id` header (or generated).
 *
 * Headers (HTTP):
 *   - `x-trace-id`    : the traceId
 *   - `x-span-id`     : the current spanId (propagated downstream)
 *   - `x-request-id`  : the requestId (propagated downstream)
 *
 * Nesting semantics:
 *   `withCorrelation(ctx, fn)` always creates a NEW spanId. If a parent
 *   context is active, its `spanId` becomes the new context's
 *   `parentSpanId`, and its `traceId` is inherited (unless overridden by
 *   `ctx.traceId`). This means nested `withCorrelation` calls naturally
 *   build a span tree, exactly like OTel's `context.with(span)`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';

/** A correlation context — propagated across async boundaries. */
export interface CorrelationContext {
  /** 32-char hex trace ID. */
  traceId: string;
  /** 16-char hex span ID. */
  spanId: string;
  /** Parent span ID (set when nested inside another correlation context). */
  parentSpanId?: string;
  /** Request ID from the inbound HTTP request (x-request-id header). */
  requestId?: string;
  /** Authenticated user ID (if known). */
  userId?: string;
  /** Merchant ID (if known). */
  merchantId?: string;
}

/** The async-local storage holding the active correlation context. */
const correlationAls = new AsyncLocalStorage<CorrelationContext>();

/** Generate a new 32-char lowercase-hex trace ID (OTel W3C). */
export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

/** Generate a new 16-char lowercase-hex span ID (OTel W3C). */
export function newSpanId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Returns the currently-active correlation context, or `undefined` if none.
 * Safe to call from anywhere (the AsyncLocalStorage returns undefined
 * outside a `withCorrelation` scope).
 */
export function currentCorrelation(): CorrelationContext | undefined {
  return correlationAls.getStore();
}

/**
 * Run `fn` inside a new correlation context.
 *
 * If a parent context is active, the new context inherits `traceId` and
 * sets `parentSpanId` to the parent's `spanId` — creating a child span.
 * Explicit fields on `ctx` take precedence over inherited ones.
 *
 * Returns whatever `fn` returns (sync). For async `fn`, the returned
 * promise resolves within the new context's lifetime (because
 * `AsyncLocalStorage.run` propagates across awaited promises).
 */
export function withCorrelation<T>(
  ctx: Partial<CorrelationContext>,
  fn: () => T,
): T {
  const parent = correlationAls.getStore();
  const child: CorrelationContext = {
    traceId: ctx.traceId ?? parent?.traceId ?? newTraceId(),
    spanId: ctx.spanId ?? newSpanId(),
    parentSpanId: ctx.parentSpanId ?? parent?.spanId,
    requestId: ctx.requestId ?? parent?.requestId,
    userId: ctx.userId ?? parent?.userId,
    merchantId: ctx.merchantId ?? parent?.merchantId,
  };
  return correlationAls.run(child, fn);
}

/**
 * Run `fn` inside an EXACT correlation context (no merging with a parent).
 * Used internally by the tracing module to enter a context that matches an
 * already-created Span — bypassing the child-span creation of `withCorrelation`.
 */
export function enterCorrelation<T>(ctx: CorrelationContext, fn: () => T): T {
  return correlationAls.run(ctx, fn);
}

/**
 * Extract (or generate) a correlation context from a Next.js request's
 * headers, then run `fn` inside it.
 *
 * Headers read:
 *   - `x-trace-id`    → traceId (generated if missing)
 *   - `x-span-id`     → spanId (generated if missing)
 *   - `x-request-id`  → requestId (optional)
 *
 * This is the standard entry point for inbound HTTP handlers — call it at
 * the top of a route handler to establish the correlation context for the
 * entire request lifecycle.
 */
export function withRequest<T>(req: NextRequest, fn: () => T): T {
  const traceId = req.headers.get('x-trace-id') ?? newTraceId();
  const spanId = req.headers.get('x-span-id') ?? newSpanId();
  const requestId = req.headers.get('x-request-id') ?? undefined;
  return withCorrelation({ traceId, spanId, requestId }, fn);
}

/**
 * Returns the HTTP headers that should be propagated to downstream
 * services to continue the current trace.
 *
 *   { 'x-trace-id': '...', 'x-span-id': '...', 'x-request-id': '...' }
 *
 * Returns an empty object if no correlation context is active.
 */
export function correlationHeaders(): Record<string, string> {
  const ctx = correlationAls.getStore();
  if (!ctx) return {};
  const headers: Record<string, string> = {
    'x-trace-id': ctx.traceId,
    'x-span-id': ctx.spanId,
  };
  if (ctx.requestId) headers['x-request-id'] = ctx.requestId;
  return headers;
}

/**
 * Attach additional identity fields (userId, merchantId) to the current
 * correlation context by re-entering a child context. Useful after auth
 * completes mid-request — subsequent logs/spans will carry the identity.
 */
export function withIdentity<T>(
  identity: { userId?: string; merchantId?: string },
  fn: () => T,
): T {
  return withCorrelation(identity, fn);
}
