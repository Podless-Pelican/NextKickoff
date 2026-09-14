# Next Kickoff

A serverless Next.js dashboard for tracking UEFA Champions League and Eredivisie fixtures from API-Football. Select leagues and teams from imported data; the dashboard shows upcoming matches matching either selection.

## Local setup

1. Copy `.env.example` to `.env` and fill in a PostgreSQL `DATABASE_URL`, API-Football key, season start year, and `CRON_SECRET`.
2. Generate the Prisma client: `npx prisma generate`.
3. Apply the included schema: `npx prisma migrate deploy`.
4. Start the app: `npm run dev`.
5. Call `GET /api/cron/sync-fixtures` with `Authorization: Bearer <CRON_SECRET>` to import upcoming fixtures. Then choose teams and competitions in the dashboard.

## Deployment

Deploy to Vercel with a serverless-compatible PostgreSQL provider such as Neon or Supabase. Add `DATABASE_URL`, `API_FOOTBALL_KEY`, `FOOTBALL_SEASON`, `FIXTURE_LOOKAHEAD_DAYS`, and `CRON_SECRET` to Vercel environment variables.

`vercel.json` invokes the secured sync route at minute zero every hour. The route imports Champions League and Eredivisie fixtures within `FIXTURE_LOOKAHEAD_DAYS`, then upserts their teams and fixtures by API-Football IDs.

## UEFA scraper

`.github/workflows/scrape-uefa.yml` runs daily at 05:17 UTC and imports Europa League and Conference League fixtures from the official UEFA pages. Add `DATABASE_URL` as a GitHub repository secret so the workflow can update the same database. To run locally, install Chromium once with `npx playwright install chromium`, then run `npm run scrape:uefa`.
