import Image from "next/image";
import { headers } from "next/headers";
import { clearSelections, toggleCompetition, toggleLeagueTeams, toggleTeam } from "./actions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const TIME_ZONE = process.env.DISPLAY_TIME_ZONE ?? "Europe/Amsterdam";

type TeamRow = {
  id: number;
  name: string;
  crest: string | null;
  isSelected: boolean;
  competitionId: number | null;
};

type CompetitionRow = {
  id: number;
  name: string;
  area: string;
  scope: string;
  isSelected: boolean;
};

type MatchRow = {
  id: number;
  utcDate: Date;
  stage: string | null;
  competition: { name: string };
  homeTeam: { name: string; crest: string | null };
  awayTeam: { name: string; crest: string | null };
};

function kickoff(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  }).format(date);
}

function chip(selected: boolean) {
  return [
    "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition",
    selected
      ? "border-emerald-400 bg-emerald-400/15 text-emerald-200"
      : "border-[#1f2c47] bg-[#111a2e] text-slate-300 hover:border-slate-500",
  ].join(" ");
}

export default async function Home() {
  // Reading the request keeps this dashboard rendered per request instead of prerendered.
  await headers();

  let competitions: CompetitionRow[] = [];
  let teams: TeamRow[] = [];
  let matches: MatchRow[] = [];
  let syncRuns: { source: string; completedAt: Date }[] = [];
  let databaseUnavailable = false;
  let hasSelection = false;

  try {
    competitions = await prisma.competition.findMany({
      select: { id: true, name: true, area: true, scope: true, isSelected: true },
      orderBy: [{ scope: "asc" }, { area: "asc" }, { name: "asc" }],
    });
    teams = await prisma.team.findMany({
      select: { id: true, name: true, crest: true, isSelected: true, competitionId: true },
      orderBy: { name: "asc" },
    });

    const selectedCompetitionIds = competitions.filter((item) => item.isSelected).map((item) => item.id);
    const selectedTeamIds = teams.filter((item) => item.isSelected).map((item) => item.id);
    hasSelection = selectedCompetitionIds.length > 0 || selectedTeamIds.length > 0;

    if (hasSelection) {
      matches = await prisma.match.findMany({
        where: {
          utcDate: { gte: new Date() },
          ...(selectedCompetitionIds.length ? { competitionId: { in: selectedCompetitionIds } } : {}),
          ...(selectedTeamIds.length
            ? {
                OR: [
                  { homeTeamId: { in: selectedTeamIds } },
                  { awayTeamId: { in: selectedTeamIds } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          utcDate: true,
          stage: true,
          competition: { select: { name: true } },
          homeTeam: { select: { name: true, crest: true } },
          awayTeam: { select: { name: true, crest: true } },
        },
        orderBy: { utcDate: "asc" },
        take: 100,
      });
    }

    syncRuns = await prisma.syncRun.findMany({ select: { source: true, completedAt: true } });
  } catch (error) {
    console.error("Unable to load Next Kickoff data", error);
    databaseUnavailable = true;
  }

  const leagueGroups = competitions
    .filter((competition) => competition.scope === "DOMESTIC")
    .map((competition) => ({
      competition,
      teams: teams.filter((team) => team.competitionId === competition.id),
    }))
    .filter((group) => group.teams.length > 0);

  const groupedTeamIds = new Set(leagueGroups.flatMap((group) => group.teams.map((team) => team.id)));
  const otherTeams = teams.filter((team) => !groupedTeamIds.has(team.id));
  const selectedTeamCount = teams.filter((team) => team.isSelected).length;
  const selectedCompetitionCount = competitions.filter((item) => item.isSelected).length;

  return (
    <main className="mx-auto max-w-7xl px-6 pb-20 pt-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#1f2c47] pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">Fixture watch</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Next Kickoff</h1>
        </div>
        <div className="text-right text-sm text-slate-400">
          {databaseUnavailable ? (
            <p className="text-rose-300">Database unavailable</p>
          ) : syncRuns.length ? (
            syncRuns.map((run) => (
              <p key={run.source}>
                {run.source}: {kickoff(run.completedAt)}
              </p>
            ))
          ) : (
            <p>No import has run yet</p>
          )}
        </div>
      </header>

      {databaseUnavailable ? (
        <p className="mt-10 rounded-xl border border-dashed border-[#1f2c47] p-6 text-slate-300">
          The database cannot be reached. Check <code>DATABASE_URL</code> and your provider status.
        </p>
      ) : (
        <>
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <section className="rounded-2xl border border-[#1f2c47] bg-[#0f172a]/60 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Clubs</h2>
                <span className="text-xs text-slate-400">{selectedTeamCount} selected</span>
              </div>

              {teams.length === 0 ? (
                <p className="mt-4 text-sm text-slate-400">Run an import to load clubs.</p>
              ) : (
                <div className="mt-5 space-y-6">
                  {leagueGroups.map((group) => {
                    const allSelected = group.teams.every((team) => team.isSelected);
                    return (
                      <div key={group.competition.id}>
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-slate-200">
                            {group.competition.area}
                            <span className="ml-2 font-normal text-slate-500">{group.competition.name}</span>
                          </h3>
                          <form action={toggleLeagueTeams}>
                            <input type="hidden" name="competitionId" value={group.competition.id} />
                            <input type="hidden" name="isSelected" value={String(!allSelected)} />
                            <button className="cursor-pointer text-xs text-emerald-400 hover:underline">
                              {allSelected ? "Clear all" : "Select all"}
                            </button>
                          </form>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {group.teams.map((team) => (
                            <form action={toggleTeam} key={team.id}>
                              <input type="hidden" name="teamId" value={team.id} />
                              <input type="hidden" name="isSelected" value={String(!team.isSelected)} />
                              <button className={chip(team.isSelected)}>
                                {team.crest ? (
                                  <Image
                                    src={team.crest}
                                    alt=""
                                    width={16}
                                    height={16}
                                    className="h-4 w-4 object-contain"
                                  />
                                ) : null}
                                {team.name}
                              </button>
                            </form>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {otherTeams.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-200">
                        Other clubs
                        <span className="ml-2 font-normal text-slate-500">no league imported yet</span>
                      </h3>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {otherTeams.map((team) => (
                          <form action={toggleTeam} key={team.id}>
                            <input type="hidden" name="teamId" value={team.id} />
                            <input type="hidden" name="isSelected" value={String(!team.isSelected)} />
                            <button className={chip(team.isSelected)}>
                              {team.crest ? (
                                <Image
                                  src={team.crest}
                                  alt=""
                                  width={16}
                                  height={16}
                                  className="h-4 w-4 object-contain"
                                />
                              ) : null}
                              {team.name}
                            </button>
                          </form>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-[#1f2c47] bg-[#0f172a]/60 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Competitions</h2>
                <span className="text-xs text-slate-400">{selectedCompetitionCount} selected</span>
              </div>

              {competitions.length === 0 ? (
                <p className="mt-4 text-sm text-slate-400">Run an import to load competitions.</p>
              ) : (
                <div className="mt-5 flex flex-wrap gap-2">
                  {competitions.map((competition) => (
                    <form action={toggleCompetition} key={competition.id}>
                      <input type="hidden" name="competitionId" value={competition.id} />
                      <input type="hidden" name="isSelected" value={String(!competition.isSelected)} />
                      <button className={chip(competition.isSelected)}>
                        {competition.name}
                        <span className="text-xs text-slate-500">{competition.area}</span>
                      </button>
                    </form>
                  ))}
                </div>
              )}

              <form action={clearSelections} className="mt-6">
                <button className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
                  Reset all selections
                </button>
              </form>
            </section>
          </div>

          <section className="mt-10">
            <div className="flex items-end justify-between gap-4 border-b border-[#1f2c47] pb-4">
              <h2 className="text-lg font-semibold">Upcoming matches</h2>
              <span className="text-3xl font-semibold text-emerald-400">{matches.length}</span>
            </div>

            {!hasSelection ? (
              <p className="mt-6 rounded-xl border border-dashed border-[#1f2c47] p-6 text-sm text-slate-400">
                Pick the clubs you follow on the left and the competitions on the right. Matches appear when a
                selected club plays in a selected competition.
              </p>
            ) : matches.length === 0 ? (
              <p className="mt-6 rounded-xl border border-dashed border-[#1f2c47] p-6 text-sm text-slate-400">
                No upcoming matches for this combination.
              </p>
            ) : (
              <ul className="mt-2">
                {matches.map((match) => (
                  <li
                    key={match.id}
                    className="grid gap-2 border-b border-[#16223a] py-4 md:grid-cols-[190px_minmax(0,1fr)_200px] md:items-center md:gap-6"
                  >
                    <time dateTime={match.utcDate.toISOString()} className="text-sm text-slate-400">
                      {kickoff(match.utcDate)}
                    </time>
                    <div className="flex items-center gap-3 font-medium">
                      <span className="flex items-center gap-2">
                        {match.homeTeam.crest ? (
                          <Image
                            src={match.homeTeam.crest}
                            alt=""
                            width={18}
                            height={18}
                            className="h-[18px] w-[18px] object-contain"
                          />
                        ) : null}
                        {match.homeTeam.name}
                      </span>
                      <span className="text-xs uppercase tracking-wide text-emerald-400">vs</span>
                      <span className="flex items-center gap-2">
                        {match.awayTeam.crest ? (
                          <Image
                            src={match.awayTeam.crest}
                            alt=""
                            width={18}
                            height={18}
                            className="h-[18px] w-[18px] object-contain"
                          />
                        ) : null}
                        {match.awayTeam.name}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400">
                      {match.competition.name}
                      {match.stage ? ` · ${match.stage}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
