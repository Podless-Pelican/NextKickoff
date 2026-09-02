# Next Kickoff

A serverless Next.js dashboard for tracking UEFA Champions League and Eredivisie fixtures from RapidAPI API-Football. Select leagues and teams from imported data; the dashboard shows upcoming matches matching either selection.

## Local setup

1. Copy `.env.example` to `.env` and fill in a PostgreSQL `DATABASE_URL`, RapidAPI API-Football key, season start year, and random `CRON_SECRET`.
2. Generate the Prisma client: `npx prisma generate`.
3. Apply the included schema: `npx prisma migrate deploy`.
4. Start the app: `npm run dev`.
5. Set `FIXTURE_LOOKAHEAD_DAYS` (default: 30), then seed competition teams and upcoming fixtures by calling `GET /api/cron/sync-fixtures` with `Authorization: Bearer <CRON_SECRET>`. Then choose teams and competitions in the dashboard.

## Deployment

Deploy to Vercel with a serverless-compatible PostgreSQL provider such as Neon or Supabase. Add `DATABASE_URL`, `RAPIDAPI_KEY`, `RAPIDAPI_HOST`, `FOOTBALL_SEASON`, and `CRON_SECRET` to the Vercel project environment variables. `vercel.json` invokes the secured sync route at minute zero every hour.

Vercel Cron requests must include the configured `CRON_SECRET`; Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when that environment variable is set. The sync imports Champions League and Eredivisie fixtures across the next `FIXTURE_LOOKAHEAD_DAYS` in UTC, upserting clubs and fixtures by API-Football IDs. It makes two API calls per hourly run.
