import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const selectedCompetitions = await prisma.competition.findMany({
    where: { isSelected: true },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });
  const selectedTeams = await prisma.team.findMany({
    where: { isSelected: true },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });

  console.log("\n=== Selected competitions ===");
  for (const item of selectedCompetitions) console.log(`${item.code.padEnd(6)} ${item.name}`);
  if (!selectedCompetitions.length) console.log("(none)");

  console.log(`\n=== Selected clubs (${selectedTeams.length}) ===`);
  for (const team of selectedTeams) console.log(`${team.name.padEnd(30)} ${team.slug}`);
  if (!selectedTeams.length) console.log("(none)");

  const selectedTeamIds = selectedTeams.map((team) => team.id);

  console.log("\n=== Upcoming matches per selected competition ===");
  for (const competition of selectedCompetitions) {
    const total = await prisma.match.count({
      where: { competitionId: competition.id, utcDate: { gte: new Date() } },
    });
    const withTeams = selectedTeamIds.length
      ? await prisma.match.count({
          where: {
            competitionId: competition.id,
            utcDate: { gte: new Date() },
            OR: [
              { homeTeamId: { in: selectedTeamIds } },
              { awayTeamId: { in: selectedTeamIds } },
            ],
          },
        })
      : total;

    console.log(
      `${competition.code.padEnd(6)} upcoming=${String(total).padStart(4)}  matching your clubs=${withTeams}`,
    );
  }

  console.log("\n=== Sample upcoming fixtures in selected competitions ===");
  for (const competition of selectedCompetitions) {
    const sample = await prisma.match.findMany({
      where: { competitionId: competition.id, utcDate: { gte: new Date() } },
      orderBy: { utcDate: "asc" },
      take: 6,
      select: {
        utcDate: true,
        homeTeam: { select: { name: true, slug: true, isSelected: true, competitionId: true } },
        awayTeam: { select: { name: true, slug: true, isSelected: true, competitionId: true } },
      },
    });

    console.log(`\n-- ${competition.code} --`);
    if (!sample.length) console.log("(no upcoming fixtures stored)");
    for (const match of sample) {
      const mark = (team: { isSelected: boolean; competitionId: number | null }) =>
        `${team.isSelected ? "[picked]" : "[      ]"}${team.competitionId ? "" : "[no league]"}`;
      console.log(
        `${match.utcDate.toISOString().slice(0, 10)}  ` +
          `${mark(match.homeTeam)} ${match.homeTeam.slug.padEnd(24)} vs ` +
          `${mark(match.awayTeam)} ${match.awayTeam.slug}`,
      );
    }
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
