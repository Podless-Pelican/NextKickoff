import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const syncRuns = await prisma.syncRun.findMany({ orderBy: { source: "asc" } });
  console.log("\n=== Sync runs ===");
  if (!syncRuns.length) console.log("(none - no import has completed)");
  for (const run of syncRuns) {
    console.log(
      `${run.source.padEnd(16)} ${run.completedAt.toISOString()}  matches=${run.matchCount} teams=${run.teamCount}`,
    );
  }

  const competitions = await prisma.competition.findMany({
    orderBy: [{ scope: "asc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      source: true,
      isSelected: true,
      _count: { select: { matches: true, teams: true } },
    },
  });

  console.log("\n=== Competitions ===");
  if (!competitions.length) console.log("(none)");
  for (const competition of competitions) {
    console.log(
      `${competition.code.padEnd(6)} ${competition.name.padEnd(32)} source=${competition.source.padEnd(14)} ` +
        `matches=${String(competition._count.matches).padStart(4)} clubs=${String(competition._count.teams).padStart(3)}` +
        `${competition.isSelected ? "  [selected]" : ""}`,
    );
  }

  const totalTeams = await prisma.team.count();
  const ungroupedTeams = await prisma.team.count({ where: { competitionId: null } });
  const totalMatches = await prisma.match.count();
  const upcomingMatches = await prisma.match.count({ where: { utcDate: { gte: new Date() } } });

  console.log("\n=== Totals ===");
  console.log(`teams=${totalTeams} (without domestic league: ${ungroupedTeams})`);
  console.log(`matches=${totalMatches} (upcoming: ${upcomingMatches})`);

  const next = await prisma.match.findMany({
    where: { utcDate: { gte: new Date() } },
    orderBy: { utcDate: "asc" },
    take: 10,
    select: {
      utcDate: true,
      source: true,
      stage: true,
      competition: { select: { code: true } },
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });

  console.log("\n=== Next 10 upcoming matches ===");
  if (!next.length) console.log("(none)");
  for (const match of next) {
    console.log(
      `${match.utcDate.toISOString().slice(0, 16)}  ${match.competition.code.padEnd(5)} ` +
        `${match.homeTeam.name} vs ${match.awayTeam.name}  [${match.source}${match.stage ? ` / ${match.stage}` : ""}]`,
    );
  }
  console.log("");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
