# Next Kickoff

A serverless Next.js dashboard for tracking UEFA Champions League, Europa League, and Conference League fixtures. Select leagues and teams from imported data; the dashboard shows upcoming matches matching either selection.

## Local setup

1. Copy `.env.example` to `.env` and fill in a PostgreSQL `DATABASE_URL`.
2. Generate the Prisma client: `npx prisma generate`.
3. Apply the included schema: `npx prisma migrate deploy`.
4. Start the app: `npm run dev`.
5. Install Playwright once with `npx playwright install chromium`, then run `npm run scrape:uefa` to import the upcoming fixtures. Then choose teams and competitions in the dashboard.

## Deployment

Deploy the dashboard to Vercel with a serverless-compatible PostgreSQL provider such as Neon or Supabase. Add `DATABASE_URL` to the Vercel project environment variables. Configure the GitHub Actions `DATABASE_URL` repository secret so the scraper can update the same database.

The scraper runs daily at 05:17 UTC through `.github/workflows/scrape-uefa.yml` and can be started manually through GitHub Actions. It reads the three official UEFA fixture pages with Playwright, then upserts current teams and upcoming fixtures by UEFA IDs.
