# Fresh Supabase project compatibility

This patch is prepared for review. Hosted execution, OAuth configuration,
Vault/scheduler setup and Vercel changes require separate approval.

The audited empty test project is `lxlalipmvdprxzdmbfzz`.
The repository's saved Supabase link points elsewhere: never use a default
linked-project migration command for this setup.

## Migration order

1. Preserve the original 75 migration files and their version order.
2. Apply through `20261011090000_fix_mini_confirm_clerk_identity.sql`.
3. Immediately before `20261017100000_room_scoped_profile_access.sql`, run the
   reviewed operation `supabase/operations/fresh-project-profile-acl.sql` as
   `postgres`. It supplies the single direct grant that the historical
   security preflight expects on fresh projects. It refuses post-hardening
   schemas. Do not relax or skip that preflight.
4. Continue all remaining historical migrations through
   `20261102100000_native_auth_profiles.sql`. The later security migration
   revokes the temporary `service_role` resolver grant again.
5. Apply `20261104100000_explicit_runtime_reads_and_mini_realtime.sql`.
   This forward migration removes API maintenance privileges from the explicit
   application table list and future postgres-created public tables. It gives
   authenticated clients and the worker SELECT-only access to the six mini/trade
   tables; their mutations remain SECURITY DEFINER RPCs. It preserves profile
   column restrictions, all RLS expressions, RPC bodies and RPC grants.
   The two mini-selection tables are added to the existing Realtime publication
   with full replica identity.

Use migration-aware execution that records each successful canonical version.
The compatibility operation is a separate prerequisite, not a substitute for
recording migrations. A single blind push of every pending migration does not
insert this operation at the required boundary. Review the exact target and
ordered plan before any hosted execution. Do not run the operation after the
final hardening migrations.

## Local verification

`scripts/check-fresh-project-database.mjs` accepts only a running Docker
container labelled `mega-auction.purpose=fresh-project-validation-*`, with
network mode `none`, no published ports, no user volumes, and PostgreSQL data
on tmpfs. It accepts no database URL and has no hosted API client.

Run it against a newly created disposable PostgreSQL 17 container:

```sh
container=$(docker run --detach --network none \
  --label mega-auction.purpose=fresh-project-validation-local \
  --tmpfs /var/lib/postgresql/data:rw,size=768m \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=mega_auction_test \
  postgres:17-alpine postgres -p 55325 -c wal_level=logical)
# Wait for this new container's mega_auction_test database to accept SELECT 1.
node scripts/check-fresh-project-database.mjs --container "$container"
```

The helper deliberately refuses existing application tables/databases rather
than resetting them. A second run requires a new disposable container. It:

- compares all 75 historical files with HEAD, normalizing checkout CRLF only;
- reproduces the unpatched ACL failure under the audited modern defaults;
- replays all 75 plus the forward migration under modern and legacy CI defaults;
- checks real member/outsider RLS reads, worker access, denied direct writes,
  admin-field protection, final resolver grants, maintenance privileges,
  publication membership, idempotency and refusal of a late compatibility grant;
- confirms existing RPC definitions, RPC ACLs and policy expressions are unchanged;
- rolls back all assertion fixtures and checks that the 202-player seed remains.

CI runs this separate rehearsal in addition to its existing database security,
concurrency, native-auth/scheduler, unit/regression and production-build checks.
The plain PostgreSQL CI bootstrap now creates the publication that hosted
Supabase already provides. Neither CI bootstrap nor its auth mocks belongs in
a hosted migration plan.

This is database-level verification. It does not prove OAuth login, hosted
Realtime delivery or multiplayer browser acceptance. Those tests follow only
after approved isolated test-project and Preview configuration. Bots remain
disabled. No production project migration is proposed here.
