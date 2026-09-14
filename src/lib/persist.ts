import { prisma } from "./prisma";
import { teamSlugCandidates } from "./slug";
import type { CompetitionSeed } from "./competitions";

export type TeamInput = {
  /** Slug variants for this club, most specific first. */
  candidates: string[];
  name: string;
  shortName?: string | null;
  tla?: string | null;
  crest?: string | null;
  /** Set when the club was seen in one of its domestic league fixtures. */
  domesticCompetitionCode?: string | null;
};

export type MatchInput = {
  externalId: string;
  utcDate: Date;
  status: string;
  stage?: string | null;
  matchday?: number | null;
  competitionCode: string;
  homeTeam: TeamInput;
  awayTeam: TeamInput;
};

export function buildTeamInput(options: {
  names: Array<string | null | undefined>;
  name: string;
  shortName?: string | null;
  tla?: string | null;
  crest?: string | null;
  domesticCompetitionCode?: string | null;
}): TeamInput | null {
  const candidates = teamSlugCandidates(...options.names);
  if (!candidates.length) return null;

  return {
    candidates,
    name: options.name,
    shortName: options.shortName ?? null,
    tla: options.tla ?? null,
    crest: options.crest ?? null,
    domesticCompetitionCode: options.domesticCompetitionCode ?? null,
  };
}

async function chunked<T>(items: T[], size: number, run: (chunk: T[]) => Promise<unknown>) {
  for (let index = 0; index < items.length; index += size) {
    await run(items.slice(index, index + size));
  }
}

export async function upsertCompetitions(
  source: string,
  seeds: Array<CompetitionSeed & { emblem?: string | null }>,
) {
  await prisma.$transaction(
    seeds.map((seed) =>
      prisma.competition.upsert({
        where: { code: seed.code },
        create: {
          source,
          externalId: seed.externalId,
          code: seed.code,
          name: seed.name,
          area: seed.area,
          type: seed.type,
          scope: seed.scope,
          emblem: seed.emblem ?? null,
        },
        update: {
          source,
          externalId: seed.externalId,
          name: seed.name,
          area: seed.area,
          type: seed.type,
          scope: seed.scope,
          ...(seed.emblem ? { emblem: seed.emblem } : {}),
        },
      }),
    ),
  );
}

/**
 * Resolves every club to a database row, reusing an existing club when any of its
 * slug variants already exists so the same team from two sources stays one record.
 */
async function resolveTeamIds(teams: TeamInput[]) {
  const allCandidates = [...new Set(teams.flatMap((team) => team.candidates))];
  const existing = await prisma.team.findMany({
    where: { OR: [{ slug: { in: allCandidates } }, { aliases: { hasSome: allCandidates } }] },
    select: { id: true, slug: true, aliases: true },
  });

  // Every known name variant points at the club's canonical slug.
  const keyByCandidate = new Map<string, string>();
  const aliasesByKey = new Map<string, Set<string>>();
  for (const team of existing) {
    const known = new Set([team.slug, ...team.aliases]);
    aliasesByKey.set(team.slug, known);
    for (const value of known) keyByCandidate.set(value, team.slug);
  }

  const competitionIdByCode = new Map(
    (
      await prisma.competition.findMany({ select: { id: true, code: true } })
    ).map((competition) => [competition.code, competition.id]),
  );

  // Sources can name the same club very differently ("AZ" vs "AZ Alkmaar") while both
  // publish the same team code, so that is used as a second link.
  const codes = [...new Set(teams.map((team) => team.tla).filter((tla): tla is string => Boolean(tla)))];
  const byCode = new Map<string, Array<{ slug: string; aliases: string[] }>>();
  if (codes.length) {
    const coded = await prisma.team.findMany({
      where: { tla: { in: codes } },
      select: { slug: true, aliases: true, tla: true },
    });
    for (const team of coded) {
      if (!team.tla) continue;
      byCode.set(team.tla, [...(byCode.get(team.tla) ?? []), { slug: team.slug, aliases: team.aliases }]);
    }
  }

  const resolved = new Map<string, TeamInput & { slug: string; aliases: Set<string> }>();
  for (const team of teams) {
    let matched = team.candidates.map((candidate) => keyByCandidate.get(candidate)).find(Boolean);

    if (!matched && team.tla) {
      // Require a shared word so two unrelated clubs sharing a code never merge.
      const tokens = new Set(team.candidates.flatMap((candidate) => candidate.split("-")));
      const linked = (byCode.get(team.tla) ?? []).find((candidate) =>
        [candidate.slug, ...candidate.aliases].some((value) =>
          value.split("-").some((token) => tokens.has(token)),
        ),
      );
      if (linked) {
        matched = linked.slug;
        aliasesByKey.set(linked.slug, new Set([linked.slug, ...linked.aliases]));
      }
    }

    const slug = matched ?? team.candidates[0];
    const previous = resolved.get(slug);
    const aliases = new Set([
      ...(aliasesByKey.get(slug) ?? []),
      ...(previous?.aliases ?? []),
      ...team.candidates,
      slug,
    ]);
    for (const candidate of aliases) keyByCandidate.set(candidate, slug);

    resolved.set(slug, {
      ...team,
      slug,
      aliases,
      // keep a domestic league once we have seen one for this club
      domesticCompetitionCode: team.domesticCompetitionCode ?? previous?.domesticCompetitionCode ?? null,
    });
  }

  const rows = [...resolved.values()];
  await chunked(rows, 50, (chunk) =>
    prisma.$transaction(
      chunk.map((team) => {
        const competitionId = team.domesticCompetitionCode
          ? competitionIdByCode.get(team.domesticCompetitionCode) ?? null
          : null;

        return prisma.team.upsert({
          where: { slug: team.slug },
          create: {
            slug: team.slug,
            aliases: [...team.aliases],
            name: team.name,
            shortName: team.shortName,
            tla: team.tla,
            crest: team.crest,
            competitionId,
          },
          update: {
            name: team.name,
            aliases: { set: [...team.aliases] },
            ...(team.shortName ? { shortName: team.shortName } : {}),
            ...(team.tla ? { tla: team.tla } : {}),
            ...(team.crest ? { crest: team.crest } : {}),
            ...(competitionId ? { competitionId } : {}),
          },
        });
      }),
    ),
  );

  const stored = await prisma.team.findMany({
    where: { slug: { in: rows.map((team) => team.slug) } },
    select: { id: true, slug: true },
  });

  return {
    teamIdBySlug: new Map(stored.map((team) => [team.slug, team.id])),
    resolvedSlugFor: (team: TeamInput) =>
      team.candidates.map((candidate) => keyByCandidate.get(candidate)).find(Boolean) ??
      team.candidates[0],
    teamCount: rows.length,
  };
}

export async function persistMatches(source: string, matches: MatchInput[]) {
  const competitions = await prisma.competition.findMany({ select: { id: true, code: true } });
  const competitionIdByCode = new Map(competitions.map((competition) => [competition.code, competition.id]));

  const usable = matches.filter((match) => competitionIdByCode.has(match.competitionCode));
  const { teamIdBySlug, resolvedSlugFor, teamCount } = await resolveTeamIds(
    usable.flatMap((match) => [match.homeTeam, match.awayTeam]),
  );

  const rows = usable
    .map((match) => {
      const homeTeamId = teamIdBySlug.get(resolvedSlugFor(match.homeTeam));
      const awayTeamId = teamIdBySlug.get(resolvedSlugFor(match.awayTeam));
      const competitionId = competitionIdByCode.get(match.competitionCode);
      if (!homeTeamId || !awayTeamId || !competitionId || homeTeamId === awayTeamId) return null;

      return {
        source,
        externalId: match.externalId,
        utcDate: match.utcDate,
        status: match.status,
        stage: match.stage ?? null,
        matchday: match.matchday ?? null,
        competitionId,
        homeTeamId,
        awayTeamId,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  await chunked(rows, 50, (chunk) =>
    prisma.$transaction(
      chunk.map((row) =>
        prisma.match.upsert({
          where: { source_externalId: { source: row.source, externalId: row.externalId } },
          create: row,
          update: {
            utcDate: row.utcDate,
            status: row.status,
            stage: row.stage,
            matchday: row.matchday,
            competitionId: row.competitionId,
            homeTeamId: row.homeTeamId,
            awayTeamId: row.awayTeamId,
          },
        }),
      ),
    ),
  );

  await prisma.syncRun.upsert({
    where: { source },
    create: { source, completedAt: new Date(), matchCount: rows.length, teamCount },
    update: { completedAt: new Date(), matchCount: rows.length, teamCount },
  });

  return { matchCount: rows.length, teamCount };
}
