# Social-only authentication implementation audit

Date: 2 November 2026. Starting commit: 1eb552bd9a8c1e657e7087d39e5b36514dfa4d14. Active branch: audit/production-worker-security-hardening.

## 1. Repository audit before changes

Inspected root layout; AuthProvider; AuthForm; canonical sign-in/sign-up and compatibility login/signup pages; forgot/reset pages; PKCE callback and redirect helper; middleware; Supabase browser/server/middleware clients; server-session and server-profile helpers; profile API; server admin authorization; auth service helpers/types/validation; Clerk-era AuthForm and integration at 29cfc83; identity resolver 00054; room/profile RLS migration 20261017100000; native profile migration 20261102100000; relevant session/profile/hooks tests, E2E fixture helpers and disposable-target guards.

Dependencies: one native cookie session powers browser REST/Realtime and SSR; server authorization verifies getUser; database authorization uses the existing native UUID-compatible resolver and RLS; profile creation is the existing Auth trigger, not callback-side provisioning. No provider change or new JWT bridge is necessary.

## 2. Architecture before and after

Before: native Supabase Auth, email/password UI, signup fields and password recovery routes.
After: the same native Supabase session/context/client/server/RLS/UUID infrastructure, with only Google and GitHub signInWithOAuth controls. Both providers use the existing /auth/callback PKCE exchange. New and returning users both pass through /auth/complete and the existing own-profile API, then dashboard. No manual profile inserts, email searches or ownership reassignment were added.

The original Clerk-era card heading, spacing, shadows, typography and provider SVG icons were restored as closely as possible. The canonical sign-in page, auction gavel/preview/counters/feature strip, global CSS and responsive grid were not modified. The richer /signup compatibility page still uses its original shell with the same two-provider card. Canonical /sign-up now redirects to the unified sign-in page. Password recovery routes redirect to sign-in; password login/signup/recovery functions were removed from active service helpers. Shared logout/profile helpers remain.

## 3. Modified files (11)

- README.md: updates the active authentication description and links the new setup guide.
- src/components/auth/auth-form.tsx: Google/GitHub only, original card styling, controlled pending/error/back-navigation state.
- src/app/(auth)/signup/page.tsx: removes password-mode prop, preserves shell.
- src/app/sign-up/[[...sign-up]]/page.tsx: unified social sign-in redirect.
- src/app/(auth)/forgot-password/page.tsx: retired password-flow redirect.
- src/app/(auth)/reset-password/page.tsx: retired password-flow redirect.
- src/app/auth/callback/route.ts: safe cancellation/error handling, code exchange, no-store redirects.
- src/lib/auth/redirect.ts: all callbacks resolve only to profile validation; recovery destinations retired.
- src/lib/auth.ts: removes password/email authentication helpers; keeps shared logout/profile functionality.
- src/test/unit/native-auth-redirect.test.ts: updated social-only callback expectations.
- src/test/e2e/ma-mini-lifecycle.spec.ts: only authentication fixture helper changed. It uses an existing guarded disposable native session through SSR cookies instead of the removed password UI, and still verifies /api/auth/me UUID. Auction test bodies are unchanged. This fixture is not an OAuth-provider E2E test.

## 4. Added files (7); removed files: none

- src/lib/auth/oauth-errors.ts
- src/test/unit/social-auth-form.test.tsx
- src/test/unit/social-auth-callback.test.ts
- src/test/unit/social-session.test.tsx
- src/test/unit/social-route-protection.test.ts
- docs/SOCIAL_AUTH_SETUP.md
- docs/SOCIAL_AUTH_IMPLEMENTATION_AUDIT_2026-11-02.md

Legacy password validation schemas/types remain for existing test fixtures; they expose no active application login/signup/reset flow.

## 5. Clerk preservation

Created local backup branch codex/backup-clerk-29cfc83 BEFORE editing application files.
Exact commit: 29cfc83b0b4e4fc9d0b14df4e714ae5def54ab22.
The complete Clerk-era tree, dependencies, root provider, middleware, callbacks, token bridge and application integration remain recoverable from this reference. No branch switch, blind revert, Clerk installation or simultaneous provider activation occurred. Restoration instructions are in SOCIAL_AUTH_SETUP.md. The reference is local; the baseline commit is also the existing pushed audit-branch commit.

## 6. External Google setup required

Create/configure a Google Web OAuth client and consent audience. Put its client ID/secret into the intended Supabase project's Google provider configuration. Add test users while Google consent is in Testing; satisfy publishing requirements before public use. Authorized provider redirect URI for the currently linked project:
https://zkrxuowctprncwnymnvg.supabase.co/auth/v1/callback

## 7. External GitHub setup required

Create a GitHub OAuth App, use the actual app origin for Homepage URL and the same Supabase provider callback above for Authorization callback URL. Enter client ID/secret privately in Supabase's GitHub provider settings. No repository permissions are requested by application code.

## 8. Environment and dashboard configuration

No new app environment variables. Auth continues to require existing NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY, with the correct NEXT_PUBLIC_APP_URL for the intended environment. Existing server-only values are unchanged. Provider secrets belong only in Supabase Dashboard, never browser/NEXT_PUBLIC code. Configure exact application /auth/callback redirect URLs separately from the provider callback URI.

Read-only hosted check: Google OFF, GitHub OFF, Email ON, signup allowed. No settings were changed because the user explicitly requested code completion and exact setup instructions first. To enforce social-only methods at the backend, disable Email and other providers in Dashboard AFTER both OAuth methods are configured and tested. UI removal does not disable Supabase password APIs or invalidate existing sessions.

## 9. Security and platform caveat

Server authorization, session refresh, native UUID mapping, profile uniqueness and existing RLS are preserved. Callback destinations are fixed to /auth/complete. Missing/invalid/expired codes, provider denial and network failures produce fixed messages; provider error descriptions and credentials are not reflected. Shared cookie handling remains in the SSR client. No account merge or profile creation is performed by the callback.

Supabase itself automatically links OAuth identities by email under its managed identity-linking policy. App code cannot truthfully promise never to link matching-email provider accounts. No custom email-based merge was added. If the requirement literally forbids even Supabase-managed linking, that policy/platform issue remains unresolved before public signup. Existing Clerk shadow users need verified continuity checks; do not manually remap their profiles by email.

## 10. Tests and actual results

- TypeScript: PASS.
- ESLint: PASS, with six pre-existing warnings in unrelated auction components/hooks.
- Relevant auth/profile/admin/squad/realtime/schema Vitest selection: 87 passed, zero failed.
- Final focused social/callback/session/middleware/redirect selection: 39 passed, zero failed (overlaps the 87; do not add totals).
- Existing unchanged canonical migrations replayed in a new PostgreSQL 17 container with no network or published ports. Native UUID/profile/room/bid/settlement/mini rehearsal passed, with transaction rollback and mocked HTTP/Vault transport.
- Additional Google/GitHub-shaped metadata profile assertions: PASS for native UUID/profile identity, full name/avatar fallback, unprivileged profile creation, malicious admin metadata ignored and repeated ID not duplicating profiles. These simulate Auth inserts, not provider authentication. The initial assertion was started before migration replay finished; it was rerun after completion and passed without source/schema changes.
- Chromium production smoke: PASS at widths 375/768/1440. Exactly two provider controls; no password inputs/forms/recovery controls; original desktop two-column shell; no overflow or runtime exceptions. Both real SDK calls generated S256 PKCE provider authorization URLs. Mocked provider cancellations returned safe card feedback. Retired routes navigated to sign-in; protected dashboard/room access redirected and unauthorized profile API returned 401. OAuth transport was mocked; no real provider credentials were used.
- Existing ma-mini-lifecycle Playwright run attempted: BLOCKED before test execution by E2E_ALLOW_DATABASE_MUTATIONS being unset. Explicit SUPABASE_TEST_* credentials/disposable preflight are also required. The guard was not weakened and no existing user database was used for that suite. This is not a passing E2E run.

## 11. Production build

PASS in a fresh source-only validation directory with nonworking hosted placeholder credentials and the same installed dependencies. Diagnostic endpoint absence check passed. This verifies compilation, not actual hosted OAuth credentials or callbacks. No deployment/scheduler configuration was changed.

## 12. Remaining acceptance work

Real Google login/signup and GitHub login/signup, actual consent cancellation, hosted cookie persistence/logout and existing-user room continuity still require external app credentials and configured redirects. Follow SOCIAL_AUTH_SETUP.md. Strict managed identity-linking policy needs review as noted above. Provider enablement, backend email disablement and any public deployment remain undone. No claim of live provider E2E success is made.

No auction/bid/timer/player/team/rules/worker/bot source, Supabase schema/RLS, session provider/client/server infrastructure, protected API implementation, deployment configuration or scheduler configuration was changed by this task. Code changes remain uncommitted/unpushed; only the requested Clerk backup reference was created.
