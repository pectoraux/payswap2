/**
 * Services barrel export + initialization.
 *
 * Importing this module:
 *   1. Registers all event projections (audit log, webhooks, customer stats)
 *   2. Exports all application services
 *
 * The API routes and world simulator import services from here.
 */

// Register projections (side-effect on import)
import './projections';

// Export services
export { eventBus, createEvent, type DomainEvent } from './event-bus';
export { paymentService, type CreatePaymentParams, type PaymentResult } from './payment-service';
export { payoutService, type CreatePayoutParams } from './payout-service';
export { refundService, type CreateRefundParams } from './refund-service';
export { invoiceService, type CreateInvoiceParams } from './invoice-service';
export { customerService, type CreateCustomerParams } from './customer-service';
