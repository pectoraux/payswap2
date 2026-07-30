/**
 * Accounting Extension — Manifest v2.
 *
 * Double-entry bookkeeping with journal entries, reconciliation, P&L
 * generation, and ledger export. Subscribes to payment.completed (revenue),
 * delivery.delivered (COGS), and loyalty.points_awarded (marketing expense).
 */

import type { ExtensionManifestV2 } from '@/extension-platform/types';

export const accountingManifest: ExtensionManifestV2 = {
  // ── Identity ──
  id: 'accounting',
  name: 'Accounting',
  version: '1.0.0',
  publisher: {
    id: 'pub_ledger_co',
    name: 'Ledger Co',
    email: 'dev@ledger.co',
    website: 'https://ledger.co',
    verified: true,
  },
  description: 'Double-entry bookkeeping for the modern merchant. Records journal entries with strict debit/credit balance validation, reconciles accounts, generates P&L reports, and exports ledgers. Auto-records entries from payment.completed (revenue), delivery.delivered (COGS), and loyalty.points_awarded (marketing expense). Uses exact Money — never float.',
  homepage: 'https://ledger.co/accounting',
  license: 'MIT',
  repository: 'https://github.com/ledger-co/accounting',
  documentationUrl: 'https://docs.ledger.co/accounting',
  supportUrl: 'https://support.ledger.co',
  category: 'ANALYTICS',
  tags: ['accounting', 'bookkeeping', 'ledger', 'journal', 'pnl', 'reconciliation', 'finance', 'double-entry'],
  screenshots: [
    'https://ledger.co/screenshots/dashboard.png',
    'https://ledger.co/screenshots/journal.png',
  ],

  // ── Capabilities ──
  capabilities: [
    { name: 'Record Journal Entry', description: 'Record a double-entry journal entry. Debits must equal credits (ACID guarantee).', category: 'accounting', produces: ['asset.journal_entry'], requires: [], universal: false },
    { name: 'Reconcile', description: 'Reconcile an account against an external statement. Produces a reconciliation report.', category: 'accounting', produces: ['asset.reconciliation_report'], requires: ['asset.journal_entry'], universal: false },
    { name: 'Generate P&L', description: 'Generate a Profit & Loss report for a period (revenue − expenses).', category: 'accounting', produces: ['asset.pnl_report'], requires: ['asset.journal_entry'], universal: false },
    { name: 'Export Ledger', description: 'Export the full ledger (all journal entries) for a period or account.', category: 'accounting', produces: [], requires: ['asset.journal_entry'], universal: false },
  ],

  // ── Assets ──
  assets: [
    { id: 'asset.journal_entry', name: 'Journal Entry', type: 'RECEIPT', unit: 'entry', description: 'A double-entry journal entry.' },
    { id: 'asset.reconciliation_report', name: 'Reconciliation Report', type: 'RECEIPT', unit: 'report', description: 'An account reconciliation report.' },
    { id: 'asset.pnl_report', name: 'P&L Report', type: 'RECEIPT', unit: 'report', description: 'A Profit & Loss report.' },
  ],

  // ── Tokens ──
  tokens: [],

  // ── Events ──
  events: [
    { type: 'emits', eventType: 'accounting.entry_recorded', description: 'A journal entry was recorded.' },
    { type: 'emits', eventType: 'accounting.reconciled', description: 'An account was reconciled.' },
    { type: 'consumes', eventType: 'payment.completed', description: 'Record a revenue entry on payment.' },
    { type: 'consumes', eventType: 'delivery.delivered', description: 'Record a COGS entry on delivery.' },
    { type: 'consumes', eventType: 'loyalty.points_awarded', description: 'Record a marketing expense entry on points award.' },
  ],

  // ── Providers ──
  providers: [],

  // ── Policies ──
  policies: [
    { name: 'Balanced Books', rule: 'require_balanced_entry', enforcement: 'BLOCK', description: 'Every journal entry must have equal debits and credits (double-entry invariant).' },
  ],

  // ── Routes ──
  routes: [
    { path: '/api/accounting/entry', method: 'POST', handler: 'recordEntry', authRequired: true, permissions: ['money'] },
    { path: '/api/accounting/ledger', method: 'GET', handler: 'getLedger', authRequired: true, permissions: ['money'] },
    { path: '/api/accounting/pnl', method: 'GET', handler: 'generatePnL', authRequired: true, permissions: ['money'] },
    { path: '/api/accounting/reconcile', method: 'POST', handler: 'reconcile', authRequired: true, permissions: ['money'] },
  ],

  // ── UI ──
  ui: [
    { type: 'nav', label: 'Accounting', path: '/dashboard/accounting', icon: 'Calculator', group: 'Finance', order: 40 },
    { type: 'page', label: 'Journal Entries', path: '/dashboard/accounting/journal', icon: 'BookOpen', group: 'Finance' },
    { type: 'page', label: 'Chart of Accounts', path: '/dashboard/accounting/accounts', icon: 'ListTree', group: 'Finance' },
    { type: 'page', label: 'P&L Report', path: '/dashboard/accounting/pnl', icon: 'TrendingUp', group: 'Finance' },
    { type: 'settings', label: 'Accounting Configuration', path: '/dashboard/settings/accounting', icon: 'Settings' },
  ],

  // ── Scheduled Jobs ──
  scheduledJobs: [
    { id: 'period-close', name: 'Period Close Check', schedule: '0 0 1 * *', handler: 'periodClose' },
    { id: 'reconcile-reminder', name: 'Reconciliation Reminder', schedule: '0 9 * * 1', handler: 'reconcileReminder' },
  ],

  // ── Health Checks ──
  healthChecks: [
    { id: 'ledger-balance', name: 'Ledger Balance', handler: 'checkLedgerBalance', timeoutMs: 5000 },
    { id: 'account-db', name: 'Account Database', handler: 'checkAccountDB', timeoutMs: 3000 },
  ],

  // ── Migrations ──
  migrations: [
    { version: '1.0.0', up: 'CREATE TABLE journal_entries (...)', down: 'DROP TABLE journal_entries' },
  ],

  // ── Dependencies ──
  dependencies: [],
  conflicts: [],
  provides: ['accounting'],

  // ── Permissions ──
  permissions: [
    { scope: 'money', access: 'read', reason: 'Read payment and expense amounts to record journal entries.' },
    { scope: 'money', access: 'write', reason: 'Record exact Money amounts in journal entries.' },
    { scope: 'storage', access: 'write', reason: 'Store journal entries, reconciliation reports, and P&L reports.' },
    { scope: 'events', access: 'read', reason: 'Listen for payment.completed, delivery.delivered, loyalty.points_awarded.' },
  ],

  // ── Compatibility ──
  compatibility: {
    minPaySwapVersion: '1.0.0',
    maxTestedPaySwapVersion: '1.2.0',
    breakingChanges: 'None — this is the initial release.',
    upgradeNotes: 'Run the v1.0.0 migration on install.',
    rollbackNotes: 'Drop the journal_entries table on uninstall.',
  },

  // ── Billing ──
  billing: {
    model: 'SUBSCRIPTION',
    price: 49,
    currency: 'USD',
    interval: 'MONTHLY',
    trialDays: 14,
  },

  createdAt: Date.now(),
  updatedAt: Date.now(),
};
