/**
 * PaySwap TypeScript SDK — barrel export.
 *
 * Import everything the SDK exposes from this module:
 *
 *   ```ts
 *   import {
 *     PaySwapClient,
 *     PaySwapError,
 *     AuthenticationError,
 *     RateLimitError,
 *     type Payment,
 *     type CreatePaymentRequest,
 *   } from '@payswap/sdk-typescript';
 *   ```
 */
export { PaySwapClient, PaymentsResource, PayoutsResource, MerchantsResource, WebhooksResource, CustomersResource, ProductsResource, InvoicesResource } from './client';
export * from './types';
export {
  PaySwapError,
  AuthenticationError,
  InvalidRequestError,
  RateLimitError,
  NotFoundError,
  ServerError,
} from './errors';

/** Current SDK version. */
export const VERSION = '1.0.0';
