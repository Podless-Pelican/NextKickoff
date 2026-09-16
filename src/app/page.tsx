import Dashboard, { type CompetitionView, type MatchView, type TeamView } from "@/components/dashboard";
import { prisma } from "@/lib/prisma";

const MAX_MATCHES = 4_000;

// Data is baked in at build time; rerun the deploy workflow after an import.
export default async function Home() {
  const generatedAt = new Date();

  const competitions = await prisma.competition.findMany({
    where: { code: { not: "WC" } },
    select: { id: true, name: true, area: true, scope: true },
    orderBy: [{ scope: "asc" }, { area: "asc" }, { name: "asc" }],
  });

  const teams = await prisma.team.findMany({
    select: { id: true, name: true, crest: true, competitionId: true },
    orderBy: { name: "asc" },
  });

  const matches = await prisma.match.findMany({
    where: { utcDate: { gte: generatedAt } },
    select: {
      id: true,
      utcDate: true,
      stage: true,
      competitionId: true,
      homeTeamId: true,
      awayTeamId: true,
      competition: { select: { name: true } },
      homeTeam: { select: { name: true, crest: true } },
      awayTeam: { select: { name: true, crest: true } },
    },
    orderBy: { utcDate: "asc" },
    take: MAX_MATCHES,
  });

  const syncRuns = await prisma.syncRun.findMany({ select: { source: true, completedAt: true } });

  const matchViews: MatchView[] = matches.map((match) => ({
    id: match.id,
    utcDate: match.utcDate.toISOString(),
    stage: match.stage,
    competitionId: match.competitionId,
    competitionName: match.competition.name,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    homeName: match.homeTeam.name,
    homeCrest: match.homeTeam.crest,
    awayName: match.awayTeam.name,
    awayCrest: match.awayTeam.crest,
  }));

  return (
    <Dashboard
      competitions={competitions as CompetitionView[]}
      teams={teams as TeamView[]}
      matches={matchViews}
      timeZone={process.env.DISPLAY_TIME_ZONE ?? "Europe/Amsterdam"}
      syncRuns={syncRuns.map((run) => ({
        source: run.source,
        completedAt: run.completedAt.toISOString(),
      }))}
      generatedAt={generatedAt.toISOString()}
    />
  );
}
