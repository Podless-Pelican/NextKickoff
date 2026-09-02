import { toggleLeagueSelection, toggleTeamSelection } from "./actions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type FixtureListItem = {
  id: number;
  startsAt: Date;
  venue: string | null;
  league: { name: string };
  homeTeam: { name: string };
  awayTeam: { name: string };
};

type SelectionItem = { id: number; name: string; isSelected: boolean };
type SyncStatus = { completedAt: Date } | null;

function matchTime(date: Date) {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

export default async function Home() {
  const now = new Date();
  let fixtures: FixtureListItem[] = [];
  let leagues: SelectionItem[] = [];
  let teams: SelectionItem[] = [];
  let lastSync: SyncStatus = null;
  let databaseUnavailable = false;

  try {
    const selectedLeagues = await prisma.league.findMany({
      where: { isSelected: true },
      select: { id: true },
    });
    const selectedTeams = await prisma.team.findMany({
      where: { isSelected: true },
      select: { id: true },
    });
    const selectedLeagueIds = selectedLeagues.map((league) => league.id);
    const selectedTeamIds = selectedTeams.map((team) => team.id);
    const fixtureFilters = [
      ...(selectedLeagueIds.length ? [{ leagueId: { in: selectedLeagueIds } }] : []),
      ...(selectedTeamIds.length
        ? [{ OR: [{ homeTeamId: { in: selectedTeamIds } }, { awayTeamId: { in: selectedTeamIds } }] }]
        : []),
    ];

    fixtures = await prisma.fixture.findMany({
      where: { startsAt: { gte: now }, AND: fixtureFilters },
      include: { league: true, homeTeam: true, awayTeam: true },
      orderBy: { startsAt: "asc" },
      take: 50,
    });
    leagues = await prisma.league.findMany({ orderBy: { name: "asc" }, take: 24 });
    teams = await prisma.team.findMany({ orderBy: { name: "asc" }, take: 36 });
    lastSync = await prisma.syncRun.findUnique({ where: { source: "free-api-live-football-data:uefa" } });
  } catch (error) {
    console.error("Unable to load Next Kickoff data", error);
    databaseUnavailable = true;
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Fixture watch</p>
          <h1>Next Kickoff</h1>
        </div>
        <p className="sync-status">
          {databaseUnavailable
            ? "Database unavailable"
            : lastSync
              ? `Updated ${matchTime(lastSync.completedAt)} UTC`
              : "Awaiting first sync"}
        </p>
      </header>

      <section className="fixture-section" aria-labelledby="upcoming-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Your watchlist</p>
            <h2 id="upcoming-heading">Upcoming matches</h2>
          </div>
          <span className="count">{fixtures.length}</span>
        </div>
        {databaseUnavailable ? (
          <p className="empty">The database cannot be reached. Check its provider status, network access, and DATABASE_URL.</p>
        ) : fixtures.length ? (
          <div className="fixtures">
            {fixtures.map((fixture: FixtureListItem) => (
              <article className="fixture" key={fixture.id}>
                <time dateTime={fixture.startsAt.toISOString()}>{matchTime(fixture.startsAt)} UTC</time>
                <div className="teams"><strong>{fixture.homeTeam.name}</strong><span>vs</span><strong>{fixture.awayTeam.name}</strong></div>
                <p>{fixture.league.name}{fixture.venue ? ` · ${fixture.venue}` : ""}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty">Choose a league or team below once the first sync has imported fixtures.</p>
        )}
      </section>

      <section className="watchlist" aria-label="Watchlist settings">
        <div>
          <p className="eyebrow">Filter source</p>
          <h2>Leagues</h2>
          <div className="choice-list">
            {leagues.map((league: SelectionItem) => (
              <form action={toggleLeagueSelection} key={league.id}>
                <input type="hidden" name="leagueId" value={league.id} />
                <input type="hidden" name="isSelected" value={String(!league.isSelected)} />
                <button className={league.isSelected ? "choice selected" : "choice"}>{league.name}</button>
              </form>
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow">Filter source</p>
          <h2>Teams</h2>
          <div className="choice-list">
            {teams.map((team: SelectionItem) => (
              <form action={toggleTeamSelection} key={team.id}>
                <input type="hidden" name="teamId" value={team.id} />
                <input type="hidden" name="isSelected" value={String(!team.isSelected)} />
                <button className={team.isSelected ? "choice selected" : "choice"}>{team.name}</button>
              </form>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
