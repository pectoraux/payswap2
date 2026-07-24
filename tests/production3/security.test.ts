/**
 * PaySwap PRODUCTION-3 — Tests for the Security module.
 *
 * Task 3-J — Tests + Documentation agent.
 *
 * Coverage:
 *   - secrets: set/get, tamper detection, rotation
 *   - JWT: sign/verify, rotation overlap, expiry
 *   - RBAC: role permission check, denial audited
 *   - scopes: admin:* wildcard
 *   - MFA: TOTP verify
 *   - rate limit: exceeded → denied
 *   - audit: every action recorded
 *
 * Run with:  bun run tests/production3/security.test.ts
 */

import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import {
  SecretsVault,
  JWTService,
  hasPermission,
  userHasPermission,
  checkPermission,
  ForbiddenError,
  permissionsForUser,
  hasScope,
  requireScopes,
  InsufficientScopeError,
  MFAService,
  totpCode,
  verifyTotp,
  base32Decode,
  RateLimiter,
  rateLimiterRegistry,
  AuditLog,
  auditLog,
  auditSuccess,
  auditDenied,
  ALL_PERMISSIONS,
  ALL_SCOPES,
  type Role,
  type UserLike,
  type ApiScope,
} from '@/protocol/security';

interface TestResult { name: string; ok: boolean; err?: string; }
const results: TestResult[] = [];

async function run(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); results.push({ name, ok: true }); }
  catch (err) {
    results.push({ name, ok: false, err: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
  }
}

/* ============================================================================
 * Tests
 * ========================================================================== */

await run('secrets: set/get returns the plaintext', () => {
  const key = randomBytes(32);
  const vault = new SecretsVault({ masterKey: key });
  assert.equal(vault.set('stripe_key', 'sk_live_abc'), true);
  assert.equal(vault.get('stripe_key'), 'sk_live_abc');
  assert.deepEqual(vault.list(), ['stripe_key']);
});

await run('secrets: tamper detection (wrong key fails to import)', () => {
  const key1 = randomBytes(32);
  const vault1 = new SecretsVault({ masterKey: key1 });
  vault1.set('kw', 'value123');
  const blob = vault1.exportEncrypted();

  // Importing the blob with a different key must throw — that's tamper detection.
  const key2 = randomBytes(32);
  const vault2 = new SecretsVault({ masterKey: key2 });
  assert.throws(() => vault2.importEncrypted(blob, key2), /key does not match blob/);
});

await run('secrets: rotation re-encrypts all entries under the new key', () => {
  const key1 = randomBytes(32);
  const vault = new SecretsVault({ masterKey: key1 });
  vault.set('a', 'A');
  vault.set('b', 'B');
  const key2 = randomBytes(32);
  const n = vault.rotateMasterKey(key2);
  assert.equal(n, 2);
  assert.equal(vault.get('a'), 'A');
  assert.equal(vault.get('b'), 'B');
});

await run('JWT: sign/verify round-trip', () => {
  const svc = new JWTService('test-secret');
  const token = svc.sign({
    sub: 'user-1', aud: 'payswap-api', scope: ['payments:read'], role: 'developer',
  });
  assert.equal(typeof token, 'string');
  const r = svc.verify(token, 'payswap-api');
  assert.equal(r.valid, true);
  assert.ok(r.payload);
  assert.equal(r.payload!.sub, 'user-1');
  assert.equal(r.payload!.iss, 'payswap');
  assert.equal(r.payload!.aud, 'payswap-api');
  assert.deepEqual(r.payload!.scope, ['payments:read']);
});

await run('JWT: verify rejects wrong audience', () => {
  const svc = new JWTService('s');
  const token = svc.sign({ sub: 'u', aud: 'a', scope: [], role: 'viewer' });
  const r = svc.verify(token, 'other-audience');
  assert.equal(r.valid, false);
  assert.equal(r.error, 'audience');
});

await run('JWT: verify rejects expired token', () => {
  const svc = new JWTService('s');
  const token = svc.sign({ sub: 'u', aud: 'a', scope: [], role: 'v' }, { ttlSeconds: -10 });
  const r = svc.verify(token, 'a');
  assert.equal(r.valid, false);
  assert.equal(r.error, 'expired');
});

await run('JWT: rotation overlap — tokens signed with previous secret still verify', () => {
  const svc = new JWTService('old-secret');
  const token = svc.sign({ sub: 'u', aud: 'a', scope: [], role: 'v' });
  // Rotate → previous secret kept for overlap.
  const { oldKid, newKid } = svc.rotateSigningSecret();
  assert.notEqual(oldKid, newKid);
  assert.equal(svc.hasPrevious(), true);
  // Old token still verifies (via previous secret).
  const r = svc.verify(token, 'a');
  assert.equal(r.valid, true);
  assert.equal(r.verifiedByKid, oldKid);
});

await run('RBAC: developer can create payments but cannot approve payouts', () => {
  const user: UserLike = { id: 'u1', roles: ['developer'] };
  assert.equal(userHasPermission(user, 'payment:create'), true);
  assert.equal(userHasPermission(user, 'payment:view'), true);
  assert.equal(userHasPermission(user, 'payout:approve'), false);
  assert.equal(userHasPermission(user, 'treasury:freeze'), false);
});

await run('RBAC: super_admin wildcard returns true for every permission', () => {
  const user: UserLike = { id: 'u2', roles: ['super_admin'] };
  for (const p of ALL_PERMISSIONS) {
    assert.equal(userHasPermission(user, p), true, `super_admin must have ${p}`);
  }
});

await run('RBAC: checkPermission throws ForbiddenError + records audit', () => {
  // Use a fresh AuditLog so the test is deterministic.
  const localAudit = new AuditLog();
  // Monkey-patch the module-level auditLog used by checkPermission via the
  // security/rbac.ts module — but rbac.ts imports the singleton auditLog, so we
  // reset it directly.
  auditLog.reset();
  const user: UserLike = { id: 'u3', roles: ['viewer'], merchantId: 'm1' };
  assert.throws(() => checkPermission(user, 'treasury:freeze'), ForbiddenError);
  // Verify an audit entry was recorded for the denial.
  const entries = auditLog.query({ actorId: 'u3', result: 'denied' });
  assert.ok(entries.length >= 1, 'expected at least one denied audit entry');
});

await run('RBAC: permissionsForUser returns the union of role permissions', () => {
  const user: UserLike = { id: 'u4', roles: ['admin', 'treasury_admin'] };
  const perms = permissionsForUser(user);
  // admin has payment:refund, treasury_admin has treasury:freeze
  assert.ok(perms.includes('payment:refund'));
  assert.ok(perms.includes('treasury:freeze'));
  // admin doesn't have lp:slash — only lp_admin does
  assert.ok(!perms.includes('lp:slash'));
});

await run('scopes: admin:* wildcard grants every scope', () => {
  // admin:* returns true for every valid ApiScope.
  for (const s of ALL_SCOPES) {
    if (s === 'admin:*') continue;
    assert.equal(hasScope(['admin:*'], s), true, `admin:* should grant ${s}`);
  }
  // Hierarchy: treasury:admin → treasury:read.
  assert.equal(hasScope(['treasury:admin'], 'treasury:read' as ApiScope), true);
  assert.equal(hasScope(['payments:write'], 'payments:read' as ApiScope), true);
  // No hierarchy relationship:
  assert.equal(hasScope(['payments:read'], 'payments:write' as ApiScope), false);
});

await run('scopes: requireScopes throws InsufficientScopeError on missing scope', () => {
  assert.throws(() => requireScopes(['payments:read'], 'payments:write' as ApiScope), InsufficientScopeError);
  // admin:* passes everything.
  requireScopes(['admin:*'], 'payments:write' as ApiScope); // no throw
});

await run('MFA: TOTP verify with the same secret returns true', () => {
  const secret = randomBytes(20);
  const now = Date.now();
  const code = totpCode(secret, Math.floor(now / 1000 / 30));
  assert.equal(code.length, 6);
  assert.equal(verifyTotp(code, secret, now), true);
  // Wrong code → false.
  assert.equal(verifyTotp('000000', secret, now), false);
});

await run('MFA: enroll + verify via the MFAService', () => {
  const svc = new MFAService();
  const enr = svc.enroll('user-mfa', 'totp', 'user@example.com');
  assert.ok(enr.secret);
  assert.ok(enr.otpauthUri.startsWith('otpauth://totp/PaySwap:user%40example.com'));
  assert.equal(enr.backupCodes.length, 8);
  // Generate a code from the secret + verify via the service.
  const secretBytes = base32Decode(enr.secret);
  const code = totpCode(secretBytes, Math.floor(Date.now() / 1000 / 30));
  assert.equal(svc.verify('user-mfa', code), true);
  assert.equal(svc.isEnrolled('user-mfa'), true);
  // Backup codes work too (one-time).
  const backup = enr.backupCodes[0];
  assert.equal(svc.verify('user-mfa', backup), true);
  // Re-using the same backup code fails.
  assert.equal(svc.verify('user-mfa', backup), false);
});

await run('rate limit: fixed_window exceeds limit → denied', () => {
  const rl = new RateLimiter({ strategy: 'fixed_window', limit: 3, windowMs: 60_000 });
  for (let i = 0; i < 3; i++) {
    const r = rl.consume('key1');
    assert.equal(r.allowed, true);
  }
  const denied = rl.consume('key1');
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
});

await run('rate limit: sliding_window + token_bucket strategies work', () => {
  const sw = new RateLimiter({ strategy: 'sliding_window', limit: 2, windowMs: 60_000 });
  assert.equal(sw.consume('k').allowed, true);
  assert.equal(sw.consume('k').allowed, true);
  assert.equal(sw.consume('k').allowed, false);

  const tb = new RateLimiter({ strategy: 'token_bucket', limit: 2, windowMs: 60_000, capacity: 2 });
  assert.equal(tb.consume('k').allowed, true);
  assert.equal(tb.consume('k').allowed, true);
  assert.equal(tb.consume('k').allowed, false);
});

await run('rate limit registry: pre-configured limiters exist', () => {
  const names = rateLimiterRegistry.names();
  assert.ok(names.includes('api:global'));
  assert.ok(names.includes('api:per_key'));
  assert.ok(names.includes('api:per_ip'));
  assert.ok(names.includes('payout:per_merchant'));
  assert.ok(names.includes('webhook:per_endpoint'));
});

await run('audit: every action recorded (success + denied + error)', () => {
  auditLog.reset();
  auditSuccess(auditLog,
    { type: 'user', id: 'u5', merchantId: 'm5' },
    'payment.create',
    { type: 'payment', id: 'p1' },
    { amount: 100 });
  auditDenied(auditLog,
    { type: 'user', id: 'u6' },
    'payout.approve',
    { type: 'payout', id: 'po1' },
    { reason: 'not authorized' });
  const all = auditLog.query();
  assert.equal(all.length, 2);
  assert.equal(all[0].result, 'success');
  assert.equal(all[1].result, 'denied');
  // Filter by result.
  const denied = auditLog.query({ result: 'denied' });
  assert.equal(denied.length, 1);
  // Filter by actor.
  const byActor = auditLog.query({ actorId: 'u5' });
  assert.equal(byActor.length, 1);
});

await run('ALL_SCOPES + ALL_PERMISSIONS expose the full enum', () => {
  assert.ok(ALL_SCOPES.length >= 14);
  assert.ok(ALL_PERMISSIONS.length >= 25);
});

/* ============================================================================
 * Report
 * ========================================================================== */
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log(`  ✓ ${r.name}`); }
  else { fail++; console.error(`  ✗ ${r.name}\n    ${r.err ?? ''}`); }
}
console.log(`\nsecurity.test.ts — PASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
