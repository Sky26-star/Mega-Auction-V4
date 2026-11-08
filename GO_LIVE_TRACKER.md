# Mega Auction V4 — GO LIVE TRACKER

**Project:** Mega Auction V4  
**Branch:** `audit/production-worker-security-hardening`  
**Audited code:** `aa9c6e3`  
**Current decision:** PRODUCTION ON HOLD  
**Last review:** 8 November 2026

## Verified and completed

- [x] GitHub CI and production build passed at `aa9c6e3`.
- [x] Supabase PostgreSQL 17.6 and migration ledger inspected.
- [x] Selected auction RPC permissions and security settings verified.
- [x] Hosted `pg_cron` installed; zero cron jobs registered.
- [x] Manual hosted database backup created.
- [x] Backup archive readable using `pg_restore -l`.
- [x] Latest `aa9c6e3` Vercel Preview deployed successfully.
- [x] Vercel Preview Standard Protection enabled.

## Open blockers

**TIMER-01 — GET READY stuck**

- Earlier Preview reached `STARTING IN 0s` but remained at `GET READY`.
- Native hosted scheduler migration is not installed.
- Hosted cron jobs: zero.
- Root cause is strongly suspected to involve missing server-side scheduling, but has not been fully proven.
- **Closure:** Verify GET READY → BIDDING → SOLD/UNSOLD → NEXT PLAYER with persisted state and reconnect.

**BACKUP-01 — Restore validation pending**

- Backup: `MegaAuctionV4-20261108-005332.dump`
- Size: 1,644,423 bytes.
- Archive readability passed.
- Full isolated restore has not been verified.

**STATE-01 — Old auction inconsistency**

- One auction remains IN_PROGRESS.
- Current lot index 165 is PENDING.
- Expired non-current BIDDING lot at index 0 is over 30 days old.
- No bids or auction events during the preceding seven days.
- Must not automatically update or delete.

**MIG-01 — Migration history difference**

- Hosted-only migration `20261010230917`, with zero recorded statements.
- Repository-only native migration `20261105120000`, not yet installed.
- Preserve migration history.

**AUTH-01 — Authentication acceptance**

- Google login reached the auction application in earlier testing.
- Complete fresh authentication and two-user acceptance on the new Preview remain unverified.

**MONITOR-01 — Scheduler monitoring**

- Independent monitoring, alerts and failure recovery are not yet verified.

## Release order

1. Verify isolated database restore using existing tools and backup.
2. Resolve or document the old auction and migration risks.
3. Confirm all old and new timer workers have a safe single-owner cutover plan.
4. Establish monitoring and real alert delivery.
5. Obtain separate approval to install native scheduler migration in disabled state.
6. Obtain separate approval to register the disabled cron job.
7. Obtain separate approval for controlled activation.
8. Complete actual laptop-and-phone auction acceptance.
9. Obtain final private production go-live approval.

## Working rules

- Never repeat previously passed checks without a specific reason.
- Never call a failing issue fixed without the actual retest passing.
- If a test fails, continue that same issue instead of restarting everything.
- Never use an arbitrary progress percentage.
- Never push code or redeploy merely to fix a database configuration issue.
- Never change hosted database data, activate timers or make the website public without specific approval.
- Every completed action must update this tracker.

**NEXT ACTION:** Validate the existing backup in an isolated disposable database, without touching hosted Supabase or overwriting local databases.

**GO-LIVE STATUS: NOT APPROVED.**
