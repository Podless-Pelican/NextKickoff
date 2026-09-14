import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

const API_URL = "https://v3.football.api-sports.io/fixtures";
const COMPETITIONS = [
  { id: 2, name: "UEFA Champions League", country: "Europe" },
  { id: 88, name: "Eredivisie", country: "Netherlands" },
] as const;

type ApiFixture = {
  fixture: { id: number; date: string; status: { short: string }; venue: { name: string | null } };
  league: { id: number; name: string; country: string | null; logo: string | null };
  teams: {
    home: { id: number; name: string; logo: string | null };
    away: { id: number; name: string; logo: string | null };
  };
};
type ApiResponse = { response: ApiFixture[]; errors?: Record<string, string> };

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

function dateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) return NextResponse.json({ error: "API_FOOTBALL_KEY is not configured" }, { status: 500 });

  const lookaheadDays = Number(process.env.FIXTURE_LOOKAHEAD_DAYS ?? 30);
  if (!Number.isInteger(lookaheadDays) || lookaheadDays < 1 || lookaheadDays > 365) {
    return NextResponse.json({ error: "FIXTURE_LOOKAHEAD_DAYS must be an integer between 1 and 365" }, { status: 500 });
  }

  const season = process.env.FOOTBALL_SEASON ?? String(new Date().getUTCFullYear());
  const from = new Date();
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + lookaheadDays);
  const headers = { "x-apisports-key": apiKey };
  const payloads: ApiResponse[] = [];

  for (const competition of COMPETITIONS) {
    const query = new URLSearchParams({
      league: String(competition.id),
      season,
      from: dateString(from),
      to: dateString(to),
      timezone: "UTC",
    });
    const response = await fetch(`${API_URL}?${query}`, { headers, cache: "no-store" });
    if (!response.ok) {
      return NextResponse.json(
        { error: "API-Football request failed", competition: competition.name, status: response.status },
        { status: 502 },
      );
    }
    const payload = (await response.json()) as ApiResponse;
    const apiError = Object.values(payload.errors ?? {})[0];
    if (apiError) {
      return NextResponse.json(
        { error: "API-Football returned an error", competition: competition.name, detail: apiError },
        { status: 502 },
      );
    }
    payloads.push(payload);
  }

  const fixtures = payloads.flatMap((payload) => payload.response);
  const teams = new Map<number, { id: number; name: string; logo: string | null }>();
  for (const fixture of fixtures) {
    teams.set(fixture.teams.home.id, fixture.teams.home);
    teams.set(fixture.teams.away.id, fixture.teams.away);
  }

  await prisma.$transaction([
    ...COMPETITIONS.map((competition) => prisma.league.upsert({
      where: { id: competition.id },
      create: { id: competition.id, name: competition.name, country: competition.country },
      update: { name: competition.name, country: competition.country },
    })),
    ...[...teams.values()].map((team) => prisma.team.upsert({ where: { id: team.id }, create: team, update: team })),
  ]);
  await prisma.$transaction([
    ...fixtures.map((fixture) => prisma.fixture.upsert({
      where: { id: fixture.fixture.id },
      create: { id: fixture.fixture.id, startsAt: new Date(fixture.fixture.date), status: fixture.fixture.status.short, venue: fixture.fixture.venue.name, leagueId: fixture.league.id, homeTeamId: fixture.teams.home.id, awayTeamId: fixture.teams.away.id },
      update: { startsAt: new Date(fixture.fixture.date), status: fixture.fixture.status.short, venue: fixture.fixture.venue.name, leagueId: fixture.league.id, homeTeamId: fixture.teams.home.id, awayTeamId: fixture.teams.away.id },
    })),
    prisma.syncRun.upsert({
      where: { source: "api-football" },
      create: { source: "api-football", completedAt: new Date(), fixtureCount: fixtures.length },
      update: { completedAt: new Date(), fixtureCount: fixtures.length },
    }),
  ]);

  return NextResponse.json({ synced: fixtures.length, teamsSynced: teams.size, leaguesSynced: COMPETITIONS.length, season, lookaheadDays, source: "API-Football" });
}