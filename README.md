# Next Kickoff

A serverless Next.js dashboard for tracking UEFA Champions League, Europa League, and Conference League fixtures from Free API Live Football Data on RapidAPI. Select leagues and teams from imported data; the dashboard shows upcoming matches matching either selection.

## Local setup

1. Copy `.env.example` to `.env` and fill in a PostgreSQL `DATABASE_URL`, RapidAPI key, and random `CRON_SECRET`.
2. Generate the Prisma client: `npx prisma generate`.
3. Apply the included schema: `npx prisma migrate deploy`.
4. Start the app: `npm run dev`.
5. Set `FIXTURE_LOOKAHEAD_DAYS` (default: 30), then seed competition teams and upcoming fixtures by calling `GET /api/cron/sync-fixtures` with `Authorization: Bearer <CRON_SECRET>`. Then choose teams and competitions in the dashboard.

## Deployment

Deploy to Vercel with a serverless-compatible PostgreSQL provider such as Neon or Supabase. Add `DATABASE_URL`, `RAPIDAPI_KEY`, `RAPIDAPI_HOST`, `FIXTURE_LOOKAHEAD_DAYS`, and `CRON_SECRET` to the Vercel project environment variables. `vercel.json` invokes the secured sync route at minute zero every hour.

Vercel Cron requests must include the configured `CRON_SECRET`; Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when that environment variable is set. The sync imports UEFA Champions League, Europa League, and Conference League fixtures across the next `FIXTURE_LOOKAHEAD_DAYS`, upserting clubs and fixtures by provider IDs. It uses one full-schedule request per competition, for three requests per run.
