# Milestone 1 — Gap Review: Identity, Accounts & Organizations

## 1. What gap with Stripe was closed?

**Organization model**: PaySwap now has a proper Organization → Member → Role hierarchy, matching Stripe's workspace model. Users can belong to multiple organizations with different roles, and switch between them instantly via the workspace dropdown in the sidebar.

**Workspace switching**: The OrgSwitcher component appears in the sidebar header, showing the active organization with its type badge. Clicking it reveals all organizations the user belongs to, with instant switching (cookie + localStorage + page refresh).

## 2. What gap remains?

- **Email verification**: Not implemented (users are auto-verified in seed)
- **Password reset**: Not implemented
- **Magic links**: Not implemented
- **OAuth (Google, GitHub, etc.)**: Not implemented (credentials-only)
- **MFA/Passkeys/WebAuthn**: Not implemented
- **Device management UI**: Model exists but no UI to view/revoke devices
- **Session management UI**: Model exists but no UI to view active sessions
- **Impersonation mode**: Not implemented
- **GDPR delete**: Not implemented
- **Organization settings page**: No UI to edit org settings
- **Department/business unit**: Model not yet implemented
- **Waitlist enhancement**: Still basic approve/reject (no "request info", "assign plan")

## 3. What unique PaySwap capability was added that Stripe does not have?

**Organization types**: PaySwap organizations have a `type` field (merchant, lp, platform, developer) — Stripe only has one org type. This reflects PaySwap's multi-actor financial network model where LPs and the platform itself are first-class organizations, not just merchants.

## 4. Does the implementation preserve the frozen kernel?

**Yes.** Zero files modified in `src/kernel/`. All new code is in `src/lib/`, `src/components/`, `prisma/`, and `scripts/`.

## 5. Does the Sandbox and Live environment behave correctly?

**Yes.** Organizations are environment-agnostic (an org spans both sandbox and live). The environment toggle still works independently of org switching.

## 6. Can every new capability be exercised through the simulator?

The world simulator doesn't yet create organizations (it uses existing seeded ones). Organization creation would be a future enhancement to the simulator.

## 7. What architectural debt was introduced?

- The `UserRole` model and `OrganizationMember` model overlap (both assign roles to users). Eventually, `UserRole` should be deprecated in favor of `OrganizationMember`.
- The OrgSwitcher stores the active org in both localStorage and a cookie, which could drift if the user clears one but not the other.

## 8. What should be refactored before the next milestone?

- Migrate role checking from `UserRole` to `OrganizationMember` (the org membership should be the source of truth for roles)
- Unify the role switcher and org switcher into a single "workspace" concept
- Add server-side org context to all API routes (currently only the shell uses it)

## 9. Production readiness score (0–100)

**35/100** — The foundation is in place but most identity features (OAuth, MFA, password reset, device management, session revocation) are still missing.

## 10. Estimated parity with Stripe (0–100)

**15%** for identity specifically. Stripe has SSO, SAML, MFA, passkeys, device management, session management, audit trails, impersonation, and org-level permissions. PaySwap has the data model and workspace switching.
