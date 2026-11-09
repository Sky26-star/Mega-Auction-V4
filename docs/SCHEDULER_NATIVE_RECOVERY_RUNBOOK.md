# Native scheduler: installation, cutover and recovery

Local implementation candidate, updated 6 November 2026. **No hosted execution approval.**
Read `SCHEDULER_RECOVERY_IMPLEMENTATION_STATUS.md` for current validation
evidence and remaining gates. None of these instructions constitutes authorization.

## Architecture and policy

PostgreSQL owns timers. The only scheduled command is a top-level
`CALL auction_recovery.run_native_tick(25)`, at one-second intervals. Stored
deadlines are timestamptz/UTC; a schedule interval does not depend on local time.
There is no Vercel request, pg_net, Vault or deployment-bypass credential in this
timer path. Vercel Standard Protection can remain enabled. Bids and host controls
still use their existing authenticated RPCs and financial/lot locks.

The migration candidate is
`supabase/migrations/20261105120000_native_scheduler_recovery.sql`. Its eight
source sections are under `supabase/operations/auction-*.sql`; verify exact
generation with `node scripts/build-scheduler-migration.mjs`. Apply the canonical
migration once, **not** those component files as well. Installation is one
transaction, owner DATABASE, circuit OPEN, dispatcher disabled, no cron job.
It adds logged private state, triggers, indexes, private transition adapters and
mode-aware public RPC wrappers. It does not delete application rows or alter
identity mappings. Source/signature drift aborts the whole installation.

Mini policy: close selections when due, retain pool review, start only after
durable host approval bound to the mini and auction generations. The new UI uses
`request_mini_start`. Under DATABASE ownership, the old public synchronous
mini-start RPC rejects direct execution; the native workflow owns the transition.
Synchronous compatibility is retained only under explicitly selected LEGACY ownership.
Persisted resume countdowns have separate workflow actions. A successful
business transition and its action/claim completion commit together. A tick may
partially finish across actions; completed actions are never blindly replayed.

## Required gates before hosted installation

1. Review every intended file; complete fresh Linux build, strict database gate,
   real cron CALL/crash tests and full regressions. Review the actual diff.
2. Obtain separate commit/push approval. A Git push may trigger a Vercel Preview;
   verify its deployment behavior and obtain deployment approval first if needed.
   Verify fresh GitHub CI against the exact new SHA, not this baseline HEAD.
3. Obtain read-only hosted preflight approval: original project identity, backup
   hash/restore evidence, exact pending migration ledger, function definitions and
   grants, cron version/configuration, actual cron username, existing jobs and
   active/in-flight timer clients. A local Supabase image is not hosted proof.
4. Provision the independent monitor/alert destination with separate approval,
   establish the operator and outage response coverage, and test real delivery.
5. Arrange an approved maintenance window. Pause affected rooms through normal
   host controls; wait for in-flight operations. Do not restore/reset the database.

## Single-owner cutover (each hosted change needs its own approval)

1. Stop the old Node/legacy ticker services and deactivate only identified timer
   cron jobs. Preserve their definitions, credentials and histories. Reconcile
   outstanding HTTP requests; absence of a transport record is not proof of no
   execution. Do not modify unrelated cron jobs or Vercel protection.
2. Apply only the reviewed pending canonical migration in its own transaction.
   Verify control DATABASE/disabled, private API-role denial, original profiles,
   users, identities, migration history, player data, purses and squads.
3. The database wrappers reject service-role timer calls in DATABASE mode,
   including old immutable deployments. The public mini-start wrapper also
   rejects authenticated hosts attempting direct execution in DATABASE mode. The new HTTP tick route returns 409;
   a missing owner RPC returns 503. These fences do not stop a database-owner
   script: inventory and stop all postgres/privileged old schedulers as well.
4. Separately approve and run
   `supabase/operations/install-native-scheduler-disabled.sql`. It refuses active
   identified legacy ticks and existing native job names, registers exactly one
   `mega-auction-native-tick` job and deactivates it before commit. Verify its
   exact command, one-second schedule, username postgres and active=false.
5. Separately approve activation after all acceptance prerequisites. Use the
   guarded operator sequence below; reset approval and activation approval are
   distinct. Only then activate that exact cron job. Observe real transitions,
   error history and external alerts. Do not activate the HTTP scheduler.

For local native-backed development use `npm run dev -- --web-only`. The default
dev runner is retained for explicitly LEGACY disposable backends; do not point
its Node worker or the worker Dockerfile at a DATABASE-owned hosted backend.

## Reconciliation and operator recovery

Run only as the verified real postgres session, never through browser/service
credentials. Record evidence outside public logs. Parameter values below are
operator placeholders, not executable deployment instructions.

1. Begin recovery: `SELECT auction_recovery.begin_recovery(<reason>);`
   Save its case UUID. It locks control, disables dispatch and increments epoch.
   Wait for/inspect actual execution transactions; never infer termination from
   lease expiry alone. Deactivate the native cron job separately after approval.
2. Inspect `control`, `claims`, `lot_actions`, `workflow_actions`, `attempts`,
   `executions`, `execution_actions`, `generations`, `mini_start_intents`,
   `alert_outbox`, cron history, relevant pg_stat_activity/locks, and authoritative
   auction/lot/bid/squad/purse/session rows. Transport logs are diagnostic only.
3. Reconcile each claim using
   `SELECT auction_recovery.reconcile_claim(<token>);`. It obtains the same
   control lock as execution; a still-running action must commit or roll back
   before outcome inspection. Use an operator connection lock/statement timeout
   so a blocked inspection reports a blocker rather than hanging indefinitely.
   A valid lease is rejected. Committed completion is retained. An expired claim
   without atomic completion becomes UNKNOWN, quarantines its action and opens
   the circuit. Neither expiry nor restart grants replay permission.
4. Attest actual worker shutdown:
   `SELECT auction_recovery.attest_shutdown(<case>, <evidence>);`. This records an
   operator assertion, not automatic proof. Identify clients, epoch, reviewed
   transaction outcome and current financial invariants in the evidence.
5. For an UNKNOWN expired claim, after inspection and explicit disposition
   approval use
   `SELECT auction_recovery.resolve_claim_no_replay(<case>, <token>, <evidence>);`.
   For a known quarantined action with no unresolved claim use
   `SELECT auction_recovery.resolve_action_no_replay(<case>, <action>, <LOT-or-WORKFLOW>, <evidence>);`.
   These retire work as SUPERSEDED with durable audit records. **They neither
   mark the business operation successful nor repair/retry it.** Determine
   separately whether an approved new lifecycle/host intent or data repair is
   necessary. Never edit balances or fabricate completion to unblock recovery.
6. Review all remaining pending work. Obtain reset approval, then
   `SELECT auction_recovery.approve_reset(<case>);`
   and `SELECT auction_recovery.reset_scheduler_circuit_guarded(<case>, <epoch>);`.
   Unresolved claims/actions/workflows block approval/reset. The snapshot hash,
   epoch and 15-minute approval window must match. Reset increments epoch and
   leaves enabled=false/circuit=OPEN. Any change invalidates stale approval.
7. After separate human activation approval:
   `SELECT auction_recovery.approve_activation(<case>);`
   then `SELECT auction_recovery.activate_scheduler(<case>, <new-epoch>);`.
   Cron activation is a separate configuration action. Verify all old drivers
   remain stopped, bots false, one native job, healthy deadlines and alerts.

Persistent SQL control is the production authority. Restarting the old Node
worker resets its in-memory counter but cannot cross DATABASE ownership fences.
There is no promise of automatic recovery from arbitrary ambiguous state.
Database owners can bypass SQL safeguards; restrict operational owner access.

## Monitoring and alert delivery

`public.auction_scheduler_health()` exposes bounded summaries (no secrets):
enabled/owner/epoch/circuit, last tick/success, stale tick flag, unknown/quarantine
counts and pending alerts. The NOLOGIN `auction_monitor` role has health-only
access. The NOLOGIN `auction_alert_sender` role can claim/ack alert events only.
No browser or service-role access to private recovery tables is granted.

With separate approval, create dedicated non-elevated LOGINs with membership in
only the corresponding role. Store credentials in an approved secret store.
Never use the app service key or owner DB password as monitor credentials.

Run `scripts/scheduler-monitor.mjs` from an independently hosted process at a
bounded interval (e.g. 5 seconds), using an external persistent state directory:
`SCHEDULER_MONITOR_DATABASE_URL`, `SCHEDULER_MONITOR_STATE_DIR`,
`SCHEDULER_MONITOR_CA_FILE` if required, `SCHEDULER_MONITOR_EXPECT_ENABLED=true`
only after activation, and `SCHEDULER_ALERT_URL`. TLS verification is mandatory.
Run `scripts/scheduler-alert-delivery.mjs` with
`SCHEDULER_ALERT_DATABASE_URL`, optional `SCHEDULER_ALERT_CA_FILE`, the same
receiver URL and optional server-only `SCHEDULER_ALERT_AUTH_TOKEN`.

Receiver delivery is at least once: deduplicate the stable Idempotency-Key and
acknowledge only accepted events. Both HTTP clients refuse redirects. Monitor
queues survive process restart; database outbox claims expire/back off and only
successful delivery is acknowledged. State files contain event classifications,
not credentials. Keep their directory private and outside the repository.

An independent process can detect database outage; it cannot detect its own
host/process outage. Add a separately provisioned dead-man/heartbeat receiver or
second independent watcher and test missed-heartbeat delivery. The user is the
owner; destination and hosting remain undecided. Local loopback delivery tests
do not establish production alert delivery, uptime or zero-budget availability.

## Runtime limits, retention and rollback

Budget 25 actions/tick, max100; per-action transaction timeout3s, lock timeout500ms,
lease30s, wall budget5s checked between actions (not a hard 5s entire-call limit).
PostgreSQL serializes an identical cron job; claims/control/epoch fence competing
executors. Hot control locking currently serializes native transitions globally;
load/latency at the intended concurrent-room count still needs acceptance tests.
Unknown claims quarantine; deterministic failures quarantine; supported transient
SQL errors get bounded backoff. Monitor both cron failures and stale summaries.

Do not enable retention/deletion automatically. Ledger/outbox/job-history growth
needs a measured, separately reviewed retention/archive policy. Source IDs are
retained without application-table FKs so normal authorized room cleanup does
not erase recovery evidence.

On failure: disable and fence, deactivate only the native job, preserve evidence,
reconcile and keep the system stopped. Do not drop the migration/schema, restore
a stale backup, or simply change owner to LEGACY. Re-enabling legacy ownership
would remove the database fences and requires its own reviewed rollback plan,
matching deployment, all native claims reconciled and explicit approval.

OAuth, real multi-device Realtime/bidding/sold/unsold/next-player/mini/trade/
summary acceptance and production go-live remain later, separately approved
stages. A successful build alone satisfies none of those hosted gates.
