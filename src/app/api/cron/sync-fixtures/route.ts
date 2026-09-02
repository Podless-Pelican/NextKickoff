import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

const API_URL = "https://v3.football.api-sports.io";
const EREDIVISIE_LEAGUE_ID = "88";

type ApiFixture = {
  fixture: {
    id: number;
    date: string;
    status: { short: string };
    venue: { name: string | null };
  };
  league: { id: number; name: string; country: string | null; logo: string | null };
  teams: {
    home: { id: number; name: string; logo: string | null };
    away: { id: number; name: string; logo: string | null };
  };
};

type ApiResponse = {
  response: ApiFixture[];
  results?: number;
  errors?: Record<string, string>;
};

type ApiTeamResponse = {
  response: Array<{ team: { id: number; name: string; logo: string | null } }>;
  results?: number;
  errors?: Record<string, string>;
};

type ApiLeagueResponse = {
  response: Array<{
    seasons: Array<{ year: number; current: boolean }>;
  }>;
};

type ApiStandingsResponse = {
  response: Array<{
    league: {
      standings: Array<Array<{ team: { id: number; name: string; logo: string | null } }>>;
    };
  }>;
};

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API_FOOTBALL_KEY is not configured" }, { status: 500 });
  }

  const headers = { "x-apisports-key": apiKey };
  const leagueResponse = await fetch(`${API_URL}/leagues?id=${EREDIVISIE_LEAGUE_ID}`, {
    headers,
    cache: "no-store",
  });

  if (!leagueResponse.ok) {
    return NextResponse.json(
      { error: "API-Football league request failed", status: leagueResponse.status },
      { status: 502 },
    );
  }

  const leaguePayload = (await leagueResponse.json()) as ApiLeagueResponse;
  const currentSeason = leaguePayload.response[0]?.seasons.find((item) => item.current)?.year;
  const season = process.env.EREDIVISIE_SEASON ?? String(currentSeason ?? new Date().getUTCFullYear());
  const from = new Date();
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  const fixtureQuery = new URLSearchParams({
    league: EREDIVISIE_LEAGUE_ID,
    season,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    timezone: "UTC",
  });

  const [fixturesResponse, currentTeamsResponse] = await Promise.all([
    fetch(`${API_URL}/fixtures?${fixtureQuery}`, { headers, cache: "no-store" }),
    fetch(
      `${API_URL}/teams?${new URLSearchParams({ league: EREDIVISIE_LEAGUE_ID, season })}`,
      { headers, cache: "no-store" },
    ),
  ]);

  if (!fixturesResponse.ok || !currentTeamsResponse.ok) {
    return NextResponse.json(
      {
        error: "API-Football request failed",
        fixtureStatus: fixturesResponse.status,
        teamStatus: currentTeamsResponse.status,
      },
      { status: 502 },
    );
  }

  const [payload, currentTeamsPayload] = await Promise.all([
    fixturesResponse.json() as Promise<ApiResponse>,
    currentTeamsResponse.json() as Promise<ApiTeamResponse>,
  ]);
  let teamsPayload = currentTeamsPayload;
  let teamsSeason = season;

  if (teamsPayload.response.length === 0 && !process.env.EREDIVISIE_SEASON) {
    const fallbackSeason = String(Number(season) - 1);
    const fallbackResponse = await fetch(
      `${API_URL}/teams?${new URLSearchParams({ league: EREDIVISIE_LEAGUE_ID, season: fallbackSeason })}`,
      { headers, cache: "no-store" },
    );

    if (fallbackResponse.ok) {
      const fallbackPayload = (await fallbackResponse.json()) as ApiTeamResponse;
      if (fallbackPayload.response.length > 0) {
        teamsPayload = fallbackPayload;
        teamsSeason = fallbackSeason;
      }
    }
  }

  if (teamsPayload.response.length === 0) {
    const standingsResponse = await fetch(
      `${API_URL}/standings?${new URLSearchParams({ league: EREDIVISIE_LEAGUE_ID, season })}`,
      { headers, cache: "no-store" },
    );

    if (standingsResponse.ok) {
      const standingsPayload = (await standingsResponse.json()) as ApiStandingsResponse;
      const standingsTeams = standingsPayload.response[0]?.league.standings.flatMap((group) =>
        group.map(({ team }) => ({ team })),
      ) ?? [];

      if (standingsTeams.length > 0) {
        teamsPayload = { response: standingsTeams };
      }
    }
  }

  await prisma.$transaction([
    ...payload.response.map((item) =>
      prisma.league.upsert({
        where: { id: item.league.id },
        create: {
          id: item.league.id,
          name: item.league.name,
          country: item.league.country,
          logo: item.league.logo,
        },
        update: {
          name: item.league.name,
          country: item.league.country,
          logo: item.league.logo,
        },
      }),
    ),
    ...teamsPayload.response.map(({ team }) =>
      prisma.team.upsert({ where: { id: team.id }, create: team, update: team }),
    ),
  ]);

  await prisma.$transaction([
    ...payload.response.map((item) =>
      prisma.fixture.upsert({
        where: { id: item.fixture.id },
        create: {
          id: item.fixture.id,
          startsAt: new Date(item.fixture.date),
          status: item.fixture.status.short,
          venue: item.fixture.venue.name,
          leagueId: item.league.id,
          homeTeamId: item.teams.home.id,
          awayTeamId: item.teams.away.id,
        },
        update: {
          startsAt: new Date(item.fixture.date),
          status: item.fixture.status.short,
          venue: item.fixture.venue.name,
          leagueId: item.league.id,
          homeTeamId: item.teams.home.id,
          awayTeamId: item.teams.away.id,
        },
      }),
    ),
    prisma.syncRun.upsert({
      where: { source: "api-football" },
      create: { source: "api-football", completedAt: new Date(), fixtureCount: payload.response.length },
      update: { completedAt: new Date(), fixtureCount: payload.response.length },
    }),
  ]);

  return NextResponse.json({
    synced: payload.response.length,
    teamsSynced: teamsPayload.response.length,
    teamsSeason,
    league: "Eredivisie",
    season,
    apiErrors: {
      fixtures: payload.errors ?? {},
      teams: teamsPayload.errors ?? {},
    },
  });
}