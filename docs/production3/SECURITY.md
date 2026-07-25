# PaySwap PRODUCTION-3 — Security Model

> How PaySwap authenticates, authorizes, and audits every privileged action.

## 1. Authentication

Two authentication flows:

### 1.1 API key (machine-to-machine)

```
client → request with `Authorization: Bearer psk_live_xxx`
       → middleware extracts key
       → looks up merchant by key prefix
       → validates key against merchantPlatform.createApiKey registry
       → attaches AuthContext { type: 'api_key', merchantId, scopes }
```

API keys are 32-byte random tokens prefixed with `psk_live_` (or `psk_test_`
in sandbox). They are stored hashed (SHA-256) — the plaintext is shown ONCE at
creation time.

```typescript
import { merchantPlatform } from '@/protocol/merchant/platform';
const apiKey = merchantPlatform.createApiKey(merchantId, 'Production CI', ['payments:write', 'webhooks:read']);
// Save apiKey.key — it's not retrievable later.
```

### 1.2 JWT (interactive users)

```
client → POST /api/auth/login { email, password, mfaCode? }
       → authService.login(...) verifies credentials + MFA
       → returns { accessToken, refreshToken }
       → subsequent requests include `Authorization: Bearer <accessToken>`
       → withAuth middleware verifies the JWT, attaches AuthContext
```

JWTs are HS256-signed with a rotating secret (see §6.2). The header includes a
`kid` (key id) so verifiers pick the correct secret during rotation overlap.

```typescript
import { jwtService } from '@/protocol/security';
const token = jwtService.sign({
  sub: 'user-1', aud: 'payswap-api',
  scope: ['payments:read', 'payments:write'],
  role: 'developer',
  merchantId: 'm-123',
});
// later:
const result = jwtService.verify(token, 'payswap-api');
if (result.valid) {
  console.log(result.payload.sub, result.payload.scope);
}
```

### 1.3 AuthContext

Both flows produce an `AuthContext` that downstream middleware + handlers
use for authorization:

```typescript
interface AuthContext {
  type: 'api_key' | 'jwt';
  userId?: string;
  merchantId?: string;
  role?: string;
  scopes: string[];
  ip?: string;
}
```

## 2. RBAC — role → permission matrix

Eight roles, each granting a fixed set of permissions. A user may have
multiple roles; the union is granted. `super_admin` is a wildcard (every
permission).

| Role              | Key permissions                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `viewer`          | `*:view` (read-only across the merchant account)                                                         |
| `analyst`         | viewer + `audit:export`                                                                                  |
| `developer`       | viewer + `payment:create` + `payment:refund` + `payout:request` + `webhook:setup` + `api_key:create` + `api_key:revoke` + `settings:update` |
| `admin`           | developer + `payout:approve` + `merchant:suspend` + `user:invite` + `user:remove` + `audit:export`      |
| `owner`           | admin + `user:manage`                                                                                    |
| `treasury_admin`  | `treasury:view` + `treasury:freeze` + `treasury:rebalance` + `treasury:draw` + `audit:view` + `audit:export` |
| `lp_admin`        | `lp:view` + `lp:register` + `lp:pause` + `lp:slash` + `audit:view` + `audit:export`                      |
| `super_admin`     | wildcard — every permission (29 total)                                                                   |

Full list of permissions (29 total):

```
payment:create | payment:refund | payment:view
payout:request | payout:approve | payout:view
merchant:onboard | merchant:verify | merchant:suspend | merchant:view
treasury:freeze | treasury:rebalance | treasury:draw | treasury:view
lp:register | lp:pause | lp:slash | lp:view
api_key:create | api_key:revoke | api_key:view
webhook:setup | webhook:view
user:invite | user:remove | user:manage
audit:view | audit:export
settings:update
```

### Denial audit

Every permission denial is recorded in the audit log AND emitted as a
`security.permission_denied` kernel event:

```typescript
import { checkPermission, type UserLike } from '@/protocol/security';

const user: UserLike = { id: 'u1', roles: ['viewer'], merchantId: 'm1' };
try {
  checkPermission(user, 'treasury:freeze');
} catch (err) {
  // ForbiddenError thrown + audit entry recorded + kernel event emitted.
}
```

## 3. API scopes — scope hierarchy

OAuth2-style fine-grained scopes gate API endpoints. A token's `scope` claim
is a string array; `admin:*` is a wildcard that grants every scope.

```
admin:*           → every scope (14 total)
treasury:admin    → treasury:read
lp:admin          → lp:read
ops:admin         → ops:read
payments:write    → payments:read
payouts:write     → payouts:read
webhooks:write    → webhooks:read
merchant:write    → merchant:read
```

```typescript
import { hasScope, requireScopes, ALL_SCOPES } from '@/protocol/security';

hasScope(['admin:*'], 'treasury:admin'); // true (wildcard)
hasScope(['treasury:admin'], 'treasury:read'); // true (hierarchy)
hasScope(['payments:read'], 'payments:write'); // false

requireScopes(tokenScopes, 'payments:write' as ApiScope); // throws InsufficientScopeError if missing
```

## 4. MFA — multi-factor authentication

TOTP (RFC 6238) using only Node built-in `crypto`. Compatible with Google
Authenticator, Authy, 1Password, etc.

- Secret: 20 random bytes, base32-encoded (RFC 4648).
- HMAC: SHA-1 over 8-byte big-endian time counter.
- Step: 30 seconds. Digits: 6. Window: ±1 (allows clock drift).
- Backup codes: 8 one-time codes, SHA-256 hashed at enrollment.

### Enrollment

```typescript
import { mfaService } from '@/protocol/security';

const enr = mfaService.enroll('user-1', 'totp', 'user@example.com');
// enr.secret = base32 secret (for manual entry)
// enr.otpauthUri = otpauth://totp/PaySwap:user%40example.com?secret=...&issuer=PaySwap&algorithm=SHA1&digits=6&period=30
// enr.backupCodes = ['1234567890', ...] (8 codes — show ONCE, never stored plaintext)

// Display enr.otpauthUri as a QR code + enr.backupCodes to the user.
```

### Verification

```typescript
mfaService.verify('user-1', '123456');   // TOTP code → true/false
mfaService.verify('user-1', '9876543210'); // backup code → true (one-time, then consumed)
```

Backup codes are one-time — once used, they're marked consumed and won't be
accepted again. `mfaService.remainingBackupCodes(userId)` returns how many are
left.

### MFA-required routes

```typescript
import { withMfaRequired } from '@/protocol/security';

export const POST = withMfaRequired(handler, { action: 'treasury.freeze' });
```

The middleware checks the request's `X-MFA-Code` header (or a recent MFA
session token) before invoking the handler. Failures are audit-logged.

## 5. Secrets vault

AES-256-GCM at rest. Random IV per secret. Auth tag provides tamper detection
(integrity). Master key may be provided directly OR derived from a passphrase
via scrypt (N=2^15, r=8, p=1, salt=random per vault).

```typescript
import { SecretsVault, randomBytes } from '@/protocol/security';
import { randomBytes as nodeRandomBytes } from 'node:crypto';

// Production: provide a 32-byte master key (from env / secrets manager).
const vault = new SecretsVault({ masterKey: nodeRandomBytes(32) });

vault.set('stripe_key', 'sk_live_xxx');
vault.get('stripe_key'); // 'sk_live_xxx'
vault.list();            // ['stripe_key']

// Rotation — re-encrypts every secret under a new key.
const newKey = nodeRandomBytes(32);
const count = vault.rotateMasterKey(newKey); // returns count of re-encrypted secrets
// old key is wiped from memory.

// Backup + restore.
const blob = vault.exportEncrypted();        // JSON blob (per-secret AES-GCM)
const restored = new SecretsVault({ masterKey: newKey });
restored.importEncrypted(blob, newKey);      // throws if key doesn't match
```

In production, set `PAYSWAP_MASTER_KEY` to a 64-char hex string (32 bytes).
If absent, the vault falls back to a dev passphrase and logs a warning
(NOT for production).

### Tamper detection

The GCM auth tag detects any tampering with the ciphertext or IV. Decryption
with the wrong key OR a tampered ciphertext throws / returns `undefined`
(depending on the call path). Importing a backup blob with the wrong key
throws `key does not match blob (decryption failed)`.

## 6. HSM — software vs remote

Two `HSMProvider` implementations:

- `SoftwareHSM` — uses Node's `crypto` for sign/verify. Suitable for
  development + low-stakes production. Keys never leave the process.
- `RemoteHSM` — proxies sign/verify to an external HSM (AWS CloudHSM, Azure
  Key Vault, YubiHSM) via a configurable endpoint. Keys NEVER leave the HSM.

```typescript
import { hsm, configureRemoteHSM, signEvidence } from '@/protocol/security';

// Default: SoftwareHSM.
const sig = signEvidence(evidence);

// Production: switch to RemoteHSM.
configureRemoteHSM({
  endpoint: 'https://hsm.payswap.internal',
  apiKey: process.env.HSM_API_KEY!,
  keyId: 'payswap-signing-key-1',
});
```

The HSM signs Evidence objects (HMAC-SHA256 or Ed25519, depending on the
provider). Downstream consumers verify with the HSM's public key.

## 7. Audit — what's logged, how to query

Every privileged action is audit-logged. The `AuditLog` is a ring buffer
(last 50k events) + a `security.audit` kernel event per record (so the
event-sourcing layer persists it).

### What's logged

| Field         | Description |
| ------------- | ----------- |
| `actor`       | `{ type, id, merchantId?, role?, scopes?, ip? }` — WHO |
| `action`      | e.g. `'payment.create'`, `'treasury.freeze'`, `'permission.denied'` |
| `resource`    | `{ type, id }` — WHICH resource was acted on |
| `result`      | `'success' | 'denied' | 'error'` |
| `ts`          | epoch ms |
| `correlation` | `{ traceId, spanId }` — links to the request's distributed trace |
| `details`     | structured fields (PII minimized) |

### Standard actions (31 total)

```
payment.create | payment.refund | payout.request | payout.process | payout.approve
merchant.onboard | merchant.verify | merchant.suspend
api_key.create | api_key.revoke | webhook.setup | webhook.delete
treasury.freeze | treasury.rebalance | treasury.draw
lp.register | lp.pause | lp.slash
login | logout | mfa.enroll | mfa.verify | mfa.disable
permission.denied | jwt.rotate | secrets.rotate | hsm.rotate
device.trust | device.revoke | rate_limit.exceeded
```

### Querying

```typescript
import { auditLog } from '@/protocol/security';

// All denied actions in the last hour.
auditLog.query({
  result: 'denied',
  since: Date.now() - 3_600_000,
});

// All actions by a user.
auditLog.query({ actorId: 'user-123' });

// All actions on a resource.
auditLog.query({ resourceType: 'payment', resourceId: 'pay-abc' });

// Actions in a trace.
auditLog.query({ traceId: 'trace-xyz' });

// Filter by multiple actions.
auditLog.query({ action: ['treasury.freeze', 'treasury.rebalance'] });
```

## 8. Rate limits

Pre-configured per-key + per-IP rate limiters (in `src/protocol/security/rate-limit.ts`):

| Limiter name             | Strategy       | Limit       | Window  | Capacity | Scope |
| ------------------------ | -------------- | ----------: | ------- | -------: | ----- |
| `api:global`             | token_bucket   | 1,000 rps   | 1s      | 1,000    | global |
| `api:per_key`            | token_bucket   | 100 rps     | 1s      | 100      | per API key |
| `api:per_ip`             | sliding_window | 60 req      | 60s     | —        | per IP |
| `payout:per_merchant`    | fixed_window   | 10 req      | 60s     | —        | per merchant |
| `webhook:per_endpoint`   | sliding_window | 5 req       | 3,600s  | —        | per endpoint |

### Strategies

- **fixed_window** — count requests in `[t, t+windowMs)`; reset at boundary.
  Simple, but allows brief bursts at the boundary.
- **sliding_window** — rolling window of request timestamps in last
  `windowMs`. Smoothest, but slightly more memory.
- **token_bucket** — tokens refill at `limit/windowMs` rate; consume per call.
  Allows bursts up to `capacity`.

### Custom limiters

```typescript
import { rateLimiterRegistry } from '@/protocol/security';

rateLimiterRegistry.register('custom:per_user', {
  strategy: 'sliding_window', limit: 30, windowMs: 60_000,
});

const result = rateLimiterRegistry.consume('custom:per_user', userId);
if (!result.allowed) {
  return new Response('Rate limited', { status: 429, headers: { 'X-RateLimit-Reset': String(result.resetAt) } });
}
```

### Per-endpoint limits (suggested)

| Endpoint                          | Limiter              | Key            |
| --------------------------------- | -------------------- | -------------- |
| `POST /api/payments`              | `api:per_key`        | API key        |
| `POST /api/merchant/payout`       | `payout:per_merchant`| merchantId     |
| `POST /api/webhooks/deliver`      | `webhook:per_endpoint`| endpointId    |
| `GET /api/protocol/health`        | (none — health probes must not be rate-limited) | — |

## 9. Device trust

For interactive user sessions, the `DeviceTrustService` tracks trusted devices
(by browser fingerprint + IP range). A new device triggers an MFA challenge;
trusted devices skip MFA for low-risk actions.

```typescript
import { deviceTrustService } from '@/protocol/security';

const check = deviceTrustService.check(userId, fingerprint, ip);
if (!check.trusted) {
  // Require MFA challenge.
}
```

Device trust levels: `trusted` (no MFA needed for low-risk actions),
`unverified` (MFA required), `blocked` (account access denied).

## 10. Security invariants

These properties MUST hold at all times:

1. **No privileged action without audit** — every `payment.create`,
   `treasury.freeze`, `payout.process`, etc. is recorded in the audit log +
   emitted as a `security.audit` kernel event.
2. **No permission denial without audit** — `checkPermission` records a
   `permission.denied` audit entry before throwing `ForbiddenError`.
3. **Secrets never stored in plaintext** — the `SecretsVault` encrypts every
   secret with AES-256-GCM; the master key is the only security boundary.
4. **Master key never persisted alongside ciphertext** — the key is in env /
   secrets manager, not in the DB.
5. **JWT rotation has a 24h overlap window** — old tokens continue to verify
   for 24h after rotation, then are dropped.
6. **HSM keys never leave the HSM** (when `RemoteHSM` is configured) — only
   signatures leave.
7. **Rate limits are enforced before the handler runs** — denied requests
   never reach business logic.

## 11. References

- `src/protocol/security/secrets.ts` — AES-256-GCM vault
- `src/protocol/security/jwt.ts` — HS256 JWT + rotation
- `src/protocol/security/rbac.ts` — RBAC roles + permissions
- `src/protocol/security/scopes.ts` — API scope hierarchy
- `src/protocol/security/mfa.ts` — TOTP MFA + backup codes
- `src/protocol/security/hsm.ts` — Software + Remote HSM providers
- `src/protocol/security/audit.ts` — audit log ring buffer
- `src/protocol/security/rate-limit.ts` — 3 rate-limit strategies
- `src/protocol/security/device-trust.ts` — device trust service
- `src/protocol/security/auth.ts` — auth facade (API key + JWT)
- `src/protocol/security/middleware.ts` — `withAuth`, `withApiKey`, `withMfaRequired`
