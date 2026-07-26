/**
 * Customer Service — single source of truth for customer record creation.
 */

import { db } from '@/lib/db';
import { eventBus, createEvent } from './event-bus';

export interface CreateCustomerParams {
  merchantId: string;
  name: string;
  email: string;
  phone?: string;
  country?: string;
  environment: string;
  actorId?: string;
  emitEvents?: boolean;
}

class CustomerServiceClass {
  async create(params: CreateCustomerParams) {
    // Upsert: find by merchantId + email + environment
    let customer = await db.customerRecord.findFirst({
      where: {
        merchantId: params.merchantId,
        email: params.email,
        environment: params.environment,
      },
    });

    if (customer) return customer;

    customer = await db.customerRecord.create({
      data: {
        merchantId: params.merchantId,
        name: params.name,
        email: params.email,
        phone: params.phone || `+23324${Math.floor(1000000 + Math.random() * 8999999)}`,
        country: params.country || 'Ghana',
        environment: params.environment,
      },
    });

    if (params.emitEvents !== false) {
      await eventBus.emit(createEvent({
        type: 'customer.created',
        aggregateId: customer.id,
        aggregateType: 'CustomerRecord',
        merchantId: params.merchantId,
        environment: params.environment,
        payload: { customerId: customer.id, name: params.name, email: params.email },
        actorId: params.actorId,
      }));
    }

    return customer;
  }
}

export const customerService = new CustomerServiceClass();
