# Google + GitHub social login setup

Prepared 2 November 2026. Application code is ready for provider configuration; real Google/GitHub login has not been verified. Both hosted providers were OFF in the read-only settings check. Email/password was ON. No hosted settings were changed, as the user requested code completion and setup steps first.

## Supabase project

The linked project is MegaMockAuction, reference zkrxuowctprncwnymnvg. Confirm this is the intended launch project before configuring credentials.

Both providers must use this provider callback URI:

https://zkrxuowctprncwnymnvg.supabase.co/auth/v1/callback

This is Supabase's callback, not the application's /auth/callback route. Supabase completes the provider flow, then redirects to the application's /auth/callback where the existing SSR client exchanges the PKCE code and writes session cookies. Successful login and first signup both pass through /auth/complete, which validates the profile before /dashboard.

## Google Cloud Console

1. Create/select a Google Cloud project and configure Google Auth Platform / OAuth consent branding, audience and contact information.
2. Select External if friends outside your organization must sign in. While the app is in Testing, add the intended Google accounts as test users. Before public sharing, use the appropriate publishing status and complete any requirements Google displays.
3. Create an OAuth client of type Web application. Add the exact Supabase callback URI above under Authorized redirect URIs. Use only basic identity/profile/email scopes; this app does not need Drive, Gmail or other resource permissions.
4. If Google asks for application origins, use your actual application origin (http://localhost:3000 for local browser testing, then the stable HTTPS launch origin). Do not confuse origins with redirect URIs.
5. In Supabase Dashboard > Authentication > Sign In / Providers > Google, enter the Google client ID and client secret privately and enable Google. Keep normal nonce/security checks enabled.

Official guide: https://supabase.com/docs/guides/auth/social-sign-in/auth-google

## GitHub developer settings

1. GitHub > Settings > Developer settings > OAuth Apps > New OAuth App.
2. Set the application name and Homepage URL to the actual application origin. For initial local browser testing this can be http://localhost:3000; update it for launch.
3. Set Authorization callback URL to the exact Supabase callback URI above.
4. Generate a client secret. Copy the client ID and secret directly into Supabase Dashboard > Authentication > Sign In / Providers > GitHub and enable GitHub. Do not paste secrets into chat or commit them.
5. Use a separate OAuth App if a different Supabase project requires a different GitHub callback. This application requests no repository access.

Official guide: https://supabase.com/docs/guides/auth/social-sign-in/auth-github

## App redirects, allowed methods and environment

- Supabase Authentication > URL Configuration: set Site URL to the actual application origin. Allow the exact application callback, e.g. http://localhost:3000/auth/callback and, after deployment, https://YOUR-STABLE-APP.vercel.app/auth/callback. Avoid wildcard production redirects.
- New users require Allow new users to sign up to remain enabled.
- Once both OAuth providers have been tested, disable the Email provider, phone/anonymous sign-in and any other unused providers in the intended project. Removing password controls from this app alone does not disable Supabase's password API. Existing valid sessions are not automatically revoked merely because the UI changes; review active sessions separately if enforcing an immediate social-only cutover.
- Do not turn off the old authentication method in a shared project before confirming access through the new providers.
- App auth needs the existing NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY for this same project. Keep NEXT_PUBLIC_APP_URL accurate. Existing server-only service-role/tick settings remain unchanged; this task introduces no new app environment variables.
- Google/GitHub client secrets belong in the Supabase Dashboard, never NEXT_PUBLIC variables or browser code. The app does not need either provider's client secret.
- The existing .env.local points at a separate local Supabase stack. Configuring hosted providers does not configure that local stack. Select the intended URL/key pair explicitly for a controlled OAuth test; do not point a local auction worker at production.
- Verify the existing native profile migration 20261102100000_native_auth_profiles.sql is applied to the intended hosted project before onboarding new OAuth users. No schema change is introduced by this social-login task.

## Identity continuity and email linking

The application never looks up/merges profiles by email, creates a second profile in the callback, or rewrites room ownership. It keeps the UUID returned by Supabase. The existing signup trigger creates one unprivileged profile per Auth UUID; missing profiles fail closed at /api/auth/me.

Supabase itself automatically links OAuth identities with the same email under its managed identity-linking rules. Disabling manual linking does not disable that behavior. There is no app-level email merge here, but this implementation cannot promise that two provider identities with matching email will always become separate Supabase users. If the requirement forbids even Supabase-managed automatic linking, that remains an unresolved policy/platform requirement and must be addressed before enabling public signup. Do not claim the frontend prevents it.

Legacy Clerk shadow users may already occupy the same email. Verify their native UUID and provider identity before any recovery; never manually reassign profiles or rooms based only on an email match.

Official linking guide: https://supabase.com/docs/guides/auth/auth-identity-linking

## Acceptance test after credentials are configured

For each provider, test a new account and a returning account, then cancel provider consent. Confirm /auth/complete reaches the correct native profile and dashboard; repeat login to check that no duplicate profile is created. Refresh, open a protected room, verify old room ownership, log out and confirm signed-out page/API denial. Test both different-email and matching-email provider scenarios against the intended identity policy. Test expired/replayed callback codes and provider errors.

Local unit/browser tests using mocked OAuth transport do not replace this provider acceptance test.

## Clerk restoration reference

Local backup branch: codex/backup-clerk-29cfc83
Commit: 29cfc83b0b4e4fc9d0b14df4e714ae5def54ab22

This reference preserves the full Clerk-era tree: authentication components, ClerkProvider, middleware, callbacks, token bridge, dependencies and database integration. The active branch stays on Supabase only. No Clerk package is reinstalled.

For a future migration, create a separate implementation branch from the then-current application and compare the backup tree. Restore the coordinated Clerk provider/client/server/API/hook/callback/configuration bundle selectively, with dependencies and tests. Retain later auction and deployment work. Verify the owned domain, Clerk instance keys, Supabase JWT/template trust and preserved subject-to-profile mapping. Do not blindly revert the Supabase migration or merge/reassign accounts by email. No restoration command has been run.
