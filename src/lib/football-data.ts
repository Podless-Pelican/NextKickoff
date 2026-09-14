import { DOMESTIC_LEAGUE_CODES, FOOTBALL_DATA_COMPETITIONS } from "./competitions";
import { buildTeamInput, persistMatches, upsertCompetitions, type MatchInput } from "./persist";

const API_BASE = "https://api.football-data.org/v4";
export const FOOTBALL_DATA_SOURCE = "football-data";

/** Free tier allows 10 requests per minute. */
const THROTTLE_MS = 6_500;

type ApiTeam = {
  id: number | null;
  name: string | null;
  shortName: string | null;
  tla: string | null;
  crest: string | null;
};

type ApiMatch = {
  id: number;
  utcDate: string;
  status: string;
  matchday: number | null;
  stage: string | null;
  competition: { id: number; code: string; name: string; emblem: string | null };
  homeTeam: ApiTeam;
  awayTeam: ApiTeam;
};

export class FootballDataError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path: string, token: string) {
  return fetch(`${API_BASE}${path}`, {
    headers: { "X-Auth-Token": token },
    cache: "no-store",
  });
}

/**
 * Prefers a single request for every competition and falls back to one throttled
 * request per competition when the bulk filter is rejected.
 */
async function fetchMatches(token: string, from: Date, to: Date) {
  const range = `dateFrom=${isoDate(from)}&dateTo=${isoDate(to)}`;
  const codes = FOOTBALL_DATA_COMPETITIONS.map((competition) => competition.code).join(",");

  const bulk = await request(`/matches?${range}&competitions=${codes}`, token);
  if (bulk.ok) {
    const payload = (await bulk.json()) as { matches?: ApiMatch[] };
    return { matches: payload.matches ?? [], requests: 1, mode: "bulk" as const };
  }

  if (bulk.status === 429) {
    throw new FootballDataError("football-data.org rate limit reached", 429);
  }

  const matches: ApiMatch[] = [];
  let requests = 1;

  for (const [index, competition] of FOOTBALL_DATA_COMPETITIONS.entries()) {
    if (index > 0) await sleep(THROTTLE_MS);
    const response = await request(`/competitions/${competition.code}/matches?${range}`, token);
    requests += 1;

    if (response.status === 429) {
      throw new FootballDataError("football-data.org rate limit reached", 429);
    }
    // A competition can be out of season or unavailable; keep importing the rest.
    if (!response.ok) continue;

    const payload = (await response.json()) as { matches?: ApiMatch[] };
    matches.push(...(payload.matches ?? []));
  }

  return { matches, requests, mode: "per-competition" as const };
}

function toMatchInput(match: ApiMatch): MatchInput | null {
  const code = match.competition?.code;
  if (!code || !match.utcDate) return null;

  const domesticCompetitionCode = DOMESTIC_LEAGUE_CODES.has(code) ? code : null;
  const homeTeam = match.homeTeam?.name
    ? buildTeamInput({
        names: [match.homeTeam.name, match.homeTeam.shortName],
        name: match.homeTeam.name,
        shortName: match.homeTeam.shortName,
        tla: match.homeTeam.tla,
        crest: match.homeTeam.crest,
        domesticCompetitionCode,
      })
    : null;
  const awayTeam = match.awayTeam?.name
    ? buildTeamInput({
        names: [match.awayTeam.name, match.awayTeam.shortName],
        name: match.awayTeam.name,
        shortName: match.awayTeam.shortName,
        tla: match.awayTeam.tla,
        crest: match.awayTeam.crest,
        domesticCompetitionCode,
      })
    : null;

  // Knockout fixtures without a drawn opponent yet are skipped until teams are known.
  if (!homeTeam || !awayTeam) return null;

  return {
    externalId: String(match.id),
    utcDate: new Date(match.utcDate),
    status: match.status,
    stage: match.stage,
    matchday: match.matchday,
    competitionCode: code,
    homeTeam,
    awayTeam,
  };
}

export async function syncFootballData(options: { daysAhead?: number } = {}) {
  const token = process.env.FOOTBALL_DATA_API_TOKEN;
  if (!token) throw new FootballDataError("FOOTBALL_DATA_API_TOKEN is not configured", 500);

  const requested = Number(options.daysAhead ?? process.env.FIXTURE_LOOKAHEAD_DAYS ?? 60);
  if (!Number.isInteger(requested) || requested < 1 || requested > 365) {
    throw new FootballDataError("FIXTURE_LOOKAHEAD_DAYS must be an integer between 1 and 365", 500);
  }

  const from = new Date();
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + requested + 1);

  await upsertCompetitions(FOOTBALL_DATA_SOURCE, FOOTBALL_DATA_COMPETITIONS);

  const { matches, requests, mode } = await fetchMatches(token, from, to);
  const inputs = matches
    .map(toMatchInput)
    .filter((match): match is MatchInput => match !== null);

  const { matchCount, teamCount } = await persistMatches(FOOTBALL_DATA_SOURCE, inputs);

  return {
    source: FOOTBALL_DATA_SOURCE,
    competitions: FOOTBALL_DATA_COMPETITIONS.length,
    received: matches.length,
    matchCount,
    teamCount,
    daysAhead: requested,
    apiRequests: requests,
    mode,
  };
}
