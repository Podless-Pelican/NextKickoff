import { NextResponse } from "next/server";
import { buildCalendar } from "@/lib/ics";
import { hasAnySelection, selectedMatchFilter } from "@/lib/matches";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MATCH_MINUTES = 115;

export async function GET() {
  const competitions = await prisma.competition.findMany({
    where: { isSelected: true },
    select: { id: true },
  });
  const teams = await prisma.team.findMany({ where: { isSelected: true }, select: { id: true } });

  const competitionIds = competitions.map((competition) => competition.id);
  const teamIds = teams.map((team) => team.id);

  const matches = hasAnySelection(competitionIds, teamIds)
    ? await prisma.match.findMany({
        where: selectedMatchFilter(competitionIds, teamIds),
        select: {
          id: true,
          utcDate: true,
          stage: true,
          competition: { select: { name: true } },
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } },
        },
        orderBy: { utcDate: "asc" },
        take: 500,
      })
    : [];

  const body = buildCalendar(
    matches.map((match) => ({
      uid: `match-${match.id}@next-kickoff`,
      start: match.utcDate,
      end: new Date(match.utcDate.getTime() + MATCH_MINUTES * 60_000),
      summary: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
      description: `${match.competition.name}${match.stage ? ` · ${match.stage}` : ""}`,
    })),
    "Next Kickoff",
  );

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="next-kickoff.ics"',
      "Cache-Control": "no-store",
    },
  });
}
