import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

const API_URL = "https://v3.football.api-sports.io/fixtures";

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

type ApiResponse = { response: ApiFixture[] };

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

  const from = new Date();
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  const query = new URLSearchParams({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    timezone: "UTC",
  });

  const response = await fetch(`${API_URL}?${query}`, {
    headers: { "x-apisports-key": apiKey },
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "API-Football request failed", status: response.status },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as ApiResponse;
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
    ...payload.response.flatMap((item) => [
      prisma.team.upsert({
        where: { id: item.teams.home.id },
        create: item.teams.home,
        update: item.teams.home,
      }),
      prisma.team.upsert({
        where: { id: item.teams.away.id },
        create: item.teams.away,
        update: item.teams.away,
      }),
    ]),
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

  return NextResponse.json({ synced: payload.response.length });
}