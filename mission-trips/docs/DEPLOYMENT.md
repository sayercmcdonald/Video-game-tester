# Deployment Guide

_Last updated: 2026-10-26_

Run **staging** and **production** as two completely separate deployments: separate databases, separate Stripe keys (test vs. live), separate encryption keys, separate file storage. Never copy production data into staging.

## 1. Hosting shape

The app is a standard Node.js server (`npm run build` then `npm start`) plus PostgreSQL. Recommended for the pilot: a managed host that provides a Node web service, managed Postgres with point-in-time recovery, a **persistent disk** for uploaded files, and a cron/scheduled job (Render, Railway and Fly.io all do). Serverless hosts (e.g. Vercel) need the S3 storage driver first (TASKS P0 #5).

Run a single web instance until rate limiting moves to the database (RISKS).

## 2. Environment variables

| Variable | Staging | Production |
| --- | --- | --- |
| `APP_ENV` | `staging` | `production` |
| `APP_URL` | `https://staging.yourdomain` | `https://yourdomain` |
| `DATABASE_URL` | staging database | production database (use SSL, e.g. `?sslmode=require`) |
| `DATA_ENCRYPTION_KEY` | its own `openssl rand -base64 32` | its own key, **backed up in a secrets manager** |
| `STRIPE_SECRET_KEY` | `sk_test_…` | `sk_live_…` (production refuses test keys) |
| `STRIPE_WEBHOOK_SECRET` | from the staging endpoint | from the production endpoint |
| `STRIPE_MODE` | `connect` (or `platform` for one church) | same |
| `EMAIL_TRANSPORT` | `resend` | `resend` (production requires it) |
| `EMAIL_FROM` | `Sent <no-reply@staging.yourdomain>` | your verified sender |
| `RESEND_API_KEY` | staging key | production key |
| `STORAGE_DIR` | path on the persistent disk | path on the persistent disk |
| `CRON_SECRET` | random | random (production requires it) |

The app validates these at startup and stops with a clear message if something required is missing.

## 3. Release steps

```bash
npm ci
npm run build                 # generates the DB client and builds the app
npm run db:deploy             # applies pending migrations (safe, non-destructive)
npm start                     # serves on $PORT (default 3000)
```

Most hosts let you set `npm run db:deploy` as a "pre-deploy" or "release" command. Never run `prisma migrate reset` or `migrate dev` against staging or production.

After the first deploy, sign up with your own account and run `npm run make-admin -- you@yourdomain` in the host's shell to become platform admin.

## 4. Stripe

1. In the Stripe Dashboard (test mode for staging, live mode for production), create a webhook endpoint at `https://<APP_URL>/api/stripe/webhook`.
   - `STRIPE_MODE=connect`: create it as a **Connect** endpoint ("events on connected accounts").
   - `STRIPE_MODE=platform`: create it as an **account** endpoint.
2. Subscribe to: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.succeeded`, `charge.updated`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `account.updated`.
3. Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.
4. For Connect, complete your platform profile in the Stripe Dashboard (Connect settings) before churches can onboard.

## 5. Email (Resend)

Verify your sending domain in Resend (adds SPF/DKIM records), set up DMARC, then set `RESEND_API_KEY` and `EMAIL_FROM`. Check **Platform admin** for queued/failed email counts.

## 6. Scheduled jobs

Every hour, either run `npm run jobs:run` as a scheduled job, or call:

```bash
curl -X POST https://<APP_URL>/api/cron/all -H "Authorization: Bearer $CRON_SECRET"
```

This sends deadline reminders, reconciles pending Stripe payments, retries emails and cleans up expired sessions. It is safe to run more often.

## 7. Backups and recovery

- **Database:** enable the host's automated daily backups *and* point-in-time recovery (at least 7 days). Test a restore into a scratch database before the pilot.
- **Files:** snapshot the persistent disk daily (or use versioned S3 storage once the driver exists).
- **Encryption key:** store `DATA_ENCRYPTION_KEY` in a password manager or secrets manager. Backups are useless for medical fields without it.

## 8. Monitoring

- Point an uptime monitor at `/api/health` (returns 200 when the app and database are reachable).
- Review **Platform admin** regularly: failed Stripe events, stuck payments, failed emails.
- Add an error-monitoring service (TASKS P0 #6). Until then, server errors are written to the host's logs.

## 9. Going live checklist

- [ ] Staging passes `npm run test:e2e` and a manual Stripe test-mode gift, refund and dispute.
- [ ] Production env vars set; app starts without config errors.
- [ ] Stripe live webhook endpoint created; a $1 live gift and refund verified.
- [ ] Email domain verified; a test receipt lands in the inbox, not spam.
- [ ] Backups enabled and a restore tested.
- [ ] The church's receipt statement and waiver text reviewed by the church.
- [ ] Demo data **not** seeded in production (the seed script refuses to run there).

## 10. Public demo on Render

`render.yaml` at the repository root is a Render Blueprint for a **demo** copy with demo data. It's for clicking through the product on a phone, not for real churches:

- Online giving is off (no Stripe keys) and emails are only logged, never sent.
- Free Render instances sleep after about 15 minutes idle; the first visit after that takes up to a minute.
- Free Render Postgres databases expire after 30 days (Render emails a warning first). Upgrade the database plan to keep it.
- Free instances have no persistent disk, so uploaded files disappear on each redeploy or restart.
- The demo logins (`admin@demo.test` etc., password in README) are public knowledge: anyone with the link can sign in and change demo data.

Steps:

1. Sign in at [render.com](https://render.com) with GitHub and allow access to this repository.
2. **New → Blueprint**, pick this repository. Render reads `render.yaml` and proposes a database `sent-demo-db` and a web service `sent-demo` (branch `claude/mission-trip-platform`, folder `mission-trips`).
3. Click **Apply**. The first build takes a few minutes. On start, the service applies migrations and loads the demo data once (`SEED_DEMO=true`; the seed skips itself if the demo church already exists).
4. Open the service's `https://sent-demo-….onrender.com` address and tap **Explore the demo**: the sign-in page lists the demo people (`DEMO_MODE=true`) so visitors can sign in with one tap. `DEMO_MODE` is refused in production. The app uses it automatically for links (`RENDER_EXTERNAL_URL`).

**Speed:** the free instance has a tenth of a CPU, so pages take noticeably longer than on a paid instance, and password checks (deliberately slow work) take longest. The demo sets `PASSWORD_HASH_COST=10` (instead of 12) so sign-in takes about a quarter of the time; existing hashes are upgraded or downgraded to the configured cost on the next sign-in. A thin bar at the top of the screen shows that a tap was registered while the server works. For a responsive demo, switch the service to Render's Starter instance.

To turn the demo into a real staging environment, follow sections 2–9: set `SEED_DEMO=false`, add a persistent disk or S3 storage, Stripe test keys and Resend.
