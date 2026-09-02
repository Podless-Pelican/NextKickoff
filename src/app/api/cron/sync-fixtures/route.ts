import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

const API_URL = "https://api.football-data.org/v4";
const COMPETITIONS = [
  { code: "CL", id: 2001, name: "UEFA Champions League" },
  { code: "DED", id: 2146, name: "Eredivisie" },
] as const;

type Team = { id: number; name: string; crest: string | null };
type Match = { id: number; utcDate: string; status: string; venue: string | null; competition: { id: number; name: string }; homeTeam: Team; awayTeam: Team };
type TeamsResponse = { teams: Team[] };
type MatchesResponse = { matches: Match[] };

function isAuthorized(request: NextRequest) {
  return process.env.CRON_SECRET && request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

function dateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.FOOTBALL_DATA_API_TOKEN;
  if (!token) return NextResponse.json({ error: "FOOTBALL_DATA_API_TOKEN is not configured" }, { status: 500 });

  const from = new Date();
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  const headers = { "X-Auth-Token": token };
  const matchQuery = new URLSearchParams({ dateFrom: dateString(from), dateTo: dateString(to) });
  const responses = await Promise.all(COMPETITIONS.flatMap(({ code }) => [
    fetch(`${API_URL}/competitions/${code}/teams`, { headers, cache: "no-store" }),
    fetch(`${API_URL}/competitions/${code}/matches?${matchQuery}`, { headers, cache: "no-store" }),
  ]));
  const failed = responses.find((response) => !response.ok);
  if (failed) return NextResponse.json({ error: "football-data.org request failed", status: failed.status }, { status: 502 });

  const results = await Promise.all(COMPETITIONS.map(async (competition, index) => ({
    competition,
    teams: ((await responses[index * 2].json()) as TeamsResponse).teams,
    matches: ((await responses[index * 2 + 1].json()) as MatchesResponse).matches,
  })));
  const teams = new Map<number, Team>();
  for (const result of results) {
    for (const team of result.teams) teams.set(team.id, team);
    for (const match of result.matches) {
      teams.set(match.homeTeam.id, match.homeTeam);
      teams.set(match.awayTeam.id, match.awayTeam);
    }
  }
  const matches = results.flatMap((result) => result.matches);

  await prisma.$transaction([
    ...results.map(({ competition, matches: competitionMatches }) => {
      const apiCompetition = competitionMatches[0]?.competition;
      const id = apiCompetition?.id ?? competition.id;
      const name = apiCompetition?.name ?? competition.name;
      return prisma.league.upsert({ where: { id }, create: { id, name, country: "Europe" }, update: { name, country: "Europe" } });
    }),
    ...[...teams.values()].map((team) => prisma.team.upsert({ where: { id: team.id }, create: { id: team.id, name: team.name, logo: team.crest }, update: { name: team.name, logo: team.crest } })),
  ]);
  await prisma.$transaction([
    ...matches.map((match) => prisma.fixture.upsert({
      where: { id: match.id },
      create: { id: match.id, startsAt: new Date(match.utcDate), status: match.status, venue: match.venue, leagueId: match.competition.id, homeTeamId: match.homeTeam.id, awayTeamId: match.awayTeam.id },
      update: { startsAt: new Date(match.utcDate), status: match.status, venue: match.venue, leagueId: match.competition.id, homeTeamId: match.homeTeam.id, awayTeamId: match.awayTeam.id },
    })),
    prisma.syncRun.upsert({ where: { source: "football-data.org:uefa" }, create: { source: "football-data.org:uefa", completedAt: new Date(), fixtureCount: matches.length }, update: { completedAt: new Date(), fixtureCount: matches.length } }),
  ]);

  return NextResponse.json({ synced: matches.length, teamsSynced: teams.size, leaguesSynced: results.length, source: "football-data.org" });
}