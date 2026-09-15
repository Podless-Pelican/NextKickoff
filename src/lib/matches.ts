import type { Prisma } from "@prisma/client";

/** Shared by the dashboard and the calendar feed so both show the same fixtures. */
export function selectedMatchFilter(
  competitionIds: number[],
  teamIds: number[],
): Prisma.MatchWhereInput {
  return {
    utcDate: { gte: new Date() },
    ...(competitionIds.length ? { competitionId: { in: competitionIds } } : {}),
    ...(teamIds.length
      ? { OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }] }
      : {}),
  };
}

export function hasAnySelection(competitionIds: number[], teamIds: number[]) {
  return competitionIds.length > 0 || teamIds.length > 0;
}
