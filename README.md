# Next Kickoff

A serverless Next.js dashboard for tracking upcoming Eredivisie fixtures from football-data.org. Select leagues and teams from imported data; the dashboard shows upcoming matches matching either selection.

## Local setup

1. Copy `.env.example` to `.env` and fill in a PostgreSQL `DATABASE_URL`, football-data.org API token, and random `CRON_SECRET`.
2. Generate the Prisma client: `npx prisma generate`.
3. Apply the included schema: `npx prisma migrate deploy`.
4. Start the app: `npm run dev`.
5. Seed all Eredivisie clubs and the next seven days of fixtures by calling `GET /api/cron/sync-fixtures` with `Authorization: Bearer <CRON_SECRET>`. Then choose teams and the Eredivisie in the dashboard.

## Deployment

Deploy to Vercel with a serverless-compatible PostgreSQL provider such as Neon or Supabase. Add `DATABASE_URL`, `FOOTBALL_DATA_API_TOKEN`, and `CRON_SECRET` to the Vercel project environment variables. `vercel.json` invokes the secured sync route at minute zero every hour.

Vercel Cron requests must include the configured `CRON_SECRET`; Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when that environment variable is set. The sync imports all Eredivisie clubs and the next seven days of Eredivisie fixtures in UTC, upserting records by football-data.org IDs.
