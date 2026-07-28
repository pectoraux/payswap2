/**
 * Structured Logger — replaces console.log with structured JSON logging. (L-1, L-2)
 *
 * Features:
 *   - JSON-structured output (parseable by log aggregators: Datadog, Loki, etc.)
 *   - Correlation IDs (requestId, transactionId) for distributed tracing (L-2)
 *   - Log levels: debug, info, warn, error
 *   - Context propagation via AsyncLocalStorage
 *   - Sensitive field redaction (passwords, tokens, secrets)
 *   - Performance: minimal overhead when level is filtered out
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Payment created', { paymentId, amount, currency });
 *
 *   // With correlation context:
 *   logger.setRequestContext({ requestId, correlationId });
 *   logger.info('Processing payment'); // automatically includes requestId
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

interface RequestContext {
  requestId?: string;
  correlationId?: string;
  userId?: string;
  merchantId?: string;
  environment?: string;
}

// Sensitive fields to redact
const SENSITIVE_FIELDS = new Set([
  'password', 'passwordHash', 'secret', 'token', 'apiKey', 'api_key',
  'authorization', 'cookie', 'sessionToken', 'mfaSecret', 'cvv',
  'cardNumber', 'accountNumber', 'routingNumber',
]);

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// AsyncLocalStorage for request context propagation
import { AsyncLocalStorage } from 'async_hooks';

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

class Logger {
  private minLevel: LogLevel;
  private isProduction: boolean;

  constructor() {
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  /**
   * Set the minimum log level.
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Run a function with a request context (for correlation ID propagation).
   * All log calls within the function will automatically include the context.
   */
  withContext<T>(ctx: RequestContext, fn: () => T): T {
    const parent = requestContextStorage.getStore();
    return requestContextStorage.run(
      { ...parent, ...ctx },
      fn,
    );
  }

  /**
   * Get the current request context (if any).
   */
  getContext(): RequestContext | undefined {
    return requestContextStorage.getStore();
  }

  debug(msg: string, context?: LogContext): void {
    this.log('debug', msg, context);
  }

  info(msg: string, context?: LogContext): void {
    this.log('info', msg, context);
  }

  warn(msg: string, context?: LogContext): void {
    this.log('warn', msg, context);
  }

  error(msg: string, context?: LogContext, error?: Error): void {
    this.log('error', msg, {
      ...context,
      ...(error ? {
        errorName: error.name,
        errorMessage: error.message,
        errorStack: this.isProduction ? undefined : error.stack,
      } : {}),
    });
  }

  private log(level: LogLevel, msg: string, context?: LogContext): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

    const requestCtx = requestContextStorage.getStore();
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      msg,
      ...requestCtx,
      ...(context ? this.redact(context) : {}),
    };

    if (this.isProduction) {
      // Production: JSON to stdout (for log aggregators)
      process.stdout.write(JSON.stringify(entry) + '\n');
    } else {
      // Development: colored console output
      const color = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : level === 'info' ? '\x1b[36m' : '\x1b[90m';
      const reset = '\x1b[0m';
      const ctxStr = context ? ' ' + JSON.stringify(this.redact(context)) : '';
      const reqStr = requestCtx?.requestId ? ` [${requestCtx.requestId.slice(0, 8)}]` : '';
      process.stdout.write(`${color}[${level.toUpperCase()}]${reset} ${entry.timestamp} ${reqStr} ${msg}${ctxStr}\n`);
    }
  }

  /**
   * Redact sensitive fields from a context object.
   */
  private redact(obj: LogContext): LogContext {
    const result: LogContext = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.redact(value as LogContext);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}

// Singleton logger
export const logger = new Logger();

// Middleware helper for Next.js API routes
import type { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';

/**
 * Wrap an API handler with request context (requestId, correlationId).
 * Automatically propagates these IDs through all log calls within the handler.
 */
export function withRequestContext<T extends (...args: any[]) => any>(
  handler: T,
): T {
  return ((req: NextRequest, ...args: any[]) => {
    const requestId = req.headers.get('x-request-id') || randomUUID();
    const correlationId = req.headers.get('x-correlation-id') || requestId;

    return logger.withContext(
      { requestId, correlationId },
      () => handler(req, ...args),
    );
  }) as T;
}
