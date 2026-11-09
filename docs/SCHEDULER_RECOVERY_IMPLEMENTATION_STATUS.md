# Scheduler recovery implementation status

## Latest local verification ? 6 November 2026

**PRODUCTION ON HOLD. No commit, push, hosted SQL, deployment or scheduler activation approved.**

- Fresh isolated PostgreSQL database: 77 canonical migrations installed and full
  `validate-scheduler-database.mjs` sequence PASS.
- Validated fixture: `mega_auction_ledger_retry_1793930343432`.
- Mini-workflow regression PASS, including DATABASE-mode authenticated-host
  direct-start rejection, persisted approval, duplicate prevention and resume.
- Full local Windows unit regression: 94 test files passed, 1,053 tests passed,
  21 skipped.
- TypeScript, canonical migration consistency and Git whitespace checks PASS.
- CI YAML and the two updated CI cleanup-step Bash syntax checks PASS.
- Provisional release inventory: 19 modified tracked files plus 30 new
  candidates, 49 total. Another 865 untracked files remain preserved and
  excluded; zero files staged. Runbook documents require separate inclusion review.
- The latest final-source production build, exact-commit GitHub CI, fresh hosted
  preflight, independent alert delivery and production acceptance remain pending.
- The November 5 Linux, pg_cron, restart and compatibility evidence below remains
  historical local validation, not hosted proof or a new November 6 CI run.

## Previous verified checkpoint ? 5 November 2026

**Available local validation PASS with the caveats below. NOT PRODUCTION-READY.
No commit, push, hosted SQL, configuration or deployment. Fresh dependency
installation/exact-commit GitHub CI and hosted acceptance remain separate gates.**

### Resumed validation after Docker recovery

This subsection supersedes the earlier blocked-test entries below.

- `scratch/scheduler-resumed-native-20261105.log`: PASS; 77 canonical migrations
  in new memory-limited/network-isolated `ma-native-final-20261105-a`, fixture
  `mega_auction_ledger_retry_1793898891250`. All ten timer signatures fenced;
  partial business-write rollback, host/native mini race, durable intent/resume,
  lost HTTP response/new process, live-transaction lease reconciliation,
  known/unknown NO_REPLAY disposition and guarded reset passed.
- `scratch/scheduler-resumed-cron-retry-20261105.log`: PASS; actual local
  pg_cron postgres principal AND transaction-controlling idle native CALL,
  PostgreSQL17 transaction timeout. Clone
  `44fabc97b62194d144cdf6dbe45da3ad3577de6e8bb3e854abb203383445e04d`.
  Native job/probes inactive and dispatcher disabled afterward. The preceding
  attempt rejected an idle MINI_AUCTION/SETUP fixture; corrected guard explicitly
  permits only terminal/setup states and rejects any pending actions/claims or
  active mini sessions. Failed clone retained; no business rule changed.
- `scratch/scheduler-resumed-crash-20261105.log`: PASS; real immediate
  PostgreSQL crash/restart in that synthetic clone, durable state preserved,
  uncommitted purse write rolled back, jobs remain inactive.
- `scratch/scheduler-resumed-linux-20261105.log`: PASS; Debian12, Node24.22.0,
  standalone TypeScript, complete Next production build and diagnostic-route
  exclusion. Container
  `513996f40022f27ce0010358540756ce516334ad78df603231762a3a4276cdbd`.
  Dependencies reused from a matching-lockfile image; npm ci NOT rerun. Bounded
  memory/CPU and `CIRCLE_NODE_TOTAL=2` reduce Next concurrency to one worker;
  application source/feature flags unchanged. Fresh npm ci remains a CI gate.
- `scratch/scheduler-resumed-strict-db-20261105.log`: PASS; fresh 77-migration
  `mega_auction_test` in the same isolated PostgreSQL cluster, real Linux
  concurrency8 + security4 =12 passed, zero skipped, JSON completeness gate
  passed. Rollback-only native auth/legacy HTTP scheduler assertions also PASS.
  HTTP/Vault in that legacy compatibility suite are mocked, not hosted proof.
- `scratch/scheduler-resumed-linux-vitest-2cpu-20261105.log`: PASS; standard
  thread-based full Linux suite,104 files/1216 tests passed,4 files/74 tests
  skipped. Strict12 database tests have a separate zero-skip gate above. Other
  conditional skips include isolated Supabase runtime RLS/identity checks and
  deferred bot paths; no new skips or flag changes. First full run limited two
  workers to one CPU and failed one unchanged150ms benchmark at153.7ms; retained
  in `scheduler-resumed-linux-vitest-20261105.log`. Isolated unchanged benchmark
  passed (worst43.61ms), then the entire unchanged suite passed with two CPUs for
  two workers. This is resource-sensitive test timing, not proof of a production
  bot improvement; bots remain disabled. No thresholds or assertions weakened.
- `scratch/scheduler-resumed-fresh-20261105.log` / `.json`: PASS; separate
  network-isolated `ma-fresh-final-20261105-b`, modern and legacy grants,
  75 historical +2 forward migrations each,311 security assertions per mode,
  native scheduler installed disabled,202 catalog players and no fixture users.
  No historical migration changed; runtime grant forward migration idempotence
  and late compatibility-bridge rejection passed. No hosted connection.
- Final preservation check:42/42 original untracked entries present, nothing
  staged, baseline HEAD unchanged, backup SHA256 unchanged, bots flag unchanged.
  Source generation, script syntax and Git whitespace checks PASS. Six existing
  lint warnings remain. No exact-commit GitHub CI, hosted installation, monitoring
  provisioning or hosted acceptance is claimed.

Docker recovery update: normal Desktop restart timed out. With separate explicit
approval for Docker-only forced recovery and temporary tmpfs loss,
`wsl --terminate docker-desktop` succeeded; remaining Docker processes exited and
Desktop was relaunched from its verified executable. Two engine checks succeeded
(29.8.2/Linux, 43 container records). Local Supabase DB container reports healthy.
Vector logging container reports restarting; full local Supabase-stack health is
not established or repaired by this task. No reset, cleanup, volume deletion or
hosted connection was performed. Backup SHA256 and 42/42 untracked entries
reverified unchanged, no staged files. Free host RAM remains low (0.88GB);
do not run large parallel validation stacks. Recreate fresh labelled disposable
fixtures rather than assuming prior tmpfs snapshots survived. Historical failure
details below remain evidence; no final build/DB pass is implied by engine recovery.

Baseline branch `audit/production-worker-security-hardening`, HEAD
`1d13743c827f78f6cc0cb552a95e0307f791d2ae` remains unchanged. Nothing staged.
All 42 baseline untracked entries are still present. Existing backup SHA256 is
unchanged: `ABD5EA0F67652C699EA48C3BD072899D972452267476E27FE098BB751F453338`.
`AUCTION_BOTS_ENABLED=false` remains unchanged.

### Six requested workstreams

| Workstream | Local implementation / evidence | Remaining gate |
| --- | --- | --- |
| Mini + resume | Durable host intent, subject+auction generation binding, atomic workflow completion; final canonical rerun, persisted approval/reconnect, duplicate calls, host/native race and resume PASS | Hosted acceptance |
| Lease / unknown outcome | Durable claims, tokens, epochs, shared transaction lock; no lease stealing; final lost-response/new-process and live old transaction reconciliation PASS | Hosted failure drill |
| Operator recovery | Audited NO_REPLAY claim/action disposition; evidence/hash/epoch/expiry and distinct activation; reset and partial-write rollback PASS | Human reconciliation remains required; no automatic arbitrary business repair/replay |
| Single scheduler | All ten service-role timer fences, real local cron postgres principal, transaction-controlling native CALL, transaction timeout and crash/restart PASS | Hosted principal, permissions and stopped privileged old drivers not verified |
| Monitoring | Restricted health summary, durable alert outbox, leased claim/ack, independent monitor with persistent local queue; loopback outage/delivery/ack-loss tests passed | Destination, independent host, monitor heartbeat watchdog and real delivery NOT provisioned/tested |
| Final acceptance | Final native/strict DB matrix, full Linux regressions, fresh modern/legacy compatibility and complete Linux build/diagnostic exclusion PASS; CI workflow extended | Fresh npm ci/exact-commit CI, approved hosted installation, monitoring delivery, OAuth/multiplayer and separate go-live |

### Current implementation map

- Canonical forward candidate: `supabase/migrations/20261105120000_native_scheduler_recovery.sql`.
  Eight operation sources: action ledger, engine, recovery, workflows, claims,
  runtime, alerts, fencing. `scripts/build-scheduler-migration.mjs` checks the
  generated file exactly. Installs DATABASE-owned and disabled, no cron, no
  pg_net/Vault. Component files are not additional hosted migrations.
- Application: durable mini intent UI; host-review policy in legacy orchestrator;
  authenticated tick ownership fence (DATABASE=409, unknown/missing=503);
  structured per-action failures and bounded no-redirect client diagnostics.
- Developer runner: explicit `npm run dev -- --web-only` does not start the
  legacy worker. Its new test passed. Default legacy behavior retained.
- `tsconfig.json`: excludes preserved scratch snapshots; these are generated
  copies rather than application inputs. No source tests/security checks removed.
- `scripts/check-{action-ledger,scheduler-engine,scheduler-recovery,scheduler-workflows,scheduler-claims,scheduler-http-recovery,scheduler-restart}.mjs`:
  real isolated SQL/crash/HTTP/race validation, not hosted probes.
- `scripts/validate-scheduler-{database,cron,linux}.mjs`: guarded fresh DB,
  local actual pg_cron and clean intended-source Linux rehearsals.
- `scripts/scheduler-monitor.mjs`, `scripts/scheduler-alert-delivery.mjs`:
  external-process candidates; no provisioned hosting or credentials.
- CI and existing fresh/release checkers updated. Legacy release assertions
  explicitly switch only their disposable rollback transaction to LEGACY; native
  ownership and denial are separately tested against a fresh migrated database.
- [Native runbook](SCHEDULER_NATIVE_RECOVERY_RUNBOOK.md): exact future approval
  sequence, evidence/recovery calls, ownership fences, monitor setup and rollback.

### Earlier evidence and failures (superseded by resumed results above)

1. Fresh fixture `mega_auction_ledger_retry_1793893889131` in the verified
   network-disabled tmpfs container `ma-action-ledger-20261105172313`: 77 canonical
   migrations and the complete then-current native script sequence passed.
   Includes durable mini+resume, real host/native race, known quarantine NO_REPLAY,
   unknown-claim disposition, financial duplicate invariants, terminated
   pre-commit connection, HTTP response loss, live-transaction lease reconciliation,
   restricted health/outbox and real top-level native CALL. It predates the final
   tenth service-role fence and partial-write fault-injection test.
2. Fresh compatibility container `7c4fd7d4717a445c3697218b548a276a162c158933a39d4442093b2783a8b442`:
   modern and legacy grants both passed, 75 historical + 2 forward migrations,
   311 security assertions per mode, native install disabled, 202 catalog players,
   no fixture users. This also predates the last tenth-fence change.
3. Actual local Supabase PostgreSQL17.6 pg_cron in
   `d63d71e44187ce88d2ec90a5a18d793c23c03fed30d93c16ed8ec09be38f0023`:
   principal probe passed and transaction timeout demonstrably terminated its
   synthetic connection. Native job/dispatcher stayed disabled. This does NOT
   prove a transaction-controlling native CALL inside cron; that additional test
   was added after the engine failed and has not run. A prior snapshot's actual
   database crash/restart test passed; latest crash rerun failed before execution.
4. Latest clean Linux snapshot container
   `16fbe29726a272b4253c83d8e3ad01ebb1f7924c7f458b21fe1114a837dfa40b`:
   Debian12, Node24.22.0, matching dependency lockfile cache (npm ci NOT rerun).
   Standalone TypeScript passed and Next compilation succeeded in65s. Production
   build then reached lint/type validation; final completion/diagnostic check is
   unavailable after Docker engine failure. Do NOT report this build as passed.
   Prior complete Linux snapshot build/diagnostic checks passed before final edits.
5. Docker failure: `docker inspect` and even read-only `docker version` return
   `500 Internal Server Error ... dockerDesktopLinuxEngine/v1.56/...`.
   Final native migration rerun and latest crash rerun stopped at inspection;
   they did not execute tests. No Docker reset, service restart, container cleanup,
   data deletion or user-process termination was attempted.
6. Latest standard Windows full Vitest: exit1; 103 files/1213 tests passed,
   4 files/74 tests skipped, one worker-startup timeout for
   `auction-rpc-security-defaults-static.test.ts`. It is NOT a passing full run.
   Targeted single-fork retry of that file plus dev runner: 2 files/9 tests passed.
   Separate full fork-based rerun: exit0, 104 files/1216 tests passed,
   4 files/74 tests skipped, recorded in
   `scratch/scheduler-final-vitest-forks-20261105.log`. This diagnoses around the
   Windows worker-startup failure; it does not make the standard thread command
   or fresh GitHub CI pass. Prior full run:104 files/1215 tests passed,
   4 files/74 tests skipped; prior strict Linux database gate12 passed/0skipped.
7. Current scoped `npm run typecheck`: PASS. Earlier raw run failed only on
   preserved `scratch/merge-verification-*` copies, corrected through the explicit
   scratch exclusion. `npm run lint`: PASS with six existing warnings.
8. Git whitespace passed. No hosted/project secrets were printed. Local schema
   tests do not establish browser Realtime delivery, hosted role capabilities,
   external alerts or public deployment readiness.
9. Recovery explicitly supports audited permanent NO_REPLAY disposition, not
   arbitrary automatic retry or financial repair of genuinely unknown outcomes.
   A retired due action may still need a separately reviewed business recovery
   intent; do not call retirement proof that the auction has resumed correctly.

### Resume checklist

Docker engine is now available and the sequential local native/fresh installs,
actual cron CALL, crash/restart, strict DB gate, full Linux regressions and full
production build/diagnostic exclusion completed. Do not repeat these without
new changes/failures. Any further restart affecting existing local services
needs user approval. Review the complete intended patch before staging/commit.
Exact-commit CI/fresh npm ci require separately approved push
(which may deploy Preview). Hosted changes and production require separate
approvals. Alert destination/hosting/heartbeat and real acceptance remain gates.

The material below is retained historical progress. Its older open/implemented
statements and test counts are superseded by this checkpoint, not current truth.

## Historical progress (superseded)

This is an incomplete implementation checkpoint, not deployment approval.
Baseline: audit/production-worker-security-hardening at
1d13743c827f78f6cc0cb552a95e0307f791d2ae. Existing local changes are preserved.

## Business policy

Preserve host review. Automatic selection closure does not authorize automatic
mini-auction start. New and existing sessions require host start intent; no new
automatic-start policy is authorized. Implementation must retain the host's RPC
authorization, persist its intent, and complete the transition atomically with a
durable action record. This policy has not yet been integrated into the scheduler.

## Blocker register

| ID | Severity | Blocker / root cause | Source | Required correction and evidence | Status |
| --- | --- | --- | --- | --- | --- |
| A | P1 | Missing HTTP response is treated as retry permission | supabase/operations/auction-scheduler.sql dispatch_tick | Logged execution/action protocol; commit then drop response and prove no repeated effect | Open |
| B | P1 | Action commits and completion evidence are separate | src/lib/auction/auction-orchestrator.ts executeAuctionTick | Same PostgreSQL transaction for transition and completion; crash before/after commit | Open |
| B1 | P2 | Node client discards structured non-2xx results | src/lib/auction/tick-client.ts requestAuctionTick | Bounded result parsing with hidden error property; real HTTP 503 with mixed action outcomes | Implemented; does not constitute durable storage |
| C | P1 | Mini start depends on transient SELECTION_OPEN branch | auction-orchestrator.ts; MiniPoolReview.tsx; v3_start_mini_auction | Durable host start intent and idempotent close/start; crash and duplicate-start tests | Open |
| D | P1 | Circuit resets when Node process restarts | src/lib/auction/worker-runtime.ts runAuctionTickLoop | Persistent shared control and failure accounting; kill/restart test | Open |
| E | P1 | Reset cannot enforce reconciliation | supabase/operations/auction-scheduler.sql scheduler_state | Guarded recovery/evidence/approval/epoch checks; reset and activation negative tests | Open |
| F | P0 | Native pg_net can follow credential-bearing redirects | supabase/operations/auction-scheduler.sql net.http_post | Remove timer HTTP dependency or provide safe transport; keep protection enabled | Open for hosted scheduling; real Node redirect tests added |
| G | P1 | pg_net history is not durable application authority | scheduler_state request_id and net._http_response | Logged ledgers; database crash/transport history loss tests | Open |
| H | P0 | Cron authorization adapter is not proven | v3_start_mini_auction and lifecycle RPC grants | Least-privilege private adapter with existing caller authorization regression tests | Open; potential security risk, not a demonstrated deployed exploit |
| I | P1 | Lifecycle generation coverage is absent | pause/resume, countdown and lot/mini lifecycle paths | Complete mutation-path coverage and stale-generation rejection | Open |
| J | P1 | Host review and attempted automatic start differ | MiniPoolReview.tsx and auction-orchestrator.ts | Apply documented host-start policy without silent auto-start | Policy recorded; code pending |
| K | P2 | No proven independent monitoring/alert destination | docs/DEPLOYMENT.md | Durable outbox, independently hosted health monitor, approved owner/destination; outage tests | Open |
| L | P2 | Exact hosted runtime/configuration not verified | tick route maxDuration; hosted cron/principal | Separately approved read-only hosted verification and disabled installation rehearsal | Open |

## Implemented in this checkpoint

- AuctionTickHttpError retains a validated TickResult in a non-enumerable property.
- Error response parsing is limited to 64 KiB and the existing request deadline.
- Error messages do not include response bodies. HTML/oversized/invalid responses
  do not become structured action results.
- Real loopback HTTP tests cover five redirect statuses, structured 503 outcomes,
  oversized bodies, authentication/server errors, and stalled response bodies.
- Tests use synthetic credentials and real Node fetch. Production bypass URL
  restrictions are not loosened for testing.

These changes preserve failure diagnostics but do not prevent replay, provide a
durable circuit, or implement atomic action completion. Do not deploy or activate
the current scheduler based on this checkpoint.

## Remaining validation

A disabled local SQL candidate exists at
`supabase/operations/auction-action-ledger.sql`. It adds logged lot actions and
attempts, persistent control/epoch, and an invoker-rights executor restricted to the
real postgres caller. Transition and completion share a transaction; returned RPC
failures roll back the inner block and quarantine the action. Existing authoritative
RPC locking and authorization are retained. No cron jobs or public RPC changes.

This candidate is incomplete and only partly validated: it lacks generation coverage,
mini/resume intent, guarded reset, planning and monitoring. Its uniqueness rule
only supports a single immutable lot incarnation, not reopened lot identities.
Do not install it on hosted Supabase. No complete durable migration, production
authorization adapter, generation mechanism, guarded reset, monitoring service or
production scheduler has been implemented here.
The required real PostgreSQL failure-injection matrix is outstanding. Historical
Linux/database results must not be presented as validation of a completed recovery
implementation. Hosted installation and activation remain blocked.

No commit, push, hosted SQL, Vault, OAuth, Vercel or production changes are
authorized by this document. Local implementation remains authorized by the task.

Operational owner: the user. Alert destination: pending, as explicitly selected.
No external alert delivery has been configured or tested.

## Fresh validation, 2026-11-05

- Focused client/worker/API run: 54 tests passed, including 11 real loopback HTTP
  tests. Loopback connections require execution outside the restricted sandbox;
  the sandbox run failed with connect EACCES and is not counted as a product pass.
- Full Vitest run: 102 files passed, 4 skipped; 1207 tests passed, 74 skipped.
  Conditional suites remain skipped; this is not the complete recovery matrix.
- New network-disabled tmpfs PostgreSQL 17 container:
  ma-action-ledger-20261105172313. Canonical migrations: 76 passed.
- Fresh database mega_auction_ledger_retry_20261105: disabled candidate installed;
  real human bid and sold transition, purse/squad duplicate invariants, completion
  result discard then reconnect, stale epoch rejection, forced termination of a
  uniquely identified synthetic transaction before commit, and two concurrent
  executor connections passed using scripts/check-action-ledger.mjs.
- An earlier crash harness incorrectly matched psql's '(1 row)' output as a
  barrier. That run failed and is not evidence. Corrected scalar parsing and a
  fresh database were used for the passing run; prior fixtures were preserved.
- The disposable cluster warned that wal_level is insufficient for logical
  publication. Realtime delivery was NOT tested by this run.
- Git whitespace and Node script syntax checks passed. No new Linux build or
  TypeScript completion is claimed for this candidate.
- HTTP lost-response execution recovery, mini/resume, generation changes,
  database restart, guarded reset, full authorization and monitoring remain open.

Verdict: NOT READY — BLOCKERS REMAIN. This is an implementation checkpoint,
not completion of the requested production-readiness task.

## Continued local implementation, 2026-11-05

Additional files (all local/uncommitted):

- `supabase/operations/auction-scheduler-engine.sql`: private monotonic LOT,
  AUCTION and MINI generation tracking, bounded/deduplicated due-lot planner,
  persistent parent execution records and action links, safe timer/generation
  defer outcomes, bounded retry classification, quarantine alert outbox, and a
  top-level transaction-controlling lot procedure. Generations are private and
  retained independently of application cleanup. Idle auctions cannot consume
  the planner's entire due-auction budget. Superseded actions become terminal.
- `supabase/operations/auction-scheduler-recovery.sql`: disable/epoch fencing,
  session-derived administrative identity, shutdown attestation, snapshot-bound
  short-lived reset approval, reset that remains disabled, separate activation
  approval, and append-only-by-application-ACL audit records. This does NOT yet
  resolve unknown actions or implement asynchronous claims/leases. Direct owner
  SQL can bypass controls; this is not protection against the database owner.
- `scripts/check-scheduler-engine.mjs` and `check-scheduler-recovery.mjs`:
  rollback-only tests of those new controls against real PostgreSQL.
- `scripts/validate-scheduler-database.mjs`: creates a new isolated database,
  applies canonical migrations and all three candidate SQL files, runs the
  financial/crash/concurrency/planner/recovery checks and exercises a real
  top-level procedure commit. It creates no cron jobs.
- `scripts/validate-scheduler-linux.mjs`: clean intended-source Linux snapshot,
  excludes credentials/diagnostics/backups, compares lockfiles before using
  cached dependencies. It does not rerun npm ci or apply Vercel upload filtering.
- `auction-orchestrator.ts`: removed attempted automatic mini start after close;
  an explicit regression test preserves host pool review. Durable host-intent
  creation/execution remains outstanding; the existing host start RPC remains.

Fresh evidence:

- Focused host-review/tick/real-transport checks: 53 tests passed.
- Full Vitest: 102 files passed, 4 skipped; 1208 tests passed, 74 skipped.
- Fresh database `mega_auction_ledger_retry_1793882185269`: 76 canonical
  migrations and all three SQL candidates passed; all database check scripts
  passed. Actual top-level CALL applied unsold transition; prior squad preserved.
- A PL/pgSQL alias/record collision was caught and fixed before the final fresh
  install. Failed tests are not counted as evidence.
- Clean Linux container `fb972e0a397765611d52f949d2850d4ac195f8d8866f6201e11eae59239c1629`:
  Debian 12, Node v24.22.0; clean TypeScript and Next production build passed,
  including diagnostic-route exclusion. Six existing lint warnings remained.
  Dependencies came from the cached image with a matching lockfile, not npm ci.

Installation order for LOCAL tests only:
1. Canonical migrations.
2. auction-action-ledger.sql.
3. auction-scheduler-engine.sql.
4. auction-scheduler-recovery.sql.

These are candidate operation files, not a reviewed hosted migration package.
They are intentionally not idempotent installation scripts; use fresh disposable
databases. Do not run them on an existing hosted project.

Still open (implementation remains authorized locally): durable mini/resume
workflows and host-intent integration; asynchronous claim/lease reconciliation;
operator disposition of unknown actions; one verified cron/legacy-worker cutover;
complete execution health summaries; independent monitoring/alert delivery;
database-restart, lost-HTTP-response and remaining race/authorization acceptance
tests. No production-readiness or full recovery completion claim is made.
