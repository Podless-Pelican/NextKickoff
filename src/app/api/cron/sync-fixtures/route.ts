import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

const API_URL = "https://api.football-data.org/v4";
const EREDIVISIE_CODE = "DED";
const EREDIVISIE_ID = 2003;

type FootballDataTeam = { id: number; name: string; crest: string | null };
type FootballDataTeamsResponse = { teams: FootballDataTeam[] };
type FootballDataMatch = {
  id: number;
  utcDate: string;
  status: string;
  venue: string | null;
  competition: { id: number; name: string; area: { name: string } | null };
  homeTeam: FootballDataTeam;
  awayTeam: FootballDataTeam;
};
type FootballDataMatchesResponse = { matches: FootballDataMatch[] };

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

function dateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.FOOTBALL_DATA_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "FOOTBALL_DATA_API_TOKEN is not configured" }, { status: 500 });
  }

  const from = new Date();
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  const headers = { "X-Auth-Token": token };
  const matchesQuery = new URLSearchParams({ dateFrom: dateString(from), dateTo: dateString(to) });
  const [teamsResponse, matchesResponse] = await Promise.all([
    fetch(`${API_URL}/competitions/${EREDIVISIE_CODE}/teams`, { headers, cache: "no-store" }),
    fetch(`${API_URL}/competitions/${EREDIVISIE_CODE}/matches?${matchesQuery}`, {
      headers,
      cache: "no-store",
    }),
  ]);

  if (!teamsResponse.ok || !matchesResponse.ok) {
    return NextResponse.json(
      { error: "football-data.org request failed", teamStatus: teamsResponse.status, matchStatus: matchesResponse.status },
      { status: 502 },
    );
  }

  const [teamsPayload, matchesPayload] = await Promise.all([
    teamsResponse.json() as Promise<FootballDataTeamsResponse>,
    matchesResponse.json() as Promise<FootballDataMatchesResponse>,
  ]);
  const teams = new Map<number, FootballDataTeam>();
  for (const team of teamsPayload.teams) teams.set(team.id, team);
  for (const match of matchesPayload.matches) {
    teams.set(match.homeTeam.id, match.homeTeam);
    teams.set(match.awayTeam.id, match.awayTeam);
  }
  const competition = matchesPayload.matches[0]?.competition;
  const leagueId = competition?.id ?? EREDIVISIE_ID;

  await prisma.$transaction([
    prisma.league.upsert({
      where: { id: leagueId },
      create: { id: leagueId, name: competition?.name ?? "Eredivisie", country: competition?.area?.name ?? "Netherlands" },
      update: { name: competition?.name ?? "Eredivisie", country: competition?.area?.name ?? "Netherlands" },
    }),
    ...[...teams.values()].map((team) =>
      prisma.team.upsert({
        where: { id: team.id },
        create: { id: team.id, name: team.name, logo: team.crest },
        update: { name: team.name, logo: team.crest },
      }),
    ),
  ]);

  await prisma.$transaction([
    ...matchesPayload.matches.map((match) =>
      prisma.fixture.upsert({
        where: { id: match.id },
        create: { id: match.id, startsAt: new Date(match.utcDate), status: match.status, venue: match.venue, leagueId: match.competition.id, homeTeamId: match.homeTeam.id, awayTeamId: match.awayTeam.id },
        update: { startsAt: new Date(match.utcDate), status: match.status, venue: match.venue, leagueId: match.competition.id, homeTeamId: match.homeTeam.id, awayTeamId: match.awayTeam.id },
      }),
    ),
    prisma.syncRun.upsert({
      where: { source: "football-data.org" },
      create: { source: "football-data.org", completedAt: new Date(), fixtureCount: matchesPayload.matches.length },
      update: { completedAt: new Date(), fixtureCount: matchesPayload.matches.length },
    }),
  ]);

  return NextResponse.json({ synced: matchesPayload.matches.length, teamsSynced: teams.size, league: "Eredivisie", source: "football-data.org" });
}