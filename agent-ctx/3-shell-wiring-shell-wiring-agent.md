# Task 3-shell-wiring — shell-wiring-agent

## Work record

Read prior agents' work (1-audit, 1-code-audit, 2-prisma-fix) from `/home/z/my-project/worklog.md`.
Key inputs absorbed:
- Bug 1: admin + merchant layouts use legacy `AppShell` instead of `UnifiedShell` (via `RoleShell` wrapper).
- Bug 2: `env-switcher.tsx` writes cookie + reloads but never POSTs to `/api/runtime/host`, so the in-memory `runtimeHost.activeEnvironment` is stale.
- Bug 3: `src/lib/environment.ts:13` defaults to `'live'` but env-switcher defaults to `'sandbox'` — mismatch.
- Bug 4: verify via Agent Browser that the role switcher + env switcher render and work for merchant + admin.
- Correct demo emails (task brief had wrong domain `@payswap.com`): `merchant@payswap.demo` and `ekontetevi@gmail.com` (SUPER_ADMIN), both password `Payswap123456`.

## Pattern observed

All 7 already-converted role layouts (`(lp)`, `(treasury)`, `(compliance)`, `(support)`, `(ops)`, `(customer)`, `(developer)`) use `RoleShell` from `@/components/role-shell` — a thin pass-through wrapper around `UnifiedShell`. Nav groups come from `@/lib/nav-config.tsx` (a `.tsx` file, not `.ts`). Both `merchantNav` and `adminNav` already exist there with the full nav item set.

## Files modified

1. `src/app/(admin)/layout.tsx` — replaced `AppShell` with `RoleShell`; passes `adminNav`, `basePath="/admin"`, `currentRole` derived from session (`SUPER_ADMIN` preferred over `ADMIN`), `settingsHref="/admin"`. Keeps `requireAdmin()` guard.
2. `src/app/(merchant)/layout.tsx` — replaced `AppShell` with `RoleShell`; passes `merchantNav`, `basePath="/dashboard"`, `currentRole="MERCHANT"`, `settingsHref="/dashboard/settings"`. Keeps `requireMerchant()` guard + CLOSED/SUSPENDED redirect.
3. `src/components/env-switcher.tsx` — `toggle()` is now `async`; calls `POST /api/runtime/host { environment: next }` first, only writes cookie/localStorage + reloads on success; on failure shows error toast and re-dispatches the change event so the badge reverts (store was never written). Added `switching` state to disable the button during the round-trip.
4. `src/lib/environment.ts` — default flipped from `'live'` to `'sandbox'` (cookie absent or unknown → sandbox). JSDoc updated to explain the alignment with env-switcher + RuntimeHost.

## Pre-existing tsc syntax errors fixed (collateral)

The prisma-fix agent's `mode: 'insensitive'` removals left 6 files with unbalanced braces (TS1005/TS1136). Fixed all 6 so `bunx tsc --noEmit` is clean for the files in scope:
- `src/app/(compliance)/compliance/page.tsx:64`
- `src/app/(compliance)/compliance/sanctions/page.tsx:35`
- `src/app/(ops)/ops/incidents/[id]/page.tsx:108`
- `src/app/(treasury)/treasury/page.tsx:197-202` (6 lines)
- `src/app/api/ai/compliance/route.ts:99`
- `src/app/api/incidents/[id]/route.ts:57`

## Verification (Agent Browser)

### Merchant (`merchant@payswap.demo`)
- Login → session `{ roles: ["MERCHANT"] }`, redirected to `/dashboard` ✅
- Sidebar shows role switcher ("Switch role") + env switcher ("Environment: Sandbox") ✅
- Header shows command palette trigger ("Open command palette") + Notifications ✅
- Full merchant nav renders (22 items across 5 groups) ✅ — superset of old AppShell nav
- Role switcher dropdown opens → shows "Merchant" (only role) ✅
- Env toggle Sandbox → Live: POST /api/runtime/host 200, cookie=`live`, localStorage=`live`, badge="Live", `runtimeHost.activeEnvironment`=`live` ✅
- Env toggle Live → Sandbox: cookie=`sandbox`, badge="Sandbox", `runtimeHost.activeEnvironment`=`sandbox` ✅
- Screenshots: `/tmp/merchant-dashboard.png`, `/tmp/merchant-role-dropdown.png`, `/tmp/merchant-env-live.png`

### Admin (`ekontetevi@gmail.com`)
- Login → session `{ roles: ["SUPER_ADMIN"] }`, redirected to `/admin` ✅
- Sidebar shows role switcher + env switcher ✅
- Header shows command palette trigger + Notifications ✅
- Full admin nav renders (10 items across 2 groups) ✅ — superset of old AppShell nav
- Role switcher dropdown opens → shows "Super Admin" (only role, highlighted active) ✅
- Env toggle Sandbox → Live: POST 200, cookie=`live`, badge="Live", `runtimeHost.activeEnvironment`=`live` ✅
- Env toggle Live → Sandbox: cookie=`sandbox`, badge="Sandbox", `runtimeHost.activeEnvironment`=`sandbox` ✅
- Screenshots: `/tmp/admin-dashboard.png`, `/tmp/admin-role-dropdown.png`, `/tmp/admin-env-live.png`

## Lint / tsc

- `bun run lint`: 0 errors, 218 pre-existing warnings (all `payswap-read-models/*` architectural warnings about direct Prisma writes — none in the 4 files I edited).
- `bunx tsc --noEmit`: 0 errors in the 4 in-scope files (after fixing the 6 collateral syntax errors). 494 pre-existing errors remain elsewhere (mostly `environment` field not on Payment/Customer/etc. models — out of scope for this task).
