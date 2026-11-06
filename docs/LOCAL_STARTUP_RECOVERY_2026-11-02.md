# Local startup recovery — 2 November 2026

The local app and its auction worker now run against the existing disposable
Supabase project. This is a local startup result, not production or migration
validation.

## Findings

- Checkout: `audit/production-worker-security-hardening`, starting HEAD
  `97fd4e61579c02c1edff13a1e398f296595560ce`.
- The pasted handoff described an older checkout and API port `54321`. The current
  `.env.local` instead targets `127.0.0.1:55321`; its credentials were not changed.
- Docker Desktop was stopped. Its CLI launcher failed because it could not find
  its registry entry. Launching the installed Docker Desktop executable succeeded.
- Docker automatically resumed the existing project
  `mega-auction-v4-phase2c-pg17-20261017`. Its five published services used wildcard
  IPv4/IPv6 bindings, despite belonging to a network with “loopback” in its name.
- Live metadata confirmed the disposable database mounted
  `supabase_db_mega-auction-v4-phase2c-pg17-20261017` at
  `/var/lib/postgresql/data`. The separate original-project volume
  `supabase_db_zkrxuowctprncwnymnvg` was not mounted by this stack or accessed by
  the repair.

## Environment repair

1. Stopped the disposable application's services, then shut down its database
   cleanly (exit code zero).
2. Archived the database volume through a read-only, network-disabled helper.
   Verified that the archive could be listed and contained `PG_VERSION` and
   `global/pg_control`; calculated its SHA-256. A restore rehearsal was not run.
3. Snapshotted the writable layers of the five containers with published ports,
   retaining their existing runtime configuration. These snapshots are local to
   Docker; they must not be published because runtime configuration can contain
   credentials.
4. Recreated those containers with the same configuration, mounts, and network
   aliases, changing published host addresses to `127.0.0.1`. Retained the old
   containers stopped and disconnected, with automatic restart disabled.
5. Restarted the disposable stack and verified the replacement containers' mount
   identities, healthy status, and actual published bindings.

| Service | Verified host binding |
| --- | --- |
| API/Kong | `127.0.0.1:55321` |
| PostgreSQL 17 | `127.0.0.1:55325` |
| Studio | `127.0.0.1:55323` |
| Mailpit | `127.0.0.1:55324` |
| Analytics | `127.0.0.1:55327` |

Connections to all five ports through each of the host's two non-loopback IPv4
addresses failed (10 checks). Docker metadata showed no wildcard or IPv6
publication for these services. This is host-side evidence; no second machine
was used for remote testing.

No original-project service, global Docker setting, migration, schema, seed, or
application credential was changed. Starting the normal auction worker permits
its ordinary application processing; this was not a database-read-only session.

## Application changes

- `npm run dev` now performs a bounded, read-only local Supabase Auth health
  request before launching Next.js. A missing local API produces an actionable
  startup failure. It sends only the public API key, hides raw network errors,
  does not follow redirects, and does not probe hosted projects.
- The existing GET-only tick-route readiness check and serialized worker remain
  in place.
- README instructions now explain that `npm run dev` already starts one worker;
  a second `npm run worker` must not be started alongside it.
- Replaced the auth completion page's plain sign-in anchor with Next.js `Link`
  to fix the lint error discovered during verification.

## Verification

- 28 focused startup/worker/client/preflight tests passed, plus 2 auth completion
  tests (30 total).
- TypeScript check passed after the final code change.
- Lint passed with six existing warnings about hook dependencies and images.
- Tracked-file whitespace check passed.
- Live `npm run dev` passed the local dependency check, received GET tick-route
  readiness HTTP 405, then started one authenticated worker.
- Repeated live worker ticks returned HTTP 200. The final sampled batch contained
  62 successful ticks and no tick-route or worker errors; this does not establish
  an uninterrupted error-free history during initial compilation.
- `/login` and `/sign-in` responded with HTTP 200. An authenticated Clerk browser
  sign-in/profile completion was not performed.
- A separate negative check against an unavailable local endpoint exited with
  code 1 and the intended startup guidance, without exposing a raw error/key.
- No database-mutating integration suite or Playwright suite was run.

The optional Vector log collector already had a restart loop and still does.
The database, API, Auth, Storage, Realtime, Studio, and Analytics services were
healthy; app/worker availability does not depend on claiming Vector is fixed.

## Local recovery artifacts

Retained in the Git-ignored directory:

`scratch/local-startup-recovery-20261102T094459/`

- `disposable-pg17-cold-backup.tar`: 114,100,224 bytes, 3,624 archive-list entries.
- SHA-256:
  `a2f3f4cab412aa939b151025ca2c515de9fe5ec3e9ee6e0fc02c3be5e7a4f5b4`.
- `recovery-manifest.json`: original/replacement container IDs, source images,
  retained snapshot image IDs, network aliases, restart policy, and backup
  metadata. It contains no environment values.
- The local one-time repair implementation is
  `scratch/repair-local-loopback.cjs`; it validates the expected target before
  applying changes. It is not a general Supabase provisioning command.

The retained database rollback container and its replacement reference the same
database volume. Never run them concurrently. Any recovery should stop the
replacement first and preserve localhost-only publication; starting the old
containers directly would restore their original wildcard port bindings.

For subsequent development, start Docker Desktop, allow the retained stack to
become healthy, and run `npm run dev`. A future Supabase CLI recreation should
be checked again for actual localhost-only bindings.
