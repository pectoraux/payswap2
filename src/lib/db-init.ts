/**
 * Database initialization for serverless environments.
 *
 * On Vercel (and other serverless platforms), the filesystem is read-only
 * except for /tmp. SQLite databases must live in /tmp and be initialized
 * on each cold start.
 *
 * This module ensures the database schema exists and is seeded.
 * It's idempotent — safe to call on every request.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

let initialized = false;
let initializing: Promise<void> | null = null;

const DB_PATH = process.env.DATABASE_URL?.includes('/tmp/')
  ? process.env.DATABASE_URL
  : process.env.NODE_ENV === 'production'
    ? 'file:/tmp/payswap.db'
    : process.env.DATABASE_URL;

// Ensure DATABASE_URL points to /tmp in production
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL?.includes('/tmp/')) {
  process.env.DATABASE_URL = 'file:/tmp/payswap.db';
}

/**
 * Ensure the database is initialized with schema + seed data.
 * Safe to call multiple times — only runs once per cold start.
 */
export async function ensureDbInitialized(): Promise<void> {
  if (initialized) return;
  if (initializing) return initializing;

  initializing = initializeDb();
  await initializing;
  initialized = true;
}

async function initializeDb(): Promise<void> {
  try {
    // In production, we need to create the schema using raw SQL
    // since `prisma db push` isn't available at runtime.
    const db = new PrismaClient();

    try {
      // Check if the users table exists (indicates schema is set up)
      const tableExists = await db.$queryRawUnsafe(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='User'`
      ).catch(() => []);

      if (!Array.isArray(tableExists) || tableExists.length === 0) {
        // Schema doesn't exist — we need to create it
        // On Vercel, we can't run `prisma db push` at runtime,
        // so we create tables via raw SQL
        console.log('[db-init] Creating database schema...');
        await createSchema(db);
        console.log('[db-init] Seeding database...');
        await seedDb(db);
        console.log('[db-init] Database ready.');
      }
    } finally {
      await db.$disconnect();
    }
  } catch (e) {
    console.error('[db-init] Failed:', e);
    // Non-fatal — the app will return errors for DB operations
  }
}

async function createSchema(db: InstanceType<PrismaClient>): Promise<void> {
  // Create all tables via raw SQL (matching the Prisma schema)
  const statements = [
    `CREATE TABLE IF NOT EXISTS "User" (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, "passwordHash" TEXT, name TEXT, phone TEXT, "avatarUrl" TEXT, status TEXT NOT NULL DEFAULT 'PENDING', "emailVerified" DATETIME, "lastLoginAt" DATETIME, "lastLoginIp" TEXT, "mfaEnabled" BOOLEAN NOT NULL DEFAULT 0, "mfaSecret" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "deletedAt" DATETIME);`,
    `CREATE TABLE IF NOT EXISTS "UserRole" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, role TEXT NOT NULL, "merchantId" TEXT, permissions TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE);`,
    `CREATE TABLE IF NOT EXISTS "Session" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, token TEXT NOT NULL UNIQUE, "expiresAt" DATETIME NOT NULL, ip TEXT, "userAgent" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE);`,
    `CREATE TABLE IF NOT EXISTS "WaitlistEntry" (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, company TEXT, phone TEXT, country TEXT NOT NULL, "businessType" TEXT, status TEXT NOT NULL DEFAULT 'PENDING', notes TEXT, "reviewedBy" TEXT, "reviewedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);`,
    `CREATE TABLE IF NOT EXISTS "Account" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "deletedAt" DATETIME, FOREIGN KEY ("userId") REFERENCES "User"(id));`,
    `CREATE TABLE IF NOT EXISTS "Merchant" (id TEXT PRIMARY KEY, "accountId" TEXT NOT NULL UNIQUE, name TEXT NOT NULL, "legalName" TEXT, email TEXT NOT NULL UNIQUE, phone TEXT, country TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'GHS', website TEXT, "logoUrl" TEXT, description TEXT, "businessType" TEXT, "registrationNumber" TEXT, "taxId" TEXT, address TEXT, tier TEXT NOT NULL DEFAULT 'UNVERIFIED', bond REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'PENDING', "kycLevel" INTEGER NOT NULL DEFAULT 0, settings TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "deletedAt" DATETIME, FOREIGN KEY ("accountId") REFERENCES "Account"(id));`,
    `CREATE TABLE IF NOT EXISTS "Customer" (id TEXT PRIMARY KEY, "accountId" TEXT UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, country TEXT, metadata TEXT, "totalSpent" REAL NOT NULL DEFAULT 0, "transactionCount" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "deletedAt" DATETIME, FOREIGN KEY ("accountId") REFERENCES "Account"(id));`,
    `CREATE TABLE IF NOT EXISTS "CustomerRecord" (id TEXT PRIMARY KEY, "merchantId" TEXT NOT NULL, "customerId" TEXT, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, country TEXT, metadata TEXT, "totalSpent" REAL NOT NULL DEFAULT 0, "transactionCount" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "deletedAt" DATETIME, FOREIGN KEY ("merchantId") REFERENCES "Merchant"(id), FOREIGN KEY ("customerId") REFERENCES "Customer"(id));`,
    `CREATE TABLE IF NOT EXISTS "LPProfile" (id TEXT PRIMARY KEY, "accountId" TEXT NOT NULL UNIQUE, name TEXT NOT NULL, country TEXT NOT NULL, currencies TEXT NOT NULL, tier TEXT NOT NULL DEFAULT 'verified', stake REAL NOT NULL DEFAULT 0, collateral REAL NOT NULL DEFAULT 0, capacity TEXT, reputation REAL NOT NULL DEFAULT 0.5, status TEXT NOT NULL DEFAULT 'pending', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, FOREIGN KEY ("accountId") REFERENCES "Account"(id));`,
    `CREATE TABLE IF NOT EXISTS "Wallet" (id TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0, "pendingBalance" REAL NOT NULL DEFAULT 0, "lockedBalance" REAL NOT NULL DEFAULT 0, "isDefault" BOOLEAN NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, FOREIGN KEY ("accountId") REFERENCES "Account"(id));`,
    `CREATE TABLE IF NOT EXISTS "WalletTransaction" (id TEXT PRIMARY KEY, "walletId" TEXT NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, counterparty TEXT, reference TEXT, "txHash" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("walletId") REFERENCES "Wallet"(id) ON DELETE CASCADE);`,
    `CREATE TABLE IF NOT EXISTS "Payment" (id TEXT PRIMARY KEY, "merchantId" TEXT NOT NULL, "customerId" TEXT, amount REAL NOT NULL, currency TEXT NOT NULL, "sourceCurrency" TEXT, "destinationCurrency" TEXT, status TEXT NOT NULL DEFAULT 'PENDING', method TEXT, corridor TEXT, "lpId" TEXT, fee REAL NOT NULL DEFAULT 0, "netAmount" REAL NOT NULL DEFAULT 0, "fxRate" REAL NOT NULL DEFAULT 1, "txHash" TEXT, evidence TEXT, reference TEXT, description TEXT, metadata TEXT, "failureReason" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "settledAt" DATETIME, FOREIGN KEY ("merchantId") REFERENCES "Merchant"(id), FOREIGN KEY ("customerId") REFERENCES "Customer"(id));`,
    `CREATE TABLE IF NOT EXISTS "Payout" (id TEXT PRIMARY KEY, "merchantId" TEXT NOT NULL, method TEXT NOT NULL, "sourceAmount" REAL NOT NULL, "sourceAsset" TEXT NOT NULL, "sourceCurrency" TEXT NOT NULL, "destinationCurrency" TEXT NOT NULL, destination TEXT, "fxRate" REAL NOT NULL DEFAULT 1, "feeBps" INTEGER NOT NULL DEFAULT 50, fee REAL NOT NULL DEFAULT 0, "netAmount" REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'REQUESTED', "txHash" TEXT, evidence TEXT, reason TEXT, "failureReason" TEXT, "approvedBy" TEXT, "approvedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "processedAt" DATETIME, "completedAt" DATETIME, FOREIGN KEY ("merchantId") REFERENCES "Merchant"(id));`,
    `CREATE TABLE IF NOT EXISTS "Refund" (id TEXT PRIMARY KEY, "merchantId" TEXT NOT NULL, "paymentId" TEXT NOT NULL, amount REAL NOT NULL, type TEXT NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'PENDING', "requestedBy" TEXT NOT NULL, "approvedBy" TEXT, "processedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("merchantId") REFERENCES "Merchant"(id), FOREIGN KEY ("paymentId") REFERENCES "Payment"(id));`,
    `CREATE TABLE IF NOT EXISTS "Product" (id TEXT PRIMARY KEY, "merchantId" TEXT NOT NULL, name TEXT NOT NULL, description TEXT, price REAL NOT NULL, currency TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'PHYSICAL', "imageUrl" TEXT, metadata TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "deletedAt" DATETIME, FOREIGN KEY ("merchantId") REFERENCES "Merchant"(id));`,
    `CREATE TABLE IF NOT EXISTS "Invoice" (id TEXT PRIMARY KEY, "merchantId" TEXT NOT NULL, "customerId" TEXT, number TEXT NOT NULL, items TEXT NOT NULL, subtotal REAL NOT NULL, tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', "dueDate" DATETIME, "sentAt" DATETIME, "paidAt" DATETIME, "paymentId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, FOREIGN KEY ("merchantId") REFERENCES "Merchant"(id), FOREIGN KEY ("customerId") REFERENCES "Customer"(id));`,
    `CREATE TABLE IF NOT EXISTS "Subscription" (id TEXT PRIMARY KEY, "merchantId" TEXT NOT NULL, "customerId" TEXT, "planName" TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, interval TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', "currentPeriodStart" DATETIME, "currentPeriodEnd" DATETIME, "trialEnd" DATETIME, "canceledAt" DATETIME, "lastPaymentAt" DATETIME, "failedAttempts" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, FOREIGN KEY ("merchantId") REFERENCES "Merchant"(id));`,
    `CREATE TABLE IF NOT EXISTS "PaymentLink" (id TEXT PRIMARY KEY, "merchantId" TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, description TEXT, reference TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', url TEXT NOT NULL UNIQUE, "expiresAt" DATETIME, "paymentCount" INTEGER NOT NULL DEFAULT 0, "totalCollected" REAL NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("merchantId") REFERENCES "Merchant"(id));`,
    `CREATE TABLE IF NOT EXISTS "ApiKey" (id TEXT PRIMARY KEY, "merchantId" TEXT NOT NULL, label TEXT NOT NULL, "keyPrefix" TEXT NOT NULL, "keyHash" TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, "lastUsedAt" DATETIME, "lastUsedIp" TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', "expiresAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("merchantId") REFERENCES "Merchant"(id));`,
    `CREATE TABLE IF NOT EXISTS "WebhookEndpoint" (id TEXT PRIMARY KEY, "merchantId" TEXT NOT NULL, url TEXT NOT NULL, "secretHash" TEXT NOT NULL, events TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("merchantId") REFERENCES "Merchant"(id));`,
    `CREATE TABLE IF NOT EXISTS "WebhookDelivery" (id TEXT PRIMARY KEY, "endpointId" TEXT NOT NULL, "eventType" TEXT NOT NULL, payload TEXT NOT NULL, signature TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0, "responseStatus" INTEGER, "responseBody" TEXT, "nextRetryAt" DATETIME, "deliveredAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"(id) ON DELETE CASCADE);`,
    `CREATE TABLE IF NOT EXISTS "TeamMember" (id TEXT PRIMARY KEY, "merchantId" TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', "invitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "joinedAt" DATETIME, "userId" TEXT, FOREIGN KEY ("merchantId") REFERENCES "Merchant"(id), FOREIGN KEY ("userId") REFERENCES "User"(id));`,
    `CREATE TABLE IF NOT EXISTS "ComplianceReview" (id TEXT PRIMARY KEY, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', data TEXT, "reviewerId" TEXT, "reviewedAt" DATETIME, notes TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);`,
    `CREATE TABLE IF NOT EXISTS "AMLAlert" (id TEXT PRIMARY KEY, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "alertType" TEXT NOT NULL, severity TEXT NOT NULL, score REAL NOT NULL, details TEXT, status TEXT NOT NULL DEFAULT 'OPEN', "assignedTo" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "closedAt" DATETIME);`,
    `CREATE TABLE IF NOT EXISTS "SAR" (id TEXT PRIMARY KEY, "caseId" TEXT, "filedBy" TEXT NOT NULL, narrative TEXT NOT NULL, amount REAL NOT NULL, entities TEXT NOT NULL, "regulatoryRef" TEXT, status TEXT NOT NULL DEFAULT 'DRAFT', "filedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);`,
    `CREATE TABLE IF NOT EXISTS "AuditLog" (id TEXT PRIMARY KEY, "userId" TEXT, action TEXT NOT NULL, "resourceType" TEXT NOT NULL, "resourceId" TEXT, result TEXT NOT NULL, ip TEXT, "userAgent" TEXT, details TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("userId") REFERENCES "User"(id));`,
    `CREATE TABLE IF NOT EXISTS "SimulationRun" (id TEXT PRIMARY KEY, "runId" TEXT NOT NULL UNIQUE, "kernelVersion" TEXT NOT NULL, "scenarioName" TEXT NOT NULL, scenario TEXT NOT NULL, result TEXT NOT NULL, "resultHash" TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, priority TEXT NOT NULL, "buyerCountry" TEXT NOT NULL, "merchantCountry" TEXT NOT NULL, "costPercent" REAL NOT NULL, "settlementMs" INTEGER NOT NULL, "riskScore" REAL NOT NULL, confidence REAL NOT NULL, settled BOOLEAN NOT NULL DEFAULT 0, amendments INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);`,
    `CREATE TABLE IF NOT EXISTS "EventRecord" (id TEXT PRIMARY KEY, "eventId" TEXT NOT NULL UNIQUE, type TEXT NOT NULL, payload TEXT NOT NULL, ts BIGINT NOT NULL, frame INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);`,
    // Create indexes
    `CREATE INDEX IF NOT EXISTS "User_status_idx" ON "User"("status");`,
    `CREATE INDEX IF NOT EXISTS "UserRole_userId_idx" ON "UserRole"("userId");`,
    `CREATE INDEX IF NOT EXISTS "UserRole_merchantId_idx" ON "UserRole"("merchantId");`,
    `CREATE INDEX IF NOT EXISTS "Account_userId_idx" ON "Account"("userId");`,
    `CREATE INDEX IF NOT EXISTS "Merchant_status_idx" ON "Merchant"("status");`,
    `CREATE INDEX IF NOT EXISTS "Payment_merchantId_status_idx" ON "Payment"("merchantId", "status");`,
    `CREATE INDEX IF NOT EXISTS "Payment_createdAt_idx" ON "Payment"("createdAt");`,
    `CREATE INDEX IF NOT EXISTS "Payout_merchantId_status_idx" ON "Payout"("merchantId", "status");`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Wallet_accountId_currency_key" ON "Wallet"("accountId", "currency");`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "TeamMember_merchantId_email_key" ON "TeamMember"("merchantId", "email");`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "UserRole_userId_role_merchantId_key" ON "UserRole"("userId", "role", "merchantId");`,
  ];

  for (const sql of statements) {
    await db.$executeRawUnsafe(sql).catch(() => {});
  }
}

async function seedDb(db: InstanceType<PrismaClient>): Promise<void> {
  const ph = await bcrypt.hash('Payswap123456', 12);

  // Admin
  await db.user.upsert({
    where: { email: 'ekontetevi@gmail.com' },
    update: {},
    create: { id: 'user_admin', email: 'ekontetevi@gmail.com', passwordHash: ph, name: 'Tetevi Placide Ekon', phone: '+233244000000', status: 'ACTIVE', emailVerified: new Date(), roles: { create: [{ role: 'SUPER_ADMIN' }] } },
  });

  // Merchant
  const mu = await db.user.upsert({ where: { email: 'merchant@payswap.demo' }, update: {}, create: { id: 'user_merchant', email: 'merchant@payswap.demo', passwordHash: ph, name: 'Kwame Asante', phone: '+233244111111', status: 'ACTIVE', emailVerified: new Date() } });
  const ma = await db.account.create({ data: { id: 'acc_merchant', userId: mu.id, type: 'MERCHANT', status: 'ACTIVE', merchant: { create: { id: 'mch_demo', name: 'Accra Coffee Co.', email: 'merchant@payswap.demo', phone: '+233244111111', country: 'Ghana', currency: 'GHS', description: 'Single-origin Ghanaian cocoa.', tier: 'TRUSTED', bond: 5000, status: 'ACTIVE', kycLevel: 2 } } }, include: { merchant: true } });
  await db.userRole.create({ data: { userId: mu.id, role: 'MERCHANT', merchantId: 'mch_demo' } });
  await db.wallet.create({ data: { accountId: ma.id, name: 'GHS Wallet', currency: 'GHS', balance: 25000, isDefault: true } });
  await db.product.createMany({ data: [
    { merchantId: 'mch_demo', name: 'Cocoa Bag (500g)', description: 'Premium cocoa.', price: 75, currency: 'GHS', status: 'ACTIVE' },
    { merchantId: 'mch_demo', name: 'Dark Roast Coffee (1kg)', description: 'Rich dark roast.', price: 120, currency: 'GHS', status: 'ACTIVE' },
  ]});
  await db.customerRecord.createMany({ data: [
    { merchantId: 'mch_demo', name: 'Ama Serwaa', email: 'ama@example.com', phone: '+233244222222', country: 'Ghana', totalSpent: 450, transactionCount: 6 },
    { merchantId: 'mch_demo', name: 'Kofi Boateng', email: 'kofi@example.com', phone: '+233244333333', country: 'Ghana', totalSpent: 280, transactionCount: 4 },
  ]});
  for (let i = 0; i < 12; i++) {
    const amt = [50,75,120,150,200,75,50,120,300,75,200,150][i];
    await db.payment.create({ data: { merchantId: 'mch_demo', amount: amt, currency: 'GHS', status: 'COMPLETED', method: ['MOBILE_MONEY','BANK','QR','CHECKOUT'][i%4], fee: Math.round(amt*0.005*100)/100, netAmount: Math.round(amt*0.995*100)/100, fxRate: 1, reference: `PAY-${String(i+1).padStart(4,'0')}`, description: `Order #${i+1}`, settledAt: new Date(Date.now()-i*3600000) } });
  }
  await db.payout.create({ data: { merchantId: 'mch_demo', method: 'BANK', sourceAmount: 1000, sourceAsset: 'TWINGHS', sourceCurrency: 'GHS', destinationCurrency: 'GHS', destination: '{}', fxRate: 1, feeBps: 50, fee: 5, netAmount: 995, status: 'COMPLETED', txHash: 'bank_tx_'+uuidv4().slice(0,8), evidence: '{}', completedAt: new Date() } });
  await db.apiKey.create({ data: { merchantId: 'mch_demo', label: 'Production', keyPrefix: 'psk_live_xxxx', keyHash: await bcrypt.hash('psk_live_demo',10), scopes: '["payments:read","payments:write"]', status: 'ACTIVE' } });
  await db.webhookEndpoint.create({ data: { merchantId: 'mch_demo', url: 'https://accracoffee.gh/webhooks/payswap', secretHash: await bcrypt.hash('wh_sec_demo',10), events: '["payment.created","payment.completed"]', status: 'ACTIVE' } });
  await db.teamMember.create({ data: { merchantId: 'mch_demo', email: 'merchant@payswap.demo', role: 'OWNER', status: 'ACTIVE', joinedAt: new Date(), userId: mu.id } });

  // Customer
  const cu = await db.user.upsert({ where: { email: 'customer@payswap.demo' }, update: {}, create: { id: 'user_customer', email: 'customer@payswap.demo', passwordHash: ph, name: 'Ama Serwaa', phone: '+233244222222', status: 'ACTIVE', emailVerified: new Date(), roles: { create: [{ role: 'CUSTOMER' }] } } });
  const ca = await db.account.create({ data: { id: 'acc_customer', userId: cu.id, type: 'CUSTOMER', status: 'ACTIVE', customer: { create: { name: 'Ama Serwaa', email: 'customer@payswap.demo', phone: '+233244222222', country: 'Ghana', totalSpent: 450, transactionCount: 6 } } } });
  await db.wallet.create({ data: { accountId: ca.id, name: 'GHS Wallet', currency: 'GHS', balance: 500, isDefault: true } });

  // LP
  const lu = await db.user.upsert({ where: { email: 'lp@payswap.demo' }, update: {}, create: { id: 'user_lp', email: 'lp@payswap.demo', passwordHash: ph, name: 'Acacia Liquidity', phone: '+254722000000', status: 'ACTIVE', emailVerified: new Date(), roles: { create: [{ role: 'LP' }] } } });
  await db.account.create({ data: { id: 'acc_lp', userId: lu.id, type: 'LP', status: 'ACTIVE', lpProfile: { create: { name: 'Acacia Liquidity Provider', country: 'Kenya', currencies: '["KES","GHS"]', tier: 'trusted', stake: 200000, collateral: 200000, reputation: 0.85, status: 'active' } } } });

  // Other roles
  for (const [id, email, name, role] of [['user_treasury','treasury@payswap.demo','Treasury Operator','TREASURY'],['user_compliance','compliance@payswap.demo','Compliance Officer','COMPLIANCE'],['user_support','support@payswap.demo','Support Agent','SUPPORT'],['user_ops','ops@payswap.demo','Operations Engineer','OPERATIONS'],['user_dev','developer@payswap.demo','Developer','DEVELOPER']] as const) {
    await db.user.upsert({ where: { email }, update: {}, create: { id, email, passwordHash: ph, name, status: 'ACTIVE', emailVerified: new Date(), roles: { create: [{ role }] } } });
  }

  // Waitlist
  await db.waitlistEntry.upsert({ where: { email: 'waitlist1@example.com' }, update: {}, create: { email: 'waitlist1@example.com', name: 'John Doe', company: 'Doe Trading', country: 'Nigeria', businessType: 'SMALL_BUSINESS', status: 'PENDING' } });
  await db.waitlistEntry.upsert({ where: { email: 'waitlist2@example.com' }, update: {}, create: { email: 'waitlist2@example.com', name: 'Jane Smith', company: 'Smith Retail', country: 'Kenya', businessType: 'ENTERPRISE', status: 'PENDING' } });

  console.log('[db-init] Seed complete.');
}
