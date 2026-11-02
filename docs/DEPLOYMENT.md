# MEGA AUCTION V1 â€” DEPLOYMENT & ENVIRONMENT CONFIGURATION

> **Status:** APPROVED
> **Version:** 1.0
> **Date:** 2026-08-10

---

## 1. Hosting Architecture
- **Application Host:** Vercel (Next.js App Router)
- **Database & Auth Host:** Supabase Cloud (Managed PostgreSQL)
- **CI/CD Pipeline:** GitHub Actions

---

## 2. Required Environment Variables

| Variable Name | Environment | Description | Public/Secret |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | All | Supabase project URL | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | Supabase anonymous API key | Public |
| `NEXT_PUBLIC_APP_URL` | All | Base application URL | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Admin key for server-side REST broadcasts & administrative tasks | **Secret** |
| `DATABASE_URL` | Server only | Direct connection string for Supabase CLI migrations | **Secret** |

---

## 3. Production Deployment Checklist
1. Link project via `supabase link`.
2. Apply database migrations: `supabase db push`.
3. Verify pg_cron jobs are scheduled (`expire-lots-backstop`, `keep-alive`, `clean-cron-logs`).
4. Configure environment variables in Vercel project settings.
5. Deploy to Vercel via GitHub `main` branch push.
