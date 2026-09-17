# Next Kickoff

Pick the clubs you follow and the competitions you care about, then see only the matches where
those clubs play in those competitions. The selected fixtures can be downloaded as a calendar file.

The site is a static export: fixtures are read from the database at build time, and your
selections are kept in the browser.

## Data sources

| Source | Competitions | Command |
| --- | --- | --- |
| football-data.org (free tier) | Champions League, World Cup, European Championship, Premier League, Championship, Bundesliga, Eredivisie, Ligue 1, Serie A, La Liga, Primeira Liga, Brasileirão | `npm run sync:football` |
| uefa.com match API | Europa League, Conference League | `npm run scrape:uefa` |

Europa League and Conference League are not part of the football-data.org free tier, so they come
from the public match API that uefa.com itself uses.

Clubs are matched across sources by name slug, then by team code combined with country, so the
same club arriving from both feeds stays a single row.

## Local setup

1. `cp .env.example .env` and fill in `DATABASE_URL` and `FOOTBALL_DATA_API_TOKEN`.
2. `npx prisma migrate dev` to create the tables.
3. `npm run sync:football` then `npm run scrape:uefa` to import competitions, clubs and fixtures.
4. `npm run dev` and open http://localhost:3000.

To enable **Sync all with Google Calendar**, create a Google OAuth 2.0 Web application client,
add the local and deployed site URLs as authorized JavaScript origins, enable the Google Calendar
API, and set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in `.env`. The app creates or reuses a calendar named
`Football` and updates the selected matches there. The client ID is public; never put a client secret
in the browser or repository.

Useful checks: `npm run db:stats` and `npm run db:debug-filter`.

## Deployment

Published to GitHub Pages by the **Deploy to GitHub Pages** workflow, triggered manually so the
site is rebuilt when you choose.

1. Settings → Pages → set Source to **GitHub Actions**.
2. Add `DATABASE_URL` as a repository secret; the build reads it and it never reaches the browser.
3. Run the workflow after an import to publish the new fixtures.

`basePath` is supplied by `actions/configure-pages`, so the project subpath is handled
automatically. Other static hosts serve from the root and need no extra configuration.
