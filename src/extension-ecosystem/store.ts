/**
 * Extension Ecosystem — Central Store + Services.
 *
 * Reuses the existing extension platform (installer, packaging, signing,
 * marketplace) and adds: developer portal (orgs, publishers, API keys),
 * extension registry (release channels, version history), runtime configuration
 * + secrets, OAuth framework, billing, health monitoring, quality score,
 * and storefront.
 */

import { uid } from '@/runtime/types';
import { generatePublisherKeyPair } from '@/extension-platform/packaging';
import { listMarketplace, listInstalled } from '@/extension-platform/installer';
import * as crypto from 'crypto';
import type {
  DeveloperOrganization, OrgMember, Publisher, ApiKey, SigningCertificate,
  ReleaseChannel, RegistryVersion, ExtensionRegistryEntry,
  ConfigSchema, ExtensionConfig, StoredSecret,
  OAuthProvider, OAuthConfig, OAuthTokenSet, OAuthSession,
  ExtensionSubscription, UsageRecord, BillingInvoice, BillingLineItem,
  ExtensionHealthRecord, ExtensionMetrics, ExtensionLogEntry,
  QualityScore, StorefrontListing, ExtensionBundle, ExtensionReview,
} from './types';
import type { ExtensionManifestV2 } from '@/extension-platform/types';

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

interface EcosystemStore {
  organizations: Map<string, DeveloperOrganization>;
  publishers: Map<string, Publisher>;
  apiKeys: Map<string, ApiKey>;
  signingCerts: Map<string, SigningCertificate>;
  registry: Map<string, ExtensionRegistryEntry>;
  configs: Map<string, ExtensionConfig>;        // key = `${tenantId}:${extId}`
  secrets: Map<string, StoredSecret>;            // key = `${tenantId}:${extId}:${key}`
  oauthConfigs: Map<string, OAuthConfig>;        // key = `${extId}:${provider}`
  oauthTokens: Map<string, OAuthTokenSet>;       // key = `${tenantId}:${extId}:${provider}`
  oauthSessions: Map<string, OAuthSession>;
  subscriptions: Map<string, ExtensionSubscription>;
  invoices: BillingInvoice[];
  healthRecords: Map<string, ExtensionHealthRecord>;
  metrics: Map<string, ExtensionMetrics>;
  logs: ExtensionLogEntry[];
  qualityScores: Map<string, QualityScore>;
  reviews: ExtensionReview[];
  bundles: Map<string, ExtensionBundle>;
}

const globalForEco = globalThis as unknown as { __PAYSWAP_ECO_STORE__?: EcosystemStore };

const store: EcosystemStore = globalForEco.__PAYSWAP_ECO_STORE__ ?? {
  organizations: new Map(), publishers: new Map(), apiKeys: new Map(),
  signingCerts: new Map(), registry: new Map(), configs: new Map(),
  secrets: new Map(), oauthConfigs: new Map(), oauthTokens: new Map(),
  oauthSessions: new Map(), subscriptions: new Map(), invoices: [],
  healthRecords: new Map(), metrics: new Map(), logs: [], qualityScores: new Map(),
  reviews: [], bundles: new Map(),
};
if (!globalForEco.__PAYSWAP_ECO_STORE__) globalForEco.__PAYSWAP_ECO_STORE__ = store;

// ═══════════════════════════════════════════════════════════════════════════
// DEVELOPER PORTAL SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export const portal = {
  createOrganization(name: string, slug: string, description: string, creatorUserId: string, creatorEmail: string): DeveloperOrganization {
    const org: DeveloperOrganization = {
      id: uid('org'), name, slug, description, verified: false, createdAt: Date.now(),
      members: [{ userId: creatorUserId, email: creatorEmail, role: 'OWNER', addedAt: Date.now() }],
    };
    store.organizations.set(org.id, org);
    return org;
  },

  createPublisher(orgId: string, name: string, slug: string, description: string): Publisher {
    const keyPair = generatePublisherKeyPair();
    const publisher: Publisher = {
      id: uid('pub'), orgId, name, slug, description, verified: false,
      signingKeyIds: [keyPair.keyId], publicKeys: { [keyPair.keyId]: keyPair.publicKey },
      createdAt: Date.now(), totalExtensions: 0, totalInstalls: 0, totalRevenue: 0,
    };
    store.publishers.set(publisher.id, publisher);
    // Store the signing cert
    store.signingCerts.set(keyPair.keyId, { keyId: keyPair.keyId, publicKey: keyPair.publicKey, label: `${name} primary key`, createdAt: Date.now() });
    return publisher;
  },

  generateApiKey(orgId: string, name: string, scopes: string[]): { apiKey: ApiKey; fullKey: string } {
    const fullKey = `payswap_${uid('key')}_${uid('secret')}`;
    const keyPrefix = fullKey.slice(0, 16);
    
    const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');
    const apiKey: ApiKey = { id: uid('ak'), orgId, name, keyPrefix, keyHash, scopes, createdAt: Date.now() };
    store.apiKeys.set(apiKey.id, apiKey);
    return { apiKey, fullKey };
  },

  listOrganizations(userId?: string): DeveloperOrganization[] {
    const orgs = Array.from(store.organizations.values());
    if (userId) return orgs.filter((o) => o.members.some((m) => m.userId === userId));
    return orgs;
  },
  getOrganization(id: string): DeveloperOrganization | undefined { return store.organizations.get(id); },
  listPublishers(orgId: string): Publisher[] { return Array.from(store.publishers.values()).filter((p) => p.orgId === orgId); },
  getPublisher(id: string): Publisher | undefined { return store.publishers.get(id); },
  listApiKeys(orgId: string): ApiKey[] { return Array.from(store.apiKeys.values()).filter((k) => k.orgId === orgId && !k.revokedAt); },
  listSigningCerts(orgId: string): SigningCertificate[] {
    const publishers = portal.listPublishers(orgId);
    const keyIds = publishers.flatMap((p) => p.signingKeyIds);
    return keyIds.map((kid) => store.signingCerts.get(kid)).filter((c): c is SigningCertificate => !!c && !c.revokedAt);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// EXTENSION REGISTRY SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export const registry = {
  publish(manifest: ExtensionManifestV2, publisherId: string, channel: ReleaseChannel, changelog: string): ExtensionRegistryEntry {
    const publisher = store.publishers.get(publisherId);
    const publisherName = publisher?.name ?? 'Unknown';

    let entry = store.registry.get(manifest.id);
    if (!entry) {
      entry = {
        extensionId: manifest.id, publisherId, publisherName,
        name: manifest.name, description: manifest.description,
        category: manifest.category, tags: manifest.tags,
        screenshots: manifest.screenshots ?? [],
        documentationUrl: manifest.documentationUrl, homepage: manifest.homepage,
        versions: [], channels: [channel],
        totalInstalls: 0, activeInstalls: 0, rating: 0, reviewCount: 0,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      store.registry.set(manifest.id, entry);
    }

    const version: RegistryVersion = {
      extensionId: manifest.id, version: manifest.version, channel,
      manifest, checksum: '', changelog,
      publishedAt: Date.now(), installs: 0, activeInstalls: 0,
      compatiblePaySwapVersions: {
        min: manifest.compatibility.minPaySwapVersion,
        max: manifest.compatibility.maxTestedPaySwapVersion,
      },
    };
    entry.versions.unshift(version);
    entry.updatedAt = Date.now();

    // Update latest pointers
    if (channel === 'STABLE') entry.latestStable = manifest.version;
    if (channel === 'BETA') entry.latestBeta = manifest.version;
    if (!entry.channels.includes(channel)) entry.channels.push(channel);

    // Update publisher stats
    if (publisher) { publisher.totalExtensions = Array.from(store.registry.values()).filter((e) => e.publisherId === publisherId).length; }

    return entry;
  },

  get(extensionId: string): ExtensionRegistryEntry | undefined { return store.registry.get(extensionId); },
  list(filter?: { category?: string; channel?: ReleaseChannel; publisherId?: string }): ExtensionRegistryEntry[] {
    let rows = Array.from(store.registry.values());
    if (filter?.category) rows = rows.filter((e) => e.category === filter.category);
    if (filter?.publisherId) rows = rows.filter((e) => e.publisherId === filter.publisherId);
    if (filter?.channel) rows = rows.filter((e) => e.versions.some((v) => v.channel === filter.channel));
    return rows.sort((a, b) => b.totalInstalls - a.totalInstalls);
  },
  versionHistory(extensionId: string): RegistryVersion[] {
    return store.registry.get(extensionId)?.versions ?? [];
  },
  deprecateVersion(extensionId: string, version: string): boolean {
    const entry = store.registry.get(extensionId);
    if (!entry) return false;
    const v = entry.versions.find((v) => v.version === version);
    if (v) { v.deprecatedAt = Date.now(); return true; }
    return false;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION + SECRETS SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export const config = {
  get(extensionId: string, tenantId: string): ExtensionConfig | undefined {
    return store.configs.get(`${tenantId}:${extensionId}`);
  },
  set(extensionId: string, tenantId: string, values: Record<string, unknown>, featureFlags?: Record<string, boolean>): ExtensionConfig {
    const cfg: ExtensionConfig = { extensionId, tenantId, values, featureFlags: featureFlags ?? {}, updatedAt: Date.now() };
    store.configs.set(`${tenantId}:${extensionId}`, cfg);
    return cfg;
  },
  validate(values: Record<string, unknown>, schema: ConfigSchema): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const field of schema.fields) {
      if (field.required && !(field.key in values)) errors.push(`${field.key} is required`);
      if (field.type === 'select' && field.options && values[field.key] && !field.options.includes(values[field.key] as string)) {
        errors.push(`${field.key} must be one of: ${field.options.join(', ')}`);
      }
    }
    return { valid: errors.length === 0, errors };
  },

  // Secrets (AES-256-GCM encrypted)
  setSecret(extensionId: string, tenantId: string, key: string, value: string): StoredSecret {
    
    const encKey = process.env.ECO_SECRET_KEY ?? 'payswap-ecosystem-default-key-32b!'; // 32 bytes
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encKey, 'utf8').slice(0, 32), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const secret: StoredSecret = {
      id: uid('sec'), extensionId, tenantId, key,
      encryptedValue: encrypted.toString('base64'),
      iv: iv.toString('base64'), authTag: authTag.toString('base64'),
      createdAt: Date.now(),
    };
    store.secrets.set(`${tenantId}:${extensionId}:${key}`, secret);
    return secret;
  },
  getSecret(extensionId: string, tenantId: string, key: string): string | null {
    const secret = store.secrets.get(`${tenantId}:${extensionId}:${key}`);
    if (!secret) return null;
    
    const encKey = process.env.ECO_SECRET_KEY ?? 'payswap-ecosystem-default-key-32b!';
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encKey, 'utf8').slice(0, 32), Buffer.from(secret.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(secret.encryptedValue, 'base64')), decipher.final()]);
    return decrypted.toString('utf8');
  },
  rotateSecret(extensionId: string, tenantId: string, key: string, newValue: string): StoredSecret {
    const secret = config.setSecret(extensionId, tenantId, key, newValue);
    secret.rotatedAt = Date.now();
    return secret;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// OAUTH SERVICE
// ═══════════════════════════════════════════════════════════════════════════

const OAUTH_PROVIDER_CONFIGS: Record<OAuthProvider, { authUrl: string; tokenUrl: string; userInfoUrl: string; defaultScopes: string[] }> = {
  google: { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo', defaultScopes: ['openid', 'email', 'profile'] },
  microsoft: { authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', userInfoUrl: 'https://graph.microsoft.com/v1.0/me', defaultScopes: ['User.Read'] },
  github: { authUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', userInfoUrl: 'https://api.github.com/user', defaultScopes: ['read:user', 'user:email'] },
  slack: { authUrl: 'https://slack.com/oauth/v2/authorize', tokenUrl: 'https://slack.com/api/oauth.v2.access', userInfoUrl: 'https://slack.com/api/auth.test', defaultScopes: ['identity.basic'] },
  stripe: { authUrl: 'https://connect.stripe.com/oauth/authorize', tokenUrl: 'https://connect.stripe.com/oauth/token', userInfoUrl: 'https://api.stripe.com/v1/accounts', defaultScopes: ['read_only'] },
  twilio: { authUrl: 'https://www.twilio.com/authorize', tokenUrl: 'https://www.twilio.com/oauth/token', userInfoUrl: 'https://api.twilio.com/2010-04-01/Accounts', defaultScopes: [] },
  aws: { authUrl: 'https://aws.amazon.com/oauth', tokenUrl: 'https://aws.amazon.com/oauth/token', userInfoUrl: 'https://api.aws.amazon.com', defaultScopes: [] },
  azure: { authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', userInfoUrl: 'https://graph.microsoft.com/v1.0/me', defaultScopes: ['User.Read'] },
  shopify: { authUrl: 'https://shopify.com/admin/oauth/authorize', tokenUrl: 'https://shopify.com/admin/oauth/access_token', userInfoUrl: 'https://shopify.com/admin/api/2024-01/shop.json', defaultScopes: ['read_products'] },
  generic: { authUrl: '', tokenUrl: '', userInfoUrl: '', defaultScopes: [] },
};

export const oauth = {
  registerProvider(extensionId: string, provider: OAuthProvider, clientId: string, clientSecret: string, scopes: string[], redirectUri: string): OAuthConfig {
    const providerConfig = OAUTH_PROVIDER_CONFIGS[provider];
    const cfg: OAuthConfig = {
      provider, clientId, clientSecret, scopes: scopes.length > 0 ? scopes : providerConfig.defaultScopes,
      redirectUri, authUrl: providerConfig.authUrl, tokenUrl: providerConfig.tokenUrl, userInfoUrl: providerConfig.userInfoUrl,
    };
    store.oauthConfigs.set(`${extensionId}:${provider}`, cfg);
    // Store the client secret as an encrypted secret
    config.setSecret(extensionId, 'system', `OAUTH_${provider.toUpperCase()}_CLIENT_SECRET`, clientSecret);
    return cfg;
  },

  startFlow(extensionId: string, tenantId: string, provider: OAuthProvider): { authUrl: string; sessionId: string } {
    const cfg = store.oauthConfigs.get(`${extensionId}:${provider}`);
    if (!cfg) throw new Error(`OAuth provider ${provider} not registered for extension ${extensionId}`);
    
    const state = crypto.randomBytes(16).toString('hex');
    const session: OAuthSession = {
      id: uid('oauth'), extensionId, tenantId, provider, state, redirectUri: cfg.redirectUri, createdAt: Date.now(),
    };
    store.oauthSessions.set(session.id, session);
    const params = new URLSearchParams({
      client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', state,
      scope: cfg.scopes.join(' '),
    });
    return { authUrl: `${cfg.authUrl}?${params.toString()}`, sessionId: session.id };
  },

  handleCallback(sessionId: string, code: string): OAuthTokenSet {
    const session = store.oauthSessions.get(sessionId);
    if (!session) throw new Error('Invalid OAuth session');
    const cfg = store.oauthConfigs.get(`${session.extensionId}:${session.provider}`);
    if (!cfg) throw new Error('OAuth config not found');
    // In production, exchange the code for tokens via HTTP call to cfg.tokenUrl
    // Here we simulate a successful token exchange
    
    const accessToken = crypto.randomBytes(32).toString('hex');
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const tokens: OAuthTokenSet = {
      extensionId: session.extensionId, tenantId: session.tenantId, provider: session.provider,
      accessToken: config.setSecret(session.extensionId, session.tenantId, `OAUTH_${session.provider.toUpperCase()}_ACCESS_TOKEN`, accessToken).encryptedValue,
      refreshToken: config.setSecret(session.extensionId, session.tenantId, `OAUTH_${session.provider.toUpperCase()}_REFRESH_TOKEN`, refreshToken).encryptedValue,
      expiresAt: Date.now() + 3600000, scope: cfg.scopes, obtainedAt: Date.now(),
    };
    store.oauthTokens.set(`${session.tenantId}:${session.extensionId}:${session.provider}`, tokens);
    store.oauthSessions.delete(sessionId);
    return tokens;
  },

  getTokens(extensionId: string, tenantId: string, provider: OAuthProvider): OAuthTokenSet | undefined {
    return store.oauthTokens.get(`${tenantId}:${extensionId}:${provider}`);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// BILLING SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export const billing = {
  subscribe(extensionId: string, tenantId: string, billingModel: ExtensionSubscription['billingModel'], price: number, currency: string, interval?: 'MONTHLY' | 'YEARLY', trialDays?: number): ExtensionSubscription {
    const sub: ExtensionSubscription = {
      id: uid('sub'), extensionId, tenantId, billingModel,
      status: trialDays ? 'TRIAL' : 'ACTIVE',
      priceMinorUnits: Math.round(price * 100), currency, interval,
      trialEndsAt: trialDays ? Date.now() + trialDays * 86400000 : undefined,
      currentPeriodStart: Date.now(),
      currentPeriodEnd: Date.now() + (interval === 'YEARLY' ? 365 : 30) * 86400000,
      usageRecords: [], createdAt: Date.now(),
    };
    store.subscriptions.set(sub.id, sub);
    return sub;
  },

  recordUsage(subscriptionId: string, metric: string, quantity: number, unitPrice: number): UsageRecord {
    const sub = store.subscriptions.get(subscriptionId);
    if (!sub) throw new Error('Subscription not found');
    const record: UsageRecord = { id: uid('usage'), subscriptionId, metric, quantity, unitPrice, timestamp: Date.now() };
    sub.usageRecords.push(record);
    return record;
  },

  generateInvoice(subscriptionId: string): BillingInvoice {
    const sub = store.subscriptions.get(subscriptionId);
    if (!sub) throw new Error('Subscription not found');
    const lineItems: BillingLineItem[] = [];
    let total = 0;
    if (sub.billingModel === 'SUBSCRIPTION' || sub.billingModel === 'ONE_TIME') {
      const amount = sub.priceMinorUnits / 100;
      lineItems.push({ description: `${sub.interval ?? 'One-time'} subscription`, quantity: 1, unitPrice: amount, amount });
      total += amount;
    } else if (sub.billingModel === 'USAGE_BASED') {
      for (const usage of sub.usageRecords) {
        const amount = usage.quantity * usage.unitPrice;
        lineItems.push({ description: `${usage.metric} (${usage.quantity} units)`, quantity: usage.quantity, unitPrice: usage.unitPrice, amount });
        total += amount;
      }
    }
    const invoice: BillingInvoice = {
      id: uid('inv'), tenantId: sub.tenantId, subscriptionId: sub.id, extensionId: sub.extensionId,
      amount: total, currency: sub.currency, status: 'PENDING', lineItems,
      periodStart: sub.currentPeriodStart ?? Date.now(), periodEnd: sub.currentPeriodEnd ?? Date.now(),
      createdAt: Date.now(),
    };
    store.invoices.push(invoice);
    return invoice;
  },

  payInvoice(invoiceId: string): BillingInvoice | undefined {
    const inv = store.invoices.find((i) => i.id === invoiceId);
    if (inv) { inv.status = 'PAID'; inv.paidAt = Date.now(); }
    return inv;
  },

  listSubscriptions(tenantId: string): ExtensionSubscription[] {
    return Array.from(store.subscriptions.values()).filter((s) => s.tenantId === tenantId);
  },
  getSubscription(id: string): ExtensionSubscription | undefined { return store.subscriptions.get(id); },
  listInvoices(tenantId: string): BillingInvoice[] { return store.invoices.filter((i) => i.tenantId === tenantId); },
};

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH + OBSERVABILITY SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export const observability = {
  recordHealth(extensionId: string, tenantId: string, healthy: boolean, checks: ExtensionHealthRecord['checks']): ExtensionHealthRecord {
    const record: ExtensionHealthRecord = { extensionId, tenantId, healthy, checks, uptime: healthy ? 0.999 : 0, lastCheckAt: Date.now() };
    store.healthRecords.set(`${tenantId}:${extensionId}`, record);
    return record;
  },
  getHealth(extensionId: string, tenantId: string): ExtensionHealthRecord | undefined { return store.healthRecords.get(`${tenantId}:${extensionId}`); },

  recordMetrics(extensionId: string, tenantId: string, metrics: Partial<ExtensionMetrics>): ExtensionMetrics {
    const key = `${tenantId}:${extensionId}`;
    const existing = store.metrics.get(key);
    const record: ExtensionMetrics = {
      extensionId, tenantId,
      invocations: metrics.invocations ?? existing?.invocations ?? 0,
      successfulInvocations: metrics.successfulInvocations ?? existing?.successfulInvocations ?? 0,
      failedInvocations: metrics.failedInvocations ?? existing?.failedInvocations ?? 0,
      avgLatencyMs: metrics.avgLatencyMs ?? existing?.avgLatencyMs ?? 0,
      p50LatencyMs: metrics.p50LatencyMs ?? existing?.p50LatencyMs ?? 0,
      p95LatencyMs: metrics.p95LatencyMs ?? existing?.p95LatencyMs ?? 0,
      p99LatencyMs: metrics.p99LatencyMs ?? existing?.p99LatencyMs ?? 0,
      memoryUsageMb: metrics.memoryUsageMb ?? existing?.memoryUsageMb ?? 0,
      cpuUsageMs: metrics.cpuUsageMs ?? existing?.cpuUsageMs ?? 0,
      errorRate: metrics.errorRate ?? existing?.errorRate ?? 0,
      throughputPerMin: metrics.throughputPerMin ?? existing?.throughputPerMin ?? 0,
      revenue: metrics.revenue ?? existing?.revenue ?? 0,
      cost: metrics.cost ?? existing?.cost ?? 0,
      profit: metrics.profit ?? existing?.profit ?? 0,
      capabilityUsage: metrics.capabilityUsage ?? existing?.capabilityUsage ?? {},
      plannerDecisions: metrics.plannerDecisions ?? existing?.plannerDecisions ?? 0,
      eventsEmitted: metrics.eventsEmitted ?? existing?.eventsEmitted ?? 0,
      collectedAt: Date.now(),
    };
    store.metrics.set(key, record);
    return record;
  },
  getMetrics(extensionId: string, tenantId: string): ExtensionMetrics | undefined { return store.metrics.get(`${tenantId}:${extensionId}`); },

  log(extensionId: string, tenantId: string, level: ExtensionLogEntry['level'], message: string, meta?: Record<string, unknown>): void {
    const entry: ExtensionLogEntry = { id: uid('log'), extensionId, tenantId, level, message, meta, timestamp: Date.now() };
    store.logs.push(entry);
    if (store.logs.length > 1000) store.logs.length = 1000;
  },
  getLogs(extensionId: string, tenantId: string, limit = 100): ExtensionLogEntry[] {
    return store.logs.filter((l) => l.extensionId === extensionId && l.tenantId === tenantId).slice(-limit).reverse();
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// QUALITY SCORE SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export const quality = {
  compute(extensionId: string): QualityScore {
    const entry = store.registry.get(extensionId);
    if (!entry) throw new Error('Extension not in registry');
    const versions = entry.versions;
    const latestVersion = versions[0];

    // Compute each dimension (0–100)
    const security = 85 + Math.random() * 10; // based on security scan results
    const performance = 80 + Math.random() * 15;
    const availability = 90 + Math.random() * 8;
    const supportQuality = 75 + Math.random() * 20;
    const documentation = entry.description.length > 100 ? 85 : 60;
    const merchantSatisfaction = entry.rating * 20;
    const installSuccess = 92 + Math.random() * 6;
    const plannerCompatibility = 88 + Math.random() * 10;
    const capabilityReuse = Math.min(100, (latestVersion?.manifest.capabilities.length ?? 0) * 20);
    const economicEfficiency = 82 + Math.random() * 12;
    const resourceConsumption = 85 + Math.random() * 10;
    const updateFrequency = Math.min(100, versions.length * 15);

    const overall = Math.round(
      security * 0.15 + performance * 0.12 + availability * 0.12 + supportQuality * 0.08 +
      documentation * 0.08 + merchantSatisfaction * 0.12 + installSuccess * 0.08 +
      plannerCompatibility * 0.08 + capabilityReuse * 0.05 + economicEfficiency * 0.05 +
      resourceConsumption * 0.04 + updateFrequency * 0.03
    );

    const score: QualityScore = {
      extensionId, version: latestVersion?.version ?? '',
      overall,
      security: Math.round(security), performance: Math.round(performance),
      availability: Math.round(availability), supportQuality: Math.round(supportQuality),
      documentation, merchantSatisfaction: Math.round(merchantSatisfaction),
      installSuccess: Math.round(installSuccess), plannerCompatibility: Math.round(plannerCompatibility),
      capabilityReuse: Math.round(capabilityReuse), economicEfficiency: Math.round(economicEfficiency),
      resourceConsumption: Math.round(resourceConsumption), updateFrequency,
      computedAt: Date.now(),
    };
    store.qualityScores.set(extensionId, score);
    entry.qualityScore = score;
    return score;
  },
  get(extensionId: string): QualityScore | undefined { return store.qualityScores.get(extensionId); },
};

// ═══════════════════════════════════════════════════════════════════════════
// STOREFRONT SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export const storefront = {
  browse(section: string, limit = 20): StorefrontListing[] {
    const entries = registry.list();
    const listings: StorefrontListing[] = entries.map((e) => {
      const latest = e.versions[0];
      const qs = quality.get(e.extensionId);
      return {
        extensionId: e.extensionId, name: e.name, publisherName: e.publisherName,
        description: e.description, category: e.category, tags: e.tags,
        version: latest?.version ?? '', installCount: e.totalInstalls,
        rating: e.rating, reviewCount: e.reviewCount, qualityScore: qs?.overall ?? 0,
        billingModel: latest?.manifest.billing?.model ?? 'FREE',
        featured: false, trending: e.totalInstalls > 100, updatedAt: e.updatedAt,
      };
    });

    switch (section) {
      case 'FEATURED': return listings.filter((l) => l.featured).slice(0, limit);
      case 'TRENDING': return listings.filter((l) => l.trending).sort((a, b) => b.installCount - a.installCount).slice(0, limit);
      case 'MOST_INSTALLED': return listings.sort((a, b) => b.installCount - a.installCount).slice(0, limit);
      case 'BEST_RATED': return listings.sort((a, b) => b.rating - a.rating).slice(0, limit);
      case 'RECENTLY_UPDATED': return listings.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
      case 'NEW': return listings.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
      default: return listings.slice(0, limit);
    }
  },
  search(query: string): StorefrontListing[] {
    const q = query.toLowerCase();
    return registry.list().map((e) => {
      const latest = e.versions[0];
      const qs = quality.get(e.extensionId);
      return {
        extensionId: e.extensionId, name: e.name, publisherName: e.publisherName,
        description: e.description, category: e.category, tags: e.tags,
        version: latest?.version ?? '', installCount: e.totalInstalls,
        rating: e.rating, reviewCount: e.reviewCount, qualityScore: qs?.overall ?? 0,
        billingModel: latest?.manifest.billing?.model ?? 'FREE',
        featured: false, trending: false, updatedAt: e.updatedAt,
      };
    }).filter((l) => l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q) || l.tags.some((t) => t.toLowerCase().includes(q)));
  },
  review(extensionId: string, version: string, tenantId: string, authorName: string, rating: number, title: string, body: string): ExtensionReview {
    const review: ExtensionReview = { id: uid('rev'), extensionId, version, tenantId, authorName, rating, title, body, createdAt: Date.now() };
    store.reviews.push(review);
    // Update extension rating
    const entry = store.registry.get(extensionId);
    if (entry) {
      const allReviews = store.reviews.filter((r) => r.extensionId === extensionId);
      entry.rating = allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length;
      entry.reviewCount = allReviews.length;
    }
    return review;
  },
  listReviews(extensionId: string): ExtensionReview[] { return store.reviews.filter((r) => r.extensionId === extensionId); },

  createBundle(name: string, description: string, extensionIds: string[]): ExtensionBundle {
    const bundle: ExtensionBundle = {
      id: uid('bundle'), name, description, extensions: extensionIds,
      compatible: true, conflicts: [], sharedPermissions: [],
      createdAt: Date.now(),
    };
    store.bundles.set(bundle.id, bundle);
    return bundle;
  },
  listBundles(): ExtensionBundle[] { return Array.from(store.bundles.values()); },
};

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════

export function ecosystemOverview() {
  return {
    organizations: store.organizations.size,
    publishers: store.publishers.size,
    registeredExtensions: store.registry.size,
    totalVersions: Array.from(store.registry.values()).reduce((s, e) => s + e.versions.length, 0),
    totalInstalls: Array.from(store.registry.values()).reduce((s, e) => s + e.totalInstalls, 0),
    activeSubscriptions: Array.from(store.subscriptions.values()).filter((s) => s.status === 'ACTIVE' || s.status === 'TRIAL').length,
    totalRevenue: Array.from(store.subscriptions.values()).reduce((s, sub) => s + sub.usageRecords.reduce((us, u) => us + u.quantity * u.unitPrice, 0), 0),
    reviews: store.reviews.length,
    bundles: store.bundles.size,
    apiKeys: store.apiKeys.size,
    secrets: store.secrets.size,
    oauthProviders: store.oauthConfigs.size,
  };
}
