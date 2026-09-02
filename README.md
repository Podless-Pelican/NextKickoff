# Next Kickoff

A serverless Next.js dashboard for tracking upcoming football fixtures from API-Football. Select leagues and teams from imported data; the dashboard shows upcoming matches matching either selection.

## Local setup

1. Copy `.env.example` to `.env` and fill in a PostgreSQL `DATABASE_URL`, API-Football key, and random `CRON_SECRET`.
2. Generate the Prisma client: `npx prisma generate`.
3. Apply the included schema: `npx prisma migrate deploy`.
4. Start the app: `npm run dev`.
5. Seed the first seven-day fixture window by calling `GET /api/cron/sync-fixtures` with `Authorization: Bearer <CRON_SECRET>`. Then choose teams and leagues in the dashboard.

## Deployment

Deploy to Vercel with a serverless-compatible PostgreSQL provider such as Neon or Supabase. Add `DATABASE_URL`, `API_FOOTBALL_KEY`, and `CRON_SECRET` to the Vercel project environment variables. `vercel.json` invokes the secured sync route at minute zero every hour.

Vercel Cron requests must include the configured `CRON_SECRET`; Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when that environment variable is set. The sync requests the next seven days in UTC and upserts leagues, teams, and fixtures by API-Football IDs.
