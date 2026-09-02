import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

const API_URL = "https://free-api-live-football-data.p.rapidapi.com";
const UEFA_LEAGUES = [
  { id: 42, name: "Champions League" },
  { id: 73, name: "Europa League" },
  { id: 10216, name: "Conference League" },
] as const;

type ProviderTeam = { id: number; name: string; longName?: string };
type ProviderMatch = {
  id: number;
  leagueId: number;
  home: ProviderTeam;
  away: ProviderTeam;
  status: { utcTime?: string; started: boolean; finished: boolean; cancelled: boolean };
};
type ProviderResponse = { status: string; response: { matches: ProviderMatch[] }; message?: string };

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

function matchStatus(match: ProviderMatch) {
  if (match.status.cancelled) return "CANCELLED";
  if (match.status.finished) return "FINISHED";
  if (match.status.started) return "IN_PLAY";
  return "SCHEDULED";
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rapidApiKey = process.env.RAPIDAPI_KEY;
  if (!rapidApiKey) return NextResponse.json({ error: "RAPIDAPI_KEY is not configured" }, { status: 500 });

  const lookaheadDays = Number(process.env.FIXTURE_LOOKAHEAD_DAYS ?? 90);
  if (!Number.isInteger(lookaheadDays) || lookaheadDays < 1 || lookaheadDays > 365) {
    return NextResponse.json(
      { error: "FIXTURE_LOOKAHEAD_DAYS must be an integer between 1 and 365" },
      { status: 500 },
    );
  }

  const headers = {
    "x-rapidapi-key": rapidApiKey,
    "x-rapidapi-host": process.env.RAPIDAPI_HOST ?? "free-api-live-football-data.p.rapidapi.com",
  };
  const schedules: Array<{ league: (typeof UEFA_LEAGUES)[number]; matches: ProviderMatch[] }> = [];
  for (const league of UEFA_LEAGUES) {
    const response = await fetch(`${API_URL}/football-get-all-matches-by-league?leagueid=${league.id}`, {
      headers,
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: "Free API Live Football Data request failed", league: league.name, status: response.status },
        { status: response.status === 429 ? 429 : 502 },
      );
    }
    const payload = (await response.json()) as ProviderResponse;
    if (payload.status !== "success") {
      return NextResponse.json({ error: "Football provider returned an error", league: league.name, detail: payload.message ?? payload.status }, { status: 502 });
    }
    schedules.push({ league, matches: payload.response.matches });
  }

  const now = new Date();
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + lookaheadDays);
  const fixtures = schedules.flatMap(({ league, matches }) => matches
    .filter((match) => {
      const startsAt = new Date(match.status.utcTime ?? 0);
      return startsAt >= now && startsAt <= end;
    })
    .map((match) => ({ league, match })));
  const teams = new Map<number, ProviderTeam>();
  for (const { match } of fixtures) {
    teams.set(match.home.id, match.home);
    teams.set(match.away.id, match.away);
  }
  await prisma.$transaction([
    ...UEFA_LEAGUES.map((league) => prisma.league.upsert({
      where: { id: league.id },
      create: { id: league.id, name: league.name, country: "Europe" },
      update: { name: league.name, country: "Europe" },
    })),
    ...[...teams.values()].map((team) => prisma.team.upsert({
      where: { id: team.id },
      create: { id: team.id, name: team.longName ?? team.name },
      update: { name: team.longName ?? team.name },
    })),
  ]);
  await prisma.$transaction([
    ...fixtures.map(({ league, match }) => prisma.fixture.upsert({
      where: { id: match.id },
      create: { id: match.id, startsAt: new Date(match.status.utcTime ?? 0), status: matchStatus(match), leagueId: league.id, homeTeamId: match.home.id, awayTeamId: match.away.id },
      update: { startsAt: new Date(match.status.utcTime ?? 0), status: matchStatus(match), leagueId: league.id, homeTeamId: match.home.id, awayTeamId: match.away.id },
    })),
    prisma.syncRun.upsert({
      where: { source: "free-api-live-football-data:uefa" },
      create: { source: "free-api-live-football-data:uefa", completedAt: new Date(), fixtureCount: fixtures.length },
      update: { completedAt: new Date(), fixtureCount: fixtures.length },
    }),
  ]);

  return NextResponse.json({ synced: fixtures.length, teamsSynced: teams.size, leaguesSynced: UEFA_LEAGUES.length, lookaheadDays, source: "Free API Live Football Data" });
}