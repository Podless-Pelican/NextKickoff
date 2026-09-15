export type SelectableMatch = {
  competitionId: number;
  homeTeamId: number;
  awayTeamId: number;
  utcDate: string;
};

export function hasAnySelection(competitionIds: number[], teamIds: number[]) {
  return competitionIds.length > 0 || teamIds.length > 0;
}

/** Shared by the fixture list and the calendar download so the two cannot drift apart. */
export function filterMatches<T extends SelectableMatch>(
  matches: T[],
  competitionIds: number[],
  teamIds: number[],
  from: Date,
): T[] {
  const competitions = new Set(competitionIds);
  const teams = new Set(teamIds);
  const cutoff = from.getTime();

  return matches.filter((match) => {
    if (new Date(match.utcDate).getTime() < cutoff) return false;
    if (competitions.size && !competitions.has(match.competitionId)) return false;
    if (teams.size && !teams.has(match.homeTeamId) && !teams.has(match.awayTeamId)) return false;
    return true;
  });
}
