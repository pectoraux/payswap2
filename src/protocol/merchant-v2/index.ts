/**
 * PaySwap Protocol — Merchant Platform (v2) — Barrel Export.
 *
 * The v2 merchant platform expands the original MerchantPlatform with the
 * full surface area needed for production merchant operations:
 *
 *   - Subscription billing        — `subscriptionService.{createPlan,subscribe,cancel,pause,resume,processBilling,...}`
 *   - Refunds                      — `refundService.{requestRefund,approveRefund,rejectRefund,processRefund,listRefunds,getRefundStats,...}`
 *   - Invoices                     — `invoiceService.{createInvoice,sendInvoice,markPaid,markOverdue,voidInvoice,generateInvoiceNumber,...}`
 *   - Catalogs                     — `catalogService.{createCatalog,addProduct,removeProduct,getCatalog,getByMerchant,getProducts}`
 *   - Payment requests             — `paymentRequestService.{createRequest,markPaid,cancel,expireStale,...}`
 *   - Organizations                — `organizationService.{createOrganization,addMerchant,removeMerchant,addMember,...}`
 *   - Team + RBAC                  — `teamService.{inviteMember,acceptInvitation,removeMember,updateRole,hasPermission,requirePermission,...}`
 *   - API keys                     — `apiKeyService.{createKey,revokeKey,rotateKey,validateKey,recordUsage,getUsageStats,...}`
 *   - OAuth2 provider              — `oauthService.{registerApp,authorize,exchangeCode,refreshToken,revokeToken,validateAccessToken}`
 *   - Webhook replay               — `webhookReplayService.{requestReplay,executeReplay,bulkReplay,...}`
 *
 * The kernel is FROZEN — this module imports only from `@/kernel/support`,
 * `@/kernel/event`, `@/protocol/webhooks/engine`, and intra-package
 * `./types`, `./subscriptions`, `./refunds`, `./invoices`, `./catalogs`,
 * `./payment-requests`, `./organizations`, `./team`, `./api-keys`,
 * `./oauth`, `./webhook-replay`. No kernel files are modified.
 */

// Types — re-export everything from `./types`.
export * from './types';

// Subscriptions.
export {
  SubscriptionService,
  subscriptionService,
  type CreatePlanParams,
} from './subscriptions';

// Refunds.
export {
  RefundService,
  refundService,
  type RefundStats,
} from './refunds';

// Invoices.
export {
  InvoiceService,
  invoiceService,
  type CreateInvoiceParams,
} from './invoices';

// Catalogs.
export {
  CatalogService,
  catalogService,
} from './catalogs';

// Payment requests.
export {
  PaymentRequestService,
  paymentRequestService,
  type CreatePaymentRequestParams,
} from './payment-requests';

// Organizations.
export {
  OrganizationService,
  organizationService,
  type CreateOrganizationParams,
} from './organizations';

// Team + RBAC.
export {
  TeamService,
  teamService,
  PermissionDeniedError,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  permissionsForRole,
} from './team';

// API keys.
export {
  ApiKeyService,
  apiKeyService,
  ALL_API_KEY_SCOPES,
  DEFAULT_API_KEY_SCOPES,
  type ApiKeyUsageStats,
  type ApiKeyValidation,
} from './api-keys';

// OAuth2.
export {
  OAuthService,
  oauthService,
  type RegisterAppParams,
  type AccessTokenValidation,
} from './oauth';

// Webhook replay.
export {
  WebhookReplayService,
  webhookReplayService,
  type BulkReplayFilter,
} from './webhook-replay';
