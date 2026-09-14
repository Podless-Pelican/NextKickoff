# Next Kickoff

Pick the clubs you follow and the competitions you care about, then see only the matches where
those clubs play in those competitions.

## Data sources

| Source | Competitions | How it runs |
| --- | --- | --- |
| football-data.org (free tier) | Champions League, World Cup, European Championship, Premier League, Championship, Bundesliga, Eredivisie, Ligue 1, Serie A, La Liga, Primeira Liga, Brasileirão | `GET /api/cron/sync` (Vercel Cron, hourly) or `npm run sync:football` |
| uefa.com scraper | Europa League, Conference League | `npm run scrape:uefa` (GitHub Actions, daily) |

Europa League and Conference League are not part of the football-data.org free tier, which is why
they are scraped from the official UEFA fixture pages instead.

Clubs are stored once per slug, so the same club coming from both sources stays a single row.

## Local setup

1. `cp .env.example .env` and fill in `DATABASE_URL`, `FOOTBALL_DATA_API_TOKEN` and `CRON_SECRET`.
2. `npx prisma migrate dev --name init` to create the tables.
3. `npm run sync:football` to import competitions, clubs and fixtures.
4. `npx playwright install chromium` once, then `npm run scrape:uefa` for the UEFA competitions.
5. `npm run dev` and open http://localhost:3000.

## Deployment

Deploy to Vercel and add `DATABASE_URL`, `FOOTBALL_DATA_API_TOKEN`, `FIXTURE_LOOKAHEAD_DAYS`,
`CRON_SECRET` and `DISPLAY_TIME_ZONE` as environment variables. `vercel.json` calls
`/api/cron/sync` every hour.

The scraper runs in GitHub Actions because it needs a browser. Add `DATABASE_URL` and
`FOOTBALL_DATA_API_TOKEN` as repository secrets so both workflows can reach the same database.


## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
