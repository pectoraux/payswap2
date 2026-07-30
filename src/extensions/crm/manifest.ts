/**
 * CRM Extension — Manifest v2.
 *
 * Customer relationship management with pipeline stages, follow-ups, and
 * interaction logging. Subscribes to sale.completed (→ CLOSED_WON),
 * delivery.delivered (→ satisfaction follow-up), and loyalty.tier_upgraded
 * (→ account management follow-up).
 */

import type { ExtensionManifestV2 } from '@/extension-platform/types';

export const crmManifest: ExtensionManifestV2 = {
  // ── Identity ──
  id: 'crm',
  name: 'CRM',
  version: '1.0.0',
  publisher: {
    id: 'pub_relate_co',
    name: 'Relate Co',
    email: 'dev@relate.co',
    website: 'https://relate.co',
    verified: true,
  },
  description: 'Customer relationship management with a 7-stage pipeline (LEAD → QUALIFIED → PROPOSAL → NEGOTIATION → CLOSED_WON / CLOSED_LOST), follow-up scheduling, and interaction logging. Auto-moves customers to CLOSED_WON on sale.completed, creates satisfaction follow-ups on delivery.delivered, and account management follow-ups on loyalty.tier_upgraded.',
  homepage: 'https://relate.co/crm',
  license: 'MIT',
  repository: 'https://github.com/relate-co/crm',
  documentationUrl: 'https://docs.relate.co/crm',
  supportUrl: 'https://support.relate.co',
  category: 'ANALYTICS',
  tags: ['crm', 'customers', 'pipeline', 'sales', 'follow-up', 'interactions', 'relationships'],
  screenshots: [
    'https://relate.co/screenshots/dashboard.png',
    'https://relate.co/screenshots/pipeline.png',
  ],

  // ── Capabilities ──
  capabilities: [
    { name: 'Create Customer', description: 'Create a new customer record in the CRM pipeline.', category: 'crm', produces: ['asset.customer_record'], requires: [], universal: false },
    { name: 'Update Customer Pipeline', description: 'Move a customer between pipeline stages. Produces a stage change.', category: 'crm', produces: ['asset.pipeline_stage'], requires: ['asset.customer_record'], universal: false },
    { name: 'Create Follow-up', description: 'Schedule a follow-up task for a customer (call, email, meeting).', category: 'crm', produces: ['asset.follow_up'], requires: ['asset.customer_record'], universal: false },
    { name: 'Log Interaction', description: 'Log an interaction with a customer (call, email, meeting, note).', category: 'crm', produces: [], requires: ['asset.customer_record'], universal: false },
  ],

  // ── Assets ──
  assets: [
    { id: 'asset.customer_record', name: 'Customer Record', type: 'CREDENTIAL', unit: 'record', description: 'A CRM customer record.' },
    { id: 'asset.pipeline_stage', name: 'Pipeline Stage', type: 'CREDENTIAL', unit: 'stage', description: 'A pipeline stage assignment.' },
    { id: 'asset.follow_up', name: 'Follow-up', type: 'RESERVATION', unit: 'task', description: 'A scheduled follow-up task.' },
  ],

  // ── Tokens ──
  tokens: [],

  // ── Events ──
  events: [
    { type: 'emits', eventType: 'crm.customer_created', description: 'A customer record was created.' },
    { type: 'emits', eventType: 'crm.follow_up_created', description: 'A follow-up was scheduled.' },
    { type: 'emits', eventType: 'crm.stage_changed', description: 'A customer moved between pipeline stages.' },
    { type: 'consumes', eventType: 'sale.completed', description: 'Move customer to CLOSED_WON on sale.' },
    { type: 'consumes', eventType: 'delivery.delivered', description: 'Create a satisfaction follow-up on delivery.' },
    { type: 'consumes', eventType: 'loyalty.tier_upgraded', description: 'Create an account management follow-up on tier upgrade.' },
  ],

  // ── Providers ──
  providers: [],

  // ── Policies ──
  policies: [
    { name: 'Forward-Only Pipeline', rule: 'require_forward_progress', enforcement: 'WARN', description: 'Customers should generally move forward in the pipeline; backward moves require justification.' },
  ],

  // ── Routes ──
  routes: [
    { path: '/api/crm/customer', method: 'POST', handler: 'createCustomer', authRequired: true, permissions: ['customers'] },
    { path: '/api/crm/follow-up', method: 'POST', handler: 'createFollowUp', authRequired: true, permissions: ['customers'] },
    { path: '/api/crm/customers', method: 'GET', handler: 'listCustomers', authRequired: true, permissions: ['customers'] },
    { path: '/api/crm/pipeline', method: 'GET', handler: 'getPipeline', authRequired: true, permissions: ['customers'] },
  ],

  // ── UI ──
  ui: [
    { type: 'nav', label: 'CRM', path: '/dashboard/crm', icon: 'Users', group: 'Customers', order: 25 },
    { type: 'page', label: 'Pipeline', path: '/dashboard/crm/pipeline', icon: 'GitBranch', group: 'Customers' },
    { type: 'page', label: 'Follow-ups', path: '/dashboard/crm/follow-ups', icon: 'CalendarClock', group: 'Customers' },
    { type: 'page', label: 'Interactions', path: '/dashboard/crm/interactions', icon: 'MessageSquare', group: 'Customers' },
    { type: 'settings', label: 'CRM Configuration', path: '/dashboard/settings/crm', icon: 'Settings' },
  ],

  // ── Scheduled Jobs ──
  scheduledJobs: [
    { id: 'follow-up-reminder', name: 'Send Follow-up Reminders', schedule: '0 9 * * *', handler: 'sendFollowUpReminders' },
    { id: 'stale-lead-review', name: 'Review Stale Leads', schedule: '0 8 * * 1', handler: 'reviewStaleLeads' },
  ],

  // ── Health Checks ──
  healthChecks: [
    { id: 'customer-db', name: 'Customer Database', handler: 'checkCustomerDB', timeoutMs: 3000 },
    { id: 'notification-svc', name: 'Notification Service', handler: 'checkNotificationService', timeoutMs: 3000 },
  ],

  // ── Migrations ──
  migrations: [
    { version: '1.0.0', up: 'CREATE TABLE crm_customers (...)', down: 'DROP TABLE crm_customers' },
  ],

  // ── Dependencies ──
  dependencies: [],
  conflicts: [],
  provides: ['crm'],

  // ── Permissions ──
  permissions: [
    { scope: 'customers', access: 'write', reason: 'Create and update customer records, pipeline stages, follow-ups, and interactions.' },
    { scope: 'customers', access: 'read', reason: 'List customers and pipeline views.' },
    { scope: 'notifications', access: 'write', reason: 'Send follow-up reminders to account managers.' },
  ],

  // ── Compatibility ──
  compatibility: {
    minPaySwapVersion: '1.0.0',
    maxTestedPaySwapVersion: '1.2.0',
    breakingChanges: 'None — this is the initial release.',
    upgradeNotes: 'Run the v1.0.0 migration on install.',
    rollbackNotes: 'Drop the crm_customers table on uninstall.',
  },

  // ── Billing ──
  billing: {
    model: 'SUBSCRIPTION',
    price: 19,
    currency: 'USD',
    interval: 'MONTHLY',
    trialDays: 14,
  },

  createdAt: Date.now(),
  updatedAt: Date.now(),
};
