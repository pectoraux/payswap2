/**
 * API documentation data — source of truth for /developers/docs.
 *
 * This file enumerates the real merchant-facing REST endpoints exposed by
 * `src/app/api/*`, organized by resource group exactly like Stripe's API
 * reference. Each entry includes:
 *
 *   - HTTP method + path
 *   - One-line description
 *   - Authentication requirement
 *   - Parameter table (name, type, required, description)
 *   - Multi-language request examples (curl / Node / Python)
 *   - JSON response example (200 + error case)
 *
 * The docs page (`/developers/docs/page.tsx`) renders this data into a
 * two-column layout with a sticky sidebar — same UX pattern as Stripe.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type AuthRequirement =
  | 'session' // browser session cookie (signed in user)
  | 'merchant' // session + MERCHANT/MERCHANT_STAFF role (or DEVELOPER sandbox)
  | 'admin' // session + ADMIN/SUPER_ADMIN role
  | 'lp' // session + LP role
  | 'treasury' // session + TREASURY role
  | 'public'; // no auth

export interface ParamDef {
  name: string;
  type: string;
  required: boolean;
  description: string;
  /** For enum-typed params, the list of allowed values. */
  enum?: string[];
}

export interface ResponseExample {
  status: number;
  label: string;
  body: string;
}

export interface EndpointDoc {
  id: string;
  method: HttpMethod;
  path: string;
  title: string;
  description: string;
  auth: AuthRequirement;
  /** Path/query/body parameters. */
  params: ParamDef[];
  /** curl + Node + Python request examples. */
  curl: string;
  node: string;
  python: string;
  /** Response examples (200 + error). */
  responses: ResponseExample[];
}

export interface EndpointGroup {
  id: string;
  label: string;
  description: string;
  endpoints: EndpointDoc[];
}

const BASE = 'https://api.payswap.io';

// ────────────────────────────────────────────────────────────────────────────
// PAYMENTS
// ────────────────────────────────────────────────────────────────────────────
const payments: EndpointGroup = {
  id: 'payments',
  label: 'Payments',
  description:
    'A Payment is a charge against a customer — the core object in the PaySwap API. Create one to accept money from a buyer; retrieve one to check its status; refund one to give money back.',
  endpoints: [
    {
      id: 'payments-create',
      method: 'POST',
      path: '/api/payments/create',
      title: 'Create a payment',
      description:
        'Initiates a new payment intent for the authenticated merchant. The kernel compiles a Liquidity Execution Plan, runs policy + constitution checks, and either settles the payment immediately or returns a blocked result.',
      auth: 'merchant',
      params: [
        { name: 'amount', type: 'integer', required: true, description: 'Amount in the smallest currency unit (e.g. pesewas for GHS). Must be > 0.' },
        { name: 'currency', type: 'string', required: true, description: 'ISO 4217 currency code.', enum: ['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR'] },
        { name: 'method', type: 'string', required: true, description: 'Payment method the buyer will use.', enum: ['mobile_money', 'bank', 'card', 'onchain'] },
        { name: 'description', type: 'string', required: false, description: 'Internal description shown on the merchant dashboard.' },
        { name: 'customerEmail', type: 'string', required: false, description: 'Customer email — used to upsert the Customer record.' },
        { name: 'customerName', type: 'string', required: false, description: 'Customer display name.' },
      ],
      curl: `curl ${BASE}/api/payments/create \\
  -u psk_live_xxx: \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 1000,
    "currency": "GHS",
    "method": "mobile_money",
    "description": "Premium cocoa bag",
    "customerEmail": "kofi@example.com",
    "customerName": "Kofi Mensah"
  }'`,
      node: `import PaySwap from 'payswap';

const payswap = new PaySwap(process.env.PAYSWAP_SECRET_KEY);

const payment = await payswap.payments.create({
  amount: 1000,
  currency: 'GHS',
  method: 'mobile_money',
  description: 'Premium cocoa bag',
  customerEmail: 'kofi@example.com',
  customerName: 'Kofi Mensah',
});

console.log(payment.id);`,
      python: `import payswap

payswap.api_key = 'psk_live_xxx'

payment = payswap.Payment.create(
    amount=1000,
    currency='GHS',
    method='mobile_money',
    description='Premium cocoa bag',
    customer_email='kofi@example.com',
    customer_name='Kofi Mensah',
)

print(payment.id)`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "payment": {
    "id": "pay_01HABCD1234567",
    "reference": "PAY-a2f7f79e",
    "status": "COMPLETED",
    "amount": 1000,
    "fee": 8,
    "netAmount": 992,
    "currency": "GHS",
    "method": "mobile_money",
    "createdAt": "2026-01-15T12:34:56.000Z"
  }
}`,
        },
        {
          status: 400,
          label: 'Bad Request',
          body: `{ "error": "Invalid amount" }`,
        },
        {
          status: 403,
          label: 'Forbidden',
          body: `{ "error": "Forbidden" }`,
        },
      ],
    },
    {
      id: 'payments-list',
      method: 'GET',
      path: '/api/payments',
      title: 'List payments',
      description:
        'Returns a paginated list of payments for the merchant. Use the query parameters to filter by status, date range, or customer.',
      auth: 'merchant',
      params: [
        { name: 'limit', type: 'integer', required: false, description: 'Number of records to return (1–100). Default 25.' },
        { name: 'status', type: 'string', required: false, description: 'Filter by payment status.', enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'] },
        { name: 'from', type: 'string (ISO 8601)', required: false, description: 'Lower-bound created-at timestamp.' },
        { name: 'to', type: 'string (ISO 8601)', required: false, description: 'Upper-bound created-at timestamp.' },
      ],
      curl: `curl ${BASE}/api/payments?limit=10&status=COMPLETED \\
  -u psk_live_xxx:`,
      node: `const payments = await payswap.payments.list({
  limit: 10,
  status: 'COMPLETED',
});`,
      python: `payments = payswap.Payment.list(
    limit=10,
    status='COMPLETED',
)`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "payments": [
    {
      "id": "pay_01HABCD1234567",
      "reference": "PAY-a2f7f79e",
      "status": "COMPLETED",
      "amount": 1000,
      "currency": "GHS",
      "createdAt": "2026-01-15T12:34:56.000Z"
    }
  ],
  "hasMore": false
}`,
        },
      ],
    },
    {
      id: 'payments-retrieve',
      method: 'GET',
      path: '/api/payments/{id}',
      title: 'Retrieve a payment',
      description:
        'Retrieves the full payment object by ID or reference. Use this to poll for status updates after creating a payment.',
      auth: 'merchant',
      params: [
        { name: 'id', type: 'string', required: true, description: 'Payment ID (`pay_*`) or reference (`PAY-xxx`).' },
      ],
      curl: `curl ${BASE}/api/payments/pay_01HABCD1234567 \\
  -u psk_live_xxx:`,
      node: `const payment = await payswap.payments.retrieve('pay_01HABCD1234567');`,
      python: `payment = payswap.Payment.retrieve('pay_01HABCD1234567')`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "payment": {
    "id": "pay_01HABCD1234567",
    "reference": "PAY-a2f7f79e",
    "status": "COMPLETED",
    "amount": 1000,
    "currency": "GHS",
    "method": "mobile_money",
    "fee": 8,
    "netAmount": 992,
    "customer": { "email": "kofi@example.com", "name": "Kofi Mensah" },
    "createdAt": "2026-01-15T12:34:56.000Z"
  }
}`,
        },
        {
          status: 404,
          label: 'Not Found',
          body: `{ "error": "Payment not found" }`,
        },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// REFUNDS
// ────────────────────────────────────────────────────────────────────────────
const refunds: EndpointGroup = {
  id: 'refunds',
  label: 'Refunds',
  description:
    'A Refund reverses a Payment — either in full or in part. Refunds are issued against the original payment method and trigger twin-token burns in the kernel.',
  endpoints: [
    {
      id: 'refunds-create',
      method: 'POST',
      path: '/api/refunds/create',
      title: 'Create a refund',
      description:
        'Issues a FULL or PARTIAL refund against an existing payment. The Dispute Center must approve PARTIAL refunds before they execute.',
      auth: 'merchant',
      params: [
        { name: 'paymentId', type: 'string', required: true, description: 'ID of the original payment to refund.' },
        { name: 'type', type: 'string', required: true, description: 'Refund type.', enum: ['FULL', 'PARTIAL'] },
        { name: 'amount', type: 'integer', required: false, description: 'Required when type=PARTIAL. Amount in smallest currency unit.' },
        { name: 'reason', type: 'string', required: false, description: 'Free-text reason for the refund.' },
      ],
      curl: `curl ${BASE}/api/refunds/create \\
  -u psk_live_xxx: \\
  -H "Content-Type: application/json" \\
  -d '{
    "paymentId": "pay_01HABCD1234567",
    "type": "FULL",
    "reason": "Customer cancelled order"
  }'`,
      node: `const refund = await payswap.refunds.create({
  paymentId: 'pay_01HABCD1234567',
  type: 'FULL',
  reason: 'Customer cancelled order',
});`,
      python: `refund = payswap.Refund.create(
    payment_id='pay_01HABCD1234567',
    type='FULL',
    reason='Customer cancelled order',
)`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "refund": {
    "id": "re_01HABCD9999999",
    "paymentId": "pay_01HABCD1234567",
    "type": "FULL",
    "amount": 1000,
    "status": "PENDING",
    "createdAt": "2026-01-15T13:00:00.000Z"
  }
}`,
        },
        {
          status: 400,
          label: 'Bad Request',
          body: `{ "error": "Amount is required for PARTIAL refunds" }`,
        },
      ],
    },
    {
      id: 'refunds-retrieve',
      method: 'GET',
      path: '/api/refunds/{id}',
      title: 'Retrieve a refund',
      description: 'Fetches a single refund by ID, including its current status (PENDING, APPROVED, REJECTED, COMPLETED).',
      auth: 'merchant',
      params: [
        { name: 'id', type: 'string', required: true, description: 'Refund ID (`re_*`).' },
      ],
      curl: `curl ${BASE}/api/refunds/re_01HABCD9999999 \\
  -u psk_live_xxx:`,
      node: `const refund = await payswap.refunds.retrieve('re_01HABCD9999999');`,
      python: `refund = payswap.Refund.retrieve('re_01HABCD9999999')`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "refund": {
    "id": "re_01HABCD9999999",
    "paymentId": "pay_01HABCD1234567",
    "type": "FULL",
    "amount": 1000,
    "status": "COMPLETED",
    "reason": "Customer cancelled order",
    "createdAt": "2026-01-15T13:00:00.000Z",
    "completedAt": "2026-01-15T13:02:14.000Z"
  }
}`,
        },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// PAYOUTS
// ────────────────────────────────────────────────────────────────────────────
const payouts: EndpointGroup = {
  id: 'payouts',
  label: 'Payouts',
  description:
    'A Payout sends funds from the merchant balance to an external bank account, mobile money wallet, or on-chain address.',
  endpoints: [
    {
      id: 'payouts-create',
      method: 'POST',
      path: '/api/payouts/create',
      title: 'Create a payout',
      description:
        'Initiates a payout. The kernel first tries to draw from the destination country reserve; if the reserve is below threshold, it routes through a liquidity provider.',
      auth: 'merchant',
      params: [
        { name: 'method', type: 'string', required: true, description: 'Payout destination type.', enum: ['bank', 'mobile_money', 'onchain'] },
        { name: 'sourceAmount', type: 'number', required: true, description: 'Amount to send, in source currency.' },
        { name: 'sourceCurrency', type: 'string', required: true, description: 'Currency to debit from the merchant balance.', enum: ['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR'] },
        { name: 'destinationCurrency', type: 'string', required: true, description: 'Currency the recipient will receive.', enum: ['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR'] },
        { name: 'destination', type: 'string', required: true, description: 'Recipient account number, phone, or wallet address.' },
      ],
      curl: `curl ${BASE}/api/payouts/create \\
  -u psk_live_xxx: \\
  -H "Content-Type: application/json" \\
  -d '{
    "method": "mobile_money",
    "sourceAmount": 500,
    "sourceCurrency": "GHS",
    "destinationCurrency": "KES",
    "destination": "+254712345678"
  }'`,
      node: `const payout = await payswap.payouts.create({
  method: 'mobile_money',
  sourceAmount: 500,
  sourceCurrency: 'GHS',
  destinationCurrency: 'KES',
  destination: '+254712345678',
});`,
      python: `payout = payswap.Payout.create(
    method='mobile_money',
    source_amount=500,
    source_currency='GHS',
    destination_currency='KES',
    destination='+254712345678',
)`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "payout": {
    "id": "po_01HABCD8888888",
    "status": "PENDING",
    "sourceAmount": 500,
    "sourceCurrency": "GHS",
    "destinationCurrency": "KES",
    "method": "mobile_money",
    "createdAt": "2026-01-15T14:00:00.000Z"
  }
}`,
        },
        {
          status: 400,
          label: 'Bad Request',
          body: `{ "error": "Invalid method. Allowed: bank, mobile_money, onchain" }`,
        },
      ],
    },
    {
      id: 'payouts-retrieve',
      method: 'GET',
      path: '/api/payouts/{id}',
      title: 'Retrieve a payout',
      description: 'Fetches the current state of a single payout, including its ledger impact and treasury trace.',
      auth: 'merchant',
      params: [
        { name: 'id', type: 'string', required: true, description: 'Payout ID (`po_*`).' },
      ],
      curl: `curl ${BASE}/api/payouts/po_01HABCD8888888 \\
  -u psk_live_xxx:`,
      node: `const payout = await payswap.payouts.retrieve('po_01HABCD8888888');`,
      python: `payout = payswap.Payout.retrieve('po_01HABCD8888888')`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "payout": {
    "id": "po_01HABCD8888888",
    "status": "COMPLETED",
    "sourceAmount": 500,
    "sourceCurrency": "GHS",
    "destinationCurrency": "KES",
    "destinationAmount": 8650,
    "fee": 12,
    "method": "mobile_money",
    "createdAt": "2026-01-15T14:00:00.000Z",
    "completedAt": "2026-01-15T14:00:08.000Z"
  }
}`,
        },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// CUSTOMERS
// ────────────────────────────────────────────────────────────────────────────
const customers: EndpointGroup = {
  id: 'customers',
  label: 'Customers',
  description:
    'A Customer is a buyer that has paid (or will pay) a merchant. Customers are upserted automatically when a payment is created with a customerEmail; you can also create them explicitly to attach metadata.',
  endpoints: [
    {
      id: 'customers-create',
      method: 'POST',
      path: '/api/customers/create',
      title: 'Create a customer',
      description: 'Creates a new customer record for the authenticated merchant.',
      auth: 'merchant',
      params: [
        { name: 'name', type: 'string', required: true, description: 'Customer display name.' },
        { name: 'email', type: 'string', required: true, description: 'Customer email — used as the unique key per merchant.' },
        { name: 'phone', type: 'string', required: false, description: 'Customer phone (E.164 recommended).' },
        { name: 'country', type: 'string', required: false, description: 'Customer country (display name).' },
      ],
      curl: `curl ${BASE}/api/customers/create \\
  -u psk_live_xxx: \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Kofi Mensah",
    "email": "kofi@example.com",
    "phone": "+233244555111",
    "country": "Ghana"
  }'`,
      node: `const customer = await payswap.customers.create({
  name: 'Kofi Mensah',
  email: 'kofi@example.com',
  phone: '+233244555111',
  country: 'Ghana',
});`,
      python: `customer = payswap.Customer.create(
    name='Kofi Mensah',
    email='kofi@example.com',
    phone='+233244555111',
    country='Ghana',
)`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "customer": {
    "id": "cus_01HABCD7777777",
    "name": "Kofi Mensah",
    "email": "kofi@example.com",
    "phone": "+233244555111",
    "country": "Ghana",
    "createdAt": "2026-01-15T15:00:00.000Z"
  }
}`,
        },
        {
          status: 400,
          label: 'Bad Request',
          body: `{ "error": "Name and email are required" }`,
        },
      ],
    },
    {
      id: 'customers-retrieve',
      method: 'GET',
      path: '/api/customers/{id}',
      title: 'Retrieve a customer',
      description: 'Fetches a customer by ID, including their lifetime payment volume and most recent activity.',
      auth: 'merchant',
      params: [
        { name: 'id', type: 'string', required: true, description: 'Customer ID (`cus_*`).' },
      ],
      curl: `curl ${BASE}/api/customers/cus_01HABCD7777777 \\
  -u psk_live_xxx:`,
      node: `const customer = await payswap.customers.retrieve('cus_01HABCD7777777');`,
      python: `customer = payswap.Customer.retrieve('cus_01HABCD7777777')`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "customer": {
    "id": "cus_01HABCD7777777",
    "name": "Kofi Mensah",
    "email": "kofi@example.com",
    "lifetimeValue": 12500,
    "paymentCount": 14,
    "createdAt": "2026-01-15T15:00:00.000Z"
  }
}`,
        },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// INVOICES
// ────────────────────────────────────────────────────────────────────────────
const invoices: EndpointGroup = {
  id: 'invoices',
  label: 'Invoices',
  description:
    'An Invoice is a bill sent to a customer. Each line item has a quantity and unit amount; tax is applied as a flat rate across the subtotal.',
  endpoints: [
    {
      id: 'invoices-create',
      method: 'POST',
      path: '/api/invoices/create',
      title: 'Create an invoice',
      description: 'Creates a new invoice. The invoice is issued in DRAFT state; use the merchant dashboard to send it.',
      auth: 'merchant',
      params: [
        { name: 'customerEmail', type: 'string', required: true, description: 'Customer email — used to upsert the Customer record.' },
        { name: 'currency', type: 'string', required: true, description: 'ISO 4217 currency code.', enum: ['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR'] },
        { name: 'items', type: 'array of objects', required: true, description: 'Line items. Each item: { description, quantity, unitAmount }.' },
        { name: 'tax', type: 'number', required: false, description: 'Tax rate as a decimal (0.05 = 5%).' },
        { name: 'dueDate', type: 'string (ISO 8601)', required: false, description: 'Due date for the invoice.' },
      ],
      curl: `curl ${BASE}/api/invoices/create \\
  -u psk_live_xxx: \\
  -H "Content-Type: application/json" \\
  -d '{
    "customerEmail": "kofi@example.com",
    "currency": "GHS",
    "items": [
      { "description": "Premium cocoa bag", "quantity": 2, "unitAmount": 500 }
    ],
    "tax": 0.05,
    "dueDate": "2026-02-15"
  }'`,
      node: `const invoice = await payswap.invoices.create({
  customerEmail: 'kofi@example.com',
  currency: 'GHS',
  items: [
    { description: 'Premium cocoa bag', quantity: 2, unitAmount: 500 },
  ],
  tax: 0.05,
  dueDate: '2026-02-15',
});`,
      python: `invoice = payswap.Invoice.create(
    customer_email='kofi@example.com',
    currency='GHS',
    items=[
        {'description': 'Premium cocoa bag', 'quantity': 2, 'unit_amount': 500},
    ],
    tax=0.05,
    due_date='2026-02-15',
)`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "invoice": {
    "id": "inv_01HABCD6666666",
    "status": "DRAFT",
    "subtotal": 1000,
    "tax": 50,
    "total": 1050,
    "currency": "GHS",
    "dueDate": "2026-02-15T00:00:00.000Z",
    "createdAt": "2026-01-15T16:00:00.000Z"
  }
}`,
        },
        {
          status: 400,
          label: 'Bad Request',
          body: `{ "error": "Currency must be one of GHS, KES, NGN, USD, EUR, ZAR" }`,
        },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// WEBHOOKS
// ────────────────────────────────────────────────────────────────────────────
const webhooks: EndpointGroup = {
  id: 'webhooks',
  label: 'Webhooks',
  description:
    'A Webhook Endpoint is a URL that PaySwap will POST event notifications to as things happen (payment.completed, payout.completed, etc.). Each endpoint gets its own signing secret for verifying payloads.',
  endpoints: [
    {
      id: 'webhooks-create',
      method: 'POST',
      path: '/api/webhooks/create',
      title: 'Create a webhook endpoint',
      description:
        'Registers a webhook URL. The response includes a `secret` that you should store — it is shown only once and is used to verify the signature on incoming webhook payloads.',
      auth: 'merchant',
      params: [
        { name: 'url', type: 'string', required: true, description: 'HTTPS URL that will receive POST requests.' },
        { name: 'events', type: 'array of strings', required: true, description: 'Event types to subscribe to.', enum: ['payment.created', 'payment.completed', 'payment.failed', 'payout.completed'] },
      ],
      curl: `curl ${BASE}/api/webhooks/create \\
  -u psk_live_xxx: \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com/webhooks/payswap",
    "events": ["payment.created", "payment.completed", "payout.completed"]
  }'`,
      node: `const endpoint = await payswap.webhooks.create({
  url: 'https://example.com/webhooks/payswap',
  events: ['payment.created', 'payment.completed', 'payout.completed'],
});

// Store endpoint.secret securely — it is shown only once.
console.log(endpoint.secret);`,
      python: `endpoint = payswap.WebhookEndpoint.create(
    url='https://example.com/webhooks/payswap',
    events=['payment.created', 'payment.completed', 'payout.completed'],
)

# Store endpoint.secret securely — it is shown only once.
print(endpoint.secret)`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "endpoint": {
    "id": "we_01HABCD5555555",
    "url": "https://example.com/webhooks/payswap",
    "events": ["payment.created", "payment.completed", "payout.completed"],
    "secret": "wh_sec_a1b2c3d4e5f6...",
    "createdAt": "2026-01-15T17:00:00.000Z"
  }
}`,
        },
        {
          status: 400,
          label: 'Bad Request',
          body: `{ "error": "At least one valid event is required" }`,
        },
      ],
    },
    {
      id: 'webhooks-list',
      method: 'GET',
      path: '/api/webhooks',
      title: 'List webhook endpoints',
      description: 'Returns all webhook endpoints for the authenticated merchant. Does not include signing secrets.',
      auth: 'merchant',
      params: [],
      curl: `curl ${BASE}/api/webhooks \\
  -u psk_live_xxx:`,
      node: `const endpoints = await payswap.webhooks.list();`,
      python: `endpoints = payswap.WebhookEndpoint.list()`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "endpoints": [
    {
      "id": "we_01HABCD5555555",
      "url": "https://example.com/webhooks/payswap",
      "events": ["payment.created", "payment.completed", "payout.completed"],
      "createdAt": "2026-01-15T17:00:00.000Z"
    }
  ]
}`,
        },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// API KEYS
// ────────────────────────────────────────────────────────────────────────────
const apiKeys: EndpointGroup = {
  id: 'api-keys',
  label: 'API Keys',
  description:
    'An API Key is a long-lived bearer token that grants programmatic access to the PaySwap REST API. Keys are scoped — they only allow the operations listed in their `scopes` array.',
  endpoints: [
    {
      id: 'api-keys-create',
      method: 'POST',
      path: '/api/api-keys/create',
      title: 'Create an API key',
      description:
        'Creates a new API key. The plain key is returned exactly once in the response — store it securely; PaySwap only stores a hash.',
      auth: 'merchant',
      params: [
        { name: 'label', type: 'string', required: false, description: 'Human-readable label (max 64 chars).' },
        { name: 'scopes', type: 'array of strings', required: true, description: 'Permission scopes for the key.', enum: ['payments:read', 'payments:write', 'payouts:read', 'payouts:write', 'webhooks:read'] },
      ],
      curl: `curl ${BASE}/api/api-keys/create \\
  -u psk_live_xxx: \\
  -H "Content-Type: application/json" \\
  -d '{
    "label": "Production server",
    "scopes": ["payments:read", "payments:write", "payouts:read"]
  }'`,
      node: `const key = await payswap.apiKeys.create({
  label: 'Production server',
  scopes: ['payments:read', 'payments:write', 'payouts:read'],
});

// Store key.secret securely — it is shown only once.
console.log(key.secret);`,
      python: `key = payswap.ApiKey.create(
    label='Production server',
    scopes=['payments:read', 'payments:write', 'payouts:read'],
)

# Store key.secret securely — it is shown only once.
print(key.secret)`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "apiKey": {
    "id": "key_01HABCD4444444",
    "label": "Production server",
    "scopes": ["payments:read", "payments:write", "payouts:read"],
    "secret": "psk_live_a1b2c3d4e5f6...",
    "prefix": "psk_live_a1b2",
    "createdAt": "2026-01-15T18:00:00.000Z"
  }
}`,
        },
        {
          status: 400,
          label: 'Bad Request',
          body: `{ "error": "At least one valid scope is required" }`,
        },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// ACTIVITY & WALLETS
// ────────────────────────────────────────────────────────────────────────────
const activity: EndpointGroup = {
  id: 'activity',
  label: 'Activity & Wallets',
  description:
    'Read-only endpoints for surfacing the merchant dashboard: the unified activity feed, currency wallet balances, and the full dashboard state object.',
  endpoints: [
    {
      id: 'activity-list',
      method: 'GET',
      path: '/api/activity',
      title: 'Activity feed',
      description: 'Returns a unified, time-ordered feed of merchant events (payments, payouts, refunds, webhooks, audit entries).',
      auth: 'merchant',
      params: [
        { name: 'limit', type: 'integer', required: false, description: 'Max records to return (1–100). Default 25.' },
        { name: 'type', type: 'string', required: false, description: 'Filter by activity type.', enum: ['payment', 'payout', 'refund', 'webhook', 'audit'] },
      ],
      curl: `curl ${BASE}/api/activity?limit=10 \\
  -u psk_live_xxx:`,
      node: `const feed = await payswap.activity.list({ limit: 10 });`,
      python: `feed = payswap.Activity.list(limit=10)`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "items": [
    {
      "id": "act_01HABCD3333333",
      "type": "payment",
      "description": "Payment PAY-a2f7f79e for 1000 GHS",
      "createdAt": "2026-01-15T12:34:56.000Z"
    }
  ]
}`,
        },
      ],
    },
    {
      id: 'wallets-list',
      method: 'GET',
      path: '/api/wallets',
      title: 'List wallets',
      description: 'Returns the merchant\'s currency wallet and their current balances.',
      auth: 'merchant',
      params: [],
      curl: `curl ${BASE}/api/wallets \\
  -u psk_live_xxx:`,
      node: `const wallets = await payswap.wallets.list();`,
      python: `wallets = payswap.Wallet.list()`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "wallets": [
    { "id": "wlt_01", "currency": "GHS", "balance": 12450 },
    { "id": "wlt_02", "currency": "KES", "balance": 38200 },
    { "id": "wlt_03", "currency": "USD", "balance": 750 }
  ]
}`,
        },
      ],
    },
    {
      id: 'merchant-state',
      method: 'GET',
      path: '/api/merchant/state',
      title: 'Merchant state',
      description:
        'Returns the full dashboard state — balances, recent payouts, webhook endpoints, and analytics rollups — in a single call. Used by the merchant dashboard on initial load.',
      auth: 'merchant',
      params: [
        { name: 'merchantId', type: 'string', required: true, description: 'Merchant ID (`mer_*`).' },
      ],
      curl: `curl ${BASE}/api/merchant/state?merchantId=mer_01HABCD2222222 \\
  -u psk_live_xxx:`,
      node: `const state = await payswap.merchant.state('mer_01HABCD2222222');`,
      python: `state = payswap.Merchant.state('mer_01HABCD2222222')`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "balances": [{ "currency": "GHS", "available": 12450, "pending": 0 }],
  "recentPayouts": [],
  "webhooks": [],
  "analytics": {
    "todayVolume": 2500,
    "monthVolume": 47500,
    "successRate": 0.987
  }
}`,
        },
        {
          status: 400,
          label: 'Bad Request',
          body: `{ "error": "missing_merchantId" }`,
        },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// LIQUIDITY PROVIDERS
// ────────────────────────────────────────────────────────────────────────────
const lp: EndpointGroup = {
  id: 'lp',
  label: 'Liquidity Providers',
  description:
    'LPs supply capital to the PaySwap network and earn fees on every routed payment. These endpoints manage LP capital (deposit/withdraw) and per-corridor fee settings.',
  endpoints: [
    {
      id: 'lp-capital',
      method: 'POST',
      path: '/api/lp/capital',
      title: 'Deposit / withdraw LP capital',
      description:
        'Adds or removes capital from the LP\'s stake. Deposits are credited immediately; withdrawals are queued and may take 1–3 business days for bank transfers.',
      auth: 'lp',
      params: [
        { name: 'action', type: 'string', required: true, description: 'Direction of the capital movement.', enum: ['deposit', 'withdraw'] },
        { name: 'amount', type: 'number', required: true, description: 'Amount in USD.' },
        { name: 'currency', type: 'string', required: true, description: 'ISO 4217 currency code.' },
        { name: 'paymentMethod', type: 'string', required: true, description: 'Funding method.', enum: ['bank_transfer', 'card', 'mobile_money'] },
        { name: 'reason', type: 'string', required: false, description: 'Free-text reason (required for withdrawals > $10k).' },
      ],
      curl: `curl ${BASE}/api/lp/capital \\
  -H "Authorization: Bearer <session>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "action": "deposit",
    "amount": 5000,
    "currency": "USD",
    "paymentMethod": "bank_transfer"
  }'`,
      node: `const result = await payswap.lp.capital({
  action: 'deposit',
  amount: 5000,
  currency: 'USD',
  paymentMethod: 'bank_transfer',
});`,
      python: `result = payswap.LP.capital(
    action='deposit',
    amount=5000,
    currency='USD',
    payment_method='bank_transfer',
)`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "action": "deposit",
  "amount": 5000,
  "currency": "USD",
  "newStake": 12500,
  "txId": "lpcap_01HABCD1111111"
}`,
        },
        {
          status: 400,
          label: 'Bad Request',
          body: `{ "error": "Insufficient available capital. Available: 4500 USD, requested: 5000.00 USD" }`,
        },
      ],
    },
    {
      id: 'lp-corridors',
      method: 'POST',
      path: '/api/lp/corridors',
      title: 'Set corridor fees',
      description: 'Updates the fee this LP charges for a specific country→country corridor.',
      auth: 'lp',
      params: [
        { name: 'action', type: 'string', required: true, description: 'Currently only `upsert` is supported.', enum: ['upsert', 'remove'] },
        { name: 'corridor', type: 'object', required: true, description: '{ from: "Kenya", to: "Ghana" } — the corridor to update.' },
        { name: 'feeBps', type: 'integer', required: false, description: 'Fee in basis points (e.g. 80 = 0.8%). Required for `upsert`.' },
        { name: 'capacity', type: 'number', required: false, description: 'Max USD this LP will route through this corridor per day.' },
      ],
      curl: `curl ${BASE}/api/lp/corridors \\
  -H "Authorization: Bearer <session>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "action": "upsert",
    "corridor": { "from": "Kenya", "to": "Ghana" },
    "feeBps": 80,
    "capacity": 100000
  }'`,
      node: `await payswap.lp.corridors.upsert({
  corridor: { from: 'Kenya', to: 'Ghana' },
  feeBps: 80,
  capacity: 100000,
});`,
      python: `payswap.LP.corridors.upsert(
    corridor={'from': 'Kenya', 'to': 'Ghana'},
    fee_bps=80,
    capacity=100000,
)`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "corridor": { "from": "Kenya", "to": "Ghana" },
  "feeBps": 80,
  "capacity": 100000,
  "updatedAt": "2026-01-15T19:00:00.000Z"
}`,
        },
      ],
    },
    {
      id: 'lp-settings',
      method: 'GET',
      path: '/api/lp/settings',
      title: 'Get LP settings',
      description: 'Returns the LP\'s current stake, available capital, and per-corridor fee schedule.',
      auth: 'lp',
      params: [],
      curl: `curl ${BASE}/api/lp/settings \\
  -H "Authorization: Bearer <session>"`,
      node: `const settings = await payswap.lp.settings.get();`,
      python: `settings = payswap.LP.settings.get()`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "stake": 12500,
  "available": 9800,
  "currency": "USD",
  "corridors": [
    { "from": "Kenya", "to": "Ghana", "feeBps": 80, "capacity": 100000 }
  ]
}`,
        },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// TREASURY
// ────────────────────────────────────────────────────────────────────────────
const treasury: EndpointGroup = {
  id: 'treasury',
  label: 'Treasury',
  description:
    'Treasury operators manage country-level reserves, freeze corridors during incidents, and trigger rebalances.',
  endpoints: [
    {
      id: 'treasury-status',
      method: 'GET',
      path: '/api/treasury/status',
      title: 'Treasury status',
      description: 'Returns all treasury positions (per-country reserves) plus the treasury AI\'s current recommendations.',
      auth: 'treasury',
      params: [],
      curl: `curl ${BASE}/api/treasury/status \\
  -H "Authorization: Bearer <session>"`,
      node: `const status = await payswap.treasury.status();`,
      python: `status = payswap.Treasury.status()`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "positions": [
    { "country": "Ghana", "currency": "GHS", "available": 100000, "minThreshold": 10000 }
  ],
  "recommendations": [
    { "priority": "high", "action": "Top up Kenya reserve", "rationale": "Below 15% threshold" }
  ]
}`,
        },
      ],
    },
    {
      id: 'treasury-freeze',
      method: 'POST',
      path: '/api/treasury/freeze',
      title: 'Freeze a corridor',
      description: 'Emergency-freezes a country or corridor. All routed payments through the frozen corridor are blocked until the freeze is lifted.',
      auth: 'treasury',
      params: [
        { name: 'country', type: 'string', required: false, description: 'Country to freeze.' },
        { name: 'corridor', type: 'object', required: false, description: '{ from, to } — specific corridor to freeze.' },
        { name: 'reason', type: 'string', required: true, description: 'Reason for the freeze (logged in audit).' },
      ],
      curl: `curl ${BASE}/api/treasury/freeze \\
  -H "Authorization: Bearer <session>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "country": "Nigeria",
    "reason": "Banking partner outage — incident INC-001"
  }'`,
      node: `const freeze = await payswap.treasury.freeze({
  country: 'Nigeria',
  reason: 'Banking partner outage — incident INC-001',
});`,
      python: `freeze = payswap.Treasury.freeze(
    country='Nigeria',
    reason='Banking partner outage — incident INC-001',
)`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "freeze": {
    "id": "frz_01HABCD0000000",
    "country": "Nigeria",
    "reason": "Banking partner outage — incident INC-001",
    "createdAt": "2026-01-15T20:00:00.000Z"
  }
}`,
        },
      ],
    },
    {
      id: 'treasury-rebalance',
      method: 'POST',
      path: '/api/treasury/rebalance',
      title: 'Trigger a rebalance',
      description: 'Triggers a manual rebalance of one or more reserves. The kernel will compute the optimal fund movement and execute it.',
      auth: 'treasury',
      params: [
        { name: 'fromCountry', type: 'string', required: true, description: 'Source country for the rebalance.' },
        { name: 'toCountry', type: 'string', required: true, description: 'Destination country for the rebalance.' },
        { name: 'amount', type: 'number', required: true, description: 'Amount to move (in source currency).' },
      ],
      curl: `curl ${BASE}/api/treasury/rebalance \\
  -H "Authorization: Bearer <session>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fromCountry": "Ghana",
    "toCountry": "Kenya",
    "amount": 25000
  }'`,
      node: `const rebalance = await payswap.treasury.rebalance({
  fromCountry: 'Ghana',
  toCountry: 'Kenya',
  amount: 25000,
});`,
      python: `rebalance = payswap.Treasury.rebalance(
    from_country='Ghana',
    to_country='Kenya',
    amount=25000,
)`,
      responses: [
        {
          status: 200,
          label: 'OK',
          body: `{
  "rebalance": {
    "id": "reb_01HABCDEEEEEEE",
    "fromCountry": "Ghana",
    "toCountry": "Kenya",
    "amount": 25000,
    "status": "COMPLETED",
    "executedAt": "2026-01-15T21:00:00.000Z"
  }
}`,
        },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// WEBHOOK EVENTS (reference, not callable)
// ────────────────────────────────────────────────────────────────────────────
const webhookEvents: EndpointGroup = {
  id: 'webhook-events',
  label: 'Webhook Events',
  description:
    'These are the event types PaySwap delivers to your webhook endpoints. Each event is delivered as a POST request with a JSON body shaped like the examples below, signed with your endpoint secret.',
  endpoints: [
    {
      id: 'event-payment-created',
      method: 'POST',
      path: '(delivered to your endpoint)',
      title: 'payment.created',
      description: 'Sent when a new payment intent is created. The payment is still in PENDING state at this point.',
      auth: 'public',
      params: [],
      curl: `# POST delivered to your webhook URL
# Header: PaySwap-Signature: t=1737057600,v1=a1b2c3...
{
  "id": "evt_01HABCDEEEEE01",
  "type": "payment.created",
  "createdAt": "2026-01-15T12:34:56.000Z",
  "data": {
    "object": {
      "id": "pay_01HABCD1234567",
      "reference": "PAY-a2f7f79e",
      "status": "PENDING",
      "amount": 1000,
      "currency": "GHS"
    }
  }
}`,
      node: `// Verify the signature, then handle the event:
switch (event.type) {
  case 'payment.created':
    await onPaymentCreated(event.data.object);
    break;
  case 'payment.completed':
    await onPaymentCompleted(event.data.object);
    break;
}`,
      python: `# Verify the signature, then handle the event:
if event.type == 'payment.created':
    on_payment_created(event.data.object)
elif event.type == 'payment.completed':
    on_payment_completed(event.data.object)`,
      responses: [
        {
          status: 200,
          label: 'Respond with 2xx to acknowledge',
          body: `# Any 2xx status code acknowledges receipt.
# PaySwap retries with exponential backoff on non-2xx responses.
HTTP/1.1 200 OK`,
        },
      ],
    },
    {
      id: 'event-payment-completed',
      method: 'POST',
      path: '(delivered to your endpoint)',
      title: 'payment.completed',
      description: 'Sent when a payment settles successfully. The payment status is COMPLETED.',
      auth: 'public',
      params: [],
      curl: `# POST delivered to your webhook URL
# Header: PaySwap-Signature: t=1737057600,v1=a1b2c3...
{
  "id": "evt_01HABCDEEEEE02",
  "type": "payment.completed",
  "createdAt": "2026-01-15T12:34:58.000Z",
  "data": {
    "object": {
      "id": "pay_01HABCD1234567",
      "reference": "PAY-a2f7f79e",
      "status": "COMPLETED",
      "amount": 1000,
      "fee": 8,
      "netAmount": 992,
      "currency": "GHS"
    }
  }
}`,
      node: `case 'payment.completed':
  await fulfillOrder(event.data.object);
  break;`,
      python: `if event.type == 'payment.completed':
    fulfill_order(event.data.object)`,
      responses: [
        {
          status: 200,
          label: 'Respond with 2xx to acknowledge',
          body: `HTTP/1.1 200 OK`,
        },
      ],
    },
    {
      id: 'event-payment-failed',
      method: 'POST',
      path: '(delivered to your endpoint)',
      title: 'payment.failed',
      description: 'Sent when a payment is blocked by policy or fails during settlement. The payment status is FAILED.',
      auth: 'public',
      params: [],
      curl: `# POST delivered to your webhook URL
# Header: PaySwap-Signature: t=1737057600,v1=a1b2c3...
{
  "id": "evt_01HABCDEEEEE03",
  "type": "payment.failed",
  "createdAt": "2026-01-15T12:34:58.000Z",
  "data": {
    "object": {
      "id": "pay_01HABCD1234567",
      "status": "FAILED",
      "amount": 1000,
      "currency": "GHS",
      "failureReason": "Policy block: risk score 0.92 > threshold 0.5"
    }
  }
}`,
      node: `case 'payment.failed':
  await notifyCustomerOfFailure(event.data.object);
  break;`,
      python: `if event.type == 'payment.failed':
    notify_customer_of_failure(event.data.object)`,
      responses: [
        {
          status: 200,
          label: 'Respond with 2xx to acknowledge',
          body: `HTTP/1.1 200 OK`,
        },
      ],
    },
    {
      id: 'event-payout-completed',
      method: 'POST',
      path: '(delivered to your endpoint)',
      title: 'payout.completed',
      description: 'Sent when a payout is fully executed. The payout status is COMPLETED.',
      auth: 'public',
      params: [],
      curl: `# POST delivered to your webhook URL
# Header: PaySwap-Signature: t=1737057600,v1=a1b2c3...
{
  "id": "evt_01HABCDEEEEE04",
  "type": "payout.completed",
  "createdAt": "2026-01-15T14:00:08.000Z",
  "data": {
    "object": {
      "id": "po_01HABCD8888888",
      "status": "COMPLETED",
      "sourceAmount": 500,
      "sourceCurrency": "GHS",
      "destinationAmount": 8650,
      "destinationCurrency": "KES"
    }
  }
}`,
      node: `case 'payout.completed':
  await reconcilePayout(event.data.object);
  break;`,
      python: `if event.type == 'payout.completed':
    reconcile_payout(event.data.object)`,
      responses: [
        {
          status: 200,
          label: 'Respond with 2xx to acknowledge',
          body: `HTTP/1.1 200 OK`,
        },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// DEVELOPER CONSOLE
// ────────────────────────────────────────────────────────────────────────────
const developer: EndpointGroup = {
  id: 'developer',
  label: 'Developer Console',
  description:
    'Sandbox + simulator endpoints used from the developer console. These mirror the production merchant API but run against an isolated sandbox so you can test integrations end-to-end without touching live data.',
  endpoints: [
    {
      id: 'developer-simulator-scenarios',
      method: 'GET',
      path: '/api/developer/simulator/scenarios',
      title: 'List simulator scenarios',
      description:
        'Returns the catalog of pre-built kernel scenarios you can run from the developer console (payment success, payment failed, refund, payout, settlement, marketplace auction, treasury rebalance, LP timeout, stablecoin depeg, bank outage).',
      auth: 'session',
      params: [],
      curl: `curl ${BASE}/api/developer/simulator/scenarios \\
  -u psk_live_xxx:`,
      node: `const res = await fetch('/api/developer/simulator/scenarios', {
  headers: { Authorization: 'Bearer ' + process.env.PAYSWAP_SECRET_KEY },
});
const { scenarios } = await res.json();`,
      python: `import requests
res = requests.get(
    '${BASE}/api/developer/simulator/scenarios',
    auth=(os.environ['PAYSWAP_SECRET_KEY'], ''),
)
scenarios = res.json()['scenarios']`,
      responses: [
        {
          status: 200,
          label: 'Scenario catalog',
          body: `{
  "ok": true,
  "scenarios": [
    {
      "id": "payment_success",
      "label": "Payment Success",
      "description": "A standard cross-border mobile money payment that settles successfully end-to-end.",
      "category": "payment"
    },
    {
      "id": "stablecoin_depeg",
      "label": "Stablecoin Depeg",
      "description": "FX spike causes twin-token depeg; insurance claim filed.",
      "category": "stablecoin"
    }
  ]
}`,
        },
      ],
    },
    {
      id: 'developer-simulator-run',
      method: 'POST',
      path: '/api/developer/simulator/run',
      title: 'Run a simulator scenario',
      description:
        'Runs a pre-built scenario through the kernel pipeline and returns the full structured result: timeline, event stream, ledger impact (before/after), decision inspector (policy findings, constitution checks, council vote, alternatives), and metrics (cost %, settlement time, risk, confidence).',
      auth: 'session',
      params: [
        { name: 'scenarioId', type: 'string', required: true, description: 'Scenario id from the catalog.', enum: ['payment_success', 'payment_failed', 'refund', 'payout', 'settlement', 'marketplace_auction', 'treasury_rebalance', 'lp_timeout', 'stablecoin_depeg', 'bank_outage'] },
      ],
      curl: `curl ${BASE}/api/developer/simulator/run \\
  -u psk_live_xxx: \\
  -H "Content-Type: application/json" \\
  -d '{ "scenarioId": "payment_success" }'`,
      node: `const res = await fetch('/api/developer/simulator/run', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + process.env.PAYSWAP_SECRET_KEY,
  },
  body: JSON.stringify({ scenarioId: 'payment_success' }),
});
const { run } = await res.json();
console.log(run.settled, run.metrics);`,
      python: `import requests
res = requests.post(
    '${BASE}/api/developer/simulator/run',
    auth=(os.environ['PAYSWAP_SECRET_KEY'], ''),
    json={'scenarioId': 'payment_success'},
)
run = res.json()['run']`,
      responses: [
        {
          status: 200,
          label: 'Successful run',
          body: `{
  "ok": true,
  "elapsedMs": 13,
  "run": {
    "runId": "run_cms01vuup00abc",
    "kernelVersion": "2.1.0-coordination",
    "settled": true,
    "scenarioId": "payment_success",
    "timeline": [{ "name": "Intent", "status": "success", "frame": 0 }],
    "events": [{ "id": "evt_01", "type": "payment.created", "frame": 0 }],
    "ledger": {
      "before": [{ "account": "merchant.settlement", "balance": 0 }],
      "after": [{ "account": "merchant.settlement", "balance": 990, "delta": 990 }],
      "entries": [{ "id": "le_01", "debit": 1000, "credit": 0, "balanceAfter": 1000 }]
    },
    "metrics": {
      "costPercent": 1.0,
      "settlementTimeMs": 1500,
      "settlementTimeLabel": "1.5s",
      "riskScore": 0.18,
      "riskLabel": "low",
      "confidence": 92,
      "totalFees": 10,
      "fxRate": 1.0
    },
    "resultHash": "0xabc123..."
  }
}`,
        },
        {
          status: 400,
          label: 'Unknown scenario',
          body: `{ "ok": false, "error": "Unknown scenario: foo" }`,
        },
      ],
    },
    {
      id: 'developer-sandbox-reset',
      method: 'POST',
      path: '/api/developer/sandbox/reset',
      title: 'Reset developer sandbox',
      description:
        'Clears all sandbox state for the authenticated developer (test payments, payouts, webhooks, API keys created in sandbox). Production data is never touched.',
      auth: 'session',
      params: [],
      curl: `curl ${BASE}/api/developer/sandbox/reset \\
  -u psk_live_xxx: \\
  -X POST`,
      node: `await fetch('/api/developer/sandbox/reset', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + process.env.PAYSWAP_SECRET_KEY },
});`,
      python: `import requests
requests.post(
    '${BASE}/api/developer/sandbox/reset',
    auth=(os.environ['PAYSWAP_SECRET_KEY'], ''),
)`,
      responses: [
        {
          status: 200,
          label: 'Sandbox cleared',
          body: `{ "ok": true, "clearedAt": "2026-07-28T12:00:00.000Z" }`,
        },
      ],
    },
    {
      id: 'developer-metrics',
      method: 'GET',
      path: '/api/developer/metrics',
      title: 'Developer metrics',
      description:
        'Returns aggregated metrics for the authenticated developer: request count by endpoint, error rate, p50/p95 latency, top customers.',
      auth: 'session',
      params: [
        { name: 'window', type: 'string', required: false, description: 'Time window for aggregation.', enum: ['1h', '24h', '7d', '30d'] },
      ],
      curl: `curl "${BASE}/api/developer/metrics?window=24h" \\
  -u psk_live_xxx:`,
      node: `const res = await fetch('/api/developer/metrics?window=24h', {
  headers: { Authorization: 'Bearer ' + process.env.PAYSWAP_SECRET_KEY },
});
const { metrics } = await res.json();`,
      python: `import requests
res = requests.get(
    '${BASE}/api/developer/metrics',
    params={'window': '24h'},
    auth=(os.environ['PAYSWAP_SECRET_KEY'], ''),
)
metrics = res.json()['metrics']`,
      responses: [
        {
          status: 200,
          label: '24h metrics',
          body: `{
  "ok": true,
  "metrics": {
    "window": "24h",
    "totalRequests": 1247,
    "errorRate": 0.012,
    "p50LatencyMs": 142,
    "p95LatencyMs": 890,
    "byEndpoint": [
      { "path": "/api/payments/create", "count": 412, "errorRate": 0.005 },
      { "path": "/api/payouts/create", "count": 89, "errorRate": 0.022 }
    ]
  }
}`,
        },
      ],
    },
    {
      id: 'developer-logs',
      method: 'GET',
      path: '/api/developer/logs',
      title: 'Request logs',
      description:
        'Returns the most recent API requests made by the authenticated developer. Useful for debugging — each entry includes the request method, path, status, latency, and a correlation id.',
      auth: 'session',
      params: [
        { name: 'limit', type: 'integer', required: false, description: 'Max entries to return (default 50, max 200).' },
        { name: 'status', type: 'string', required: false, description: 'Filter by status class.', enum: ['success', 'error', 'all'] },
      ],
      curl: `curl "${BASE}/api/developer/logs?limit=50&status=error" \\
  -u psk_live_xxx:`,
      node: `const res = await fetch('/api/developer/logs?limit=50', {
  headers: { Authorization: 'Bearer ' + process.env.PAYSWAP_SECRET_KEY },
});
const { logs } = await res.json();`,
      python: `import requests
res = requests.get(
    '${BASE}/api/developer/logs',
    params={'limit': 50, 'status': 'error'},
    auth=(os.environ['PAYSWAP_SECRET_KEY'], ''),
)
logs = res.json()['logs']`,
      responses: [
        {
          status: 200,
          label: 'Recent logs',
          body: `{
  "ok": true,
  "logs": [
    {
      "id": "log_01",
      "method": "POST",
      "path": "/api/payments/create",
      "status": 200,
      "latencyMs": 142,
      "correlationId": "corr_01HABCDE",
      "ts": "2026-07-28T11:58:42.000Z"
    }
  ]
}`,
        },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// CUSTOMER WALLET
// ────────────────────────────────────────────────────────────────────────────
const customerWallet: EndpointGroup = {
  id: 'customer-wallet',
  label: 'Customer Wallet',
  description:
    'Customer-facing wallet endpoints. Customers can deposit funds, withdraw to a bank or mobile money account, transfer to another PaySwap customer or merchant, and pay invoices directly from their wallet balance.',
  endpoints: [
    {
      id: 'customer-wallet-deposit',
      method: 'POST',
      path: '/api/customer/wallet/deposit',
      title: 'Deposit to wallet',
      description:
        'Credits the customer\'s wallet in the requested currency. If the customer doesn\'t yet have a wallet for that currency, one is created automatically. The source can be a bank card, mobile money, or bank transfer.',
      auth: 'session',
      params: [
        { name: 'amount', type: 'number', required: true, description: 'Amount to deposit. Must be > 0.' },
        { name: 'currency', type: 'string', required: true, description: 'Wallet currency.', enum: ['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR'] },
        { name: 'source', type: 'string', required: true, description: 'Funding source.', enum: ['BANK_CARD', 'MOBILE_MONEY', 'BANK_TRANSFER'] },
        { name: 'reference', type: 'string', required: false, description: 'Optional customer-facing reference.' },
      ],
      curl: `curl ${BASE}/api/customer/wallet/deposit \\
  -u psk_live_xxx: \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 250,
    "currency": "GHS",
    "source": "MOBILE_MONEY",
    "reference": "momo topup"
  }'`,
      node: `const res = await fetch('/api/customer/wallet/deposit', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + process.env.PAYSWAP_SECRET_KEY,
  },
  body: JSON.stringify({
    amount: 250,
    currency: 'GHS',
    source: 'MOBILE_MONEY',
  }),
});
const { wallet, transaction } = await res.json();`,
      python: `import requests
res = requests.post(
    '${BASE}/api/customer/wallet/deposit',
    auth=(os.environ['PAYSWAP_SECRET_KEY'], ''),
    json={'amount': 250, 'currency': 'GHS', 'source': 'MOBILE_MONEY'},
)
wallet, transaction = res.json()['wallet'], res.json()['transaction']`,
      responses: [
        {
          status: 200,
          label: 'Deposit credited',
          body: `{
  "ok": true,
  "wallet": {
    "id": "wlt_01",
    "currency": "GHS",
    "balance": 250,
    "pendingBalance": 0,
    "lockedBalance": 0
  },
  "transaction": {
    "id": "wtx_01",
    "type": "CREDIT",
    "amount": 250,
    "currency": "GHS",
    "counterparty": "MOBILE_MONEY",
    "txHash": "dep_1753689600000"
  }
}`,
        },
        {
          status: 400,
          label: 'Invalid amount',
          body: `{ "error": "Amount must be greater than 0" }`,
        },
      ],
    },
    {
      id: 'customer-wallet-withdraw',
      method: 'POST',
      path: '/api/customer/wallet/withdraw',
      title: 'Withdraw from wallet',
      description:
        'Debits the customer\'s wallet and schedules a payout to the specified destination. The wallet must have sufficient available balance (excluding pending + locked).',
      auth: 'session',
      params: [
        { name: 'amount', type: 'number', required: true, description: 'Amount to withdraw.' },
        { name: 'currency', type: 'string', required: true, description: 'Wallet currency.', enum: ['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR'] },
        { name: 'destination', type: 'string', required: true, description: 'Payout destination.', enum: ['BANK_ACCOUNT', 'MOBILE_MONEY'] },
        { name: 'destinationLabel', type: 'string', required: false, description: 'Human-readable label for the destination (e.g. "Ecobank ****1234").' },
      ],
      curl: `curl ${BASE}/api/customer/wallet/withdraw \\
  -u psk_live_xxx: \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 100,
    "currency": "GHS",
    "destination": "BANK_ACCOUNT",
    "destinationLabel": "Ecobank ****1234"
  }'`,
      node: `const res = await fetch('/api/customer/wallet/withdraw', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + process.env.PAYSWAP_SECRET_KEY,
  },
  body: JSON.stringify({
    amount: 100,
    currency: 'GHS',
    destination: 'BANK_ACCOUNT',
  }),
});`,
      python: `import requests
res = requests.post(
    '${BASE}/api/customer/wallet/withdraw',
    auth=(os.environ['PAYSWAP_SECRET_KEY'], ''),
    json={'amount': 100, 'currency': 'GHS', 'destination': 'BANK_ACCOUNT'},
)`,
      responses: [
        {
          status: 200,
          label: 'Withdrawal scheduled',
          body: `{
  "ok": true,
  "wallet": { "id": "wlt_01", "balance": 150 },
  "transaction": { "id": "wtx_02", "type": "DEBIT", "amount": -100 }
}`,
        },
        {
          status: 422,
          label: 'Insufficient funds',
          body: `{ "error": "Insufficient wallet funds for this withdrawal" }`,
        },
      ],
    },
    {
      id: 'customer-wallet-transfer',
      method: 'POST',
      path: '/api/customer/wallet/transfer',
      title: 'Transfer to another wallet',
      description:
        'Atomically moves funds from the customer\'s wallet to another PaySwap customer or merchant. Both sides of the ledger move in a single transaction — if either fails, the whole transfer rolls back.',
      auth: 'session',
      params: [
        { name: 'recipientType', type: 'string', required: true, description: 'Recipient type.', enum: ['CUSTOMER', 'MERCHANT'] },
        { name: 'recipientId', type: 'string', required: true, description: 'Recipient customer or merchant id.' },
        { name: 'amount', type: 'number', required: true, description: 'Amount to transfer.' },
        { name: 'currency', type: 'string', required: true, description: 'Wallet currency.', enum: ['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR'] },
        { name: 'note', type: 'string', required: false, description: 'Optional memo attached to the transfer.' },
      ],
      curl: `curl ${BASE}/api/customer/wallet/transfer \\
  -u psk_live_xxx: \\
  -H "Content-Type: application/json" \\
  -d '{
    "recipientType": "CUSTOMER",
    "recipientId": "cus_01HABCDE",
    "amount": 50,
    "currency": "GHS",
    "note": "Splitting dinner"
  }'`,
      node: `const res = await fetch('/api/customer/wallet/transfer', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + process.env.PAYSWAP_SECRET_KEY,
  },
  body: JSON.stringify({
    recipientType: 'CUSTOMER',
    recipientId: 'cus_01HABCDE',
    amount: 50,
    currency: 'GHS',
  }),
});`,
      python: `import requests
res = requests.post(
    '${BASE}/api/customer/wallet/transfer',
    auth=(os.environ['PAYSWAP_SECRET_KEY'], ''),
    json={'recipientType': 'CUSTOMER', 'recipientId': 'cus_01HABCDE', 'amount': 50, 'currency': 'GHS'},
)`,
      responses: [
        {
          status: 200,
          label: 'Transfer completed',
          body: `{
  "ok": true,
  "recipient": { "type": "CUSTOMER", "id": "cus_01HABCDE", "name": "Kofi Mensah" },
  "senderTransaction": { "id": "wtx_03", "type": "DEBIT", "amount": -50, "txHash": "xfer_01" }
}`,
        },
        {
          status: 404,
          label: 'Recipient not found',
          body: `{ "error": "Recipient not found" }`,
        },
      ],
    },
    {
      id: 'customer-invoice-pay',
      method: 'POST',
      path: '/api/customer/invoices/{id}/pay',
      title: 'Pay an invoice from wallet',
      description:
        'Pays an invoice directly from the customer\'s wallet balance. The wallet must be in the same currency as the invoice and have sufficient available balance. The invoice is marked PAID and a Payment record is created atomically.',
      auth: 'session',
      params: [
        { name: 'id', type: 'string', required: true, description: 'Invoice id (path parameter).' },
      ],
      curl: `curl ${BASE}/api/customer/invoices/inv_01HABCDE/pay \\
  -u psk_live_xxx: \\
  -X POST`,
      node: `const res = await fetch('/api/customer/invoices/inv_01HABCDE/pay', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + process.env.PAYSWAP_SECRET_KEY },
});
const { invoice, payment } = await res.json();`,
      python: `import requests
res = requests.post(
    '${BASE}/api/customer/invoices/inv_01HABCDE/pay',
    auth=(os.environ['PAYSWAP_SECRET_KEY'], ''),
)
invoice, payment = res.json()['invoice'], res.json()['payment']`,
      responses: [
        {
          status: 200,
          label: 'Invoice paid',
          body: `{
  "ok": true,
  "invoice": { "id": "inv_01HABCDE", "status": "PAID" },
  "payment": { "id": "pay_01", "status": "COMPLETED", "method": "QR" },
  "walletBalance": 175
}`,
        },
        {
          status: 422,
          label: 'Already paid',
          body: `{ "error": "Invoice already paid" }`,
        },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ────────────────────────────────────────────────────────────────────────────
const notifications: EndpointGroup = {
  id: 'notifications',
  label: 'Notifications',
  description:
    'The notifications endpoint returns the most recent audit-log entries relevant to the current user. Relevance is computed server-side based on the user\'s roles — merchants see payment/payout/refund entries, compliance officers see AML/KYC/sanction entries, treasury sees reserve/corridor entries, and so on.',
  endpoints: [
    {
      id: 'notifications-list',
      method: 'GET',
      path: '/api/notifications',
      title: 'List notifications',
      description:
        'Returns the 10 most recent audit-log entries relevant to the authenticated user. The bell icon in the unified shell header polls this endpoint every 30 seconds.',
      auth: 'session',
      params: [],
      curl: `curl ${BASE}/api/notifications \\
  -u psk_live_xxx:`,
      node: `const res = await fetch('/api/notifications', {
  headers: { Authorization: 'Bearer ' + process.env.PAYSWAP_SECRET_KEY },
});
const { items } = await res.json();`,
      python: `import requests
res = requests.get(
    '${BASE}/api/notifications',
    auth=(os.environ['PAYSWAP_SECRET_KEY'], ''),
)
items = res.json()['items']`,
      responses: [
        {
          status: 200,
          label: 'Recent notifications',
          body: `{
  "items": [
    {
      "id": "al_01",
      "action": "PAYMENT.CREATE",
      "resourceType": "PAYMENT",
      "resourceId": "pay_01",
      "result": "SUCCESS",
      "description": "Payment · PAYMENT",
      "category": "payment",
      "createdAt": "2026-07-28T11:58:42.000Z"
    }
  ]
}`,
        },
        {
          status: 401,
          label: 'Unauthenticated',
          body: `{ "error": "Unauthorized" }`,
        },
      ],
    },
  ],
};

export const API_DOC_GROUPS: EndpointGroup[] = [
  payments,
  refunds,
  payouts,
  customers,
  invoices,
  webhooks,
  apiKeys,
  activity,
  lp,
  treasury,
  customerWallet,
  notifications,
  developer,
  webhookEvents,
];

export const AUTH_LABELS: Record<AuthRequirement, string> = {
  session: 'Authenticated session',
  merchant: 'Merchant session',
  admin: 'Admin session',
  lp: 'LP session',
  treasury: 'Treasury session',
  public: 'Public',
};
