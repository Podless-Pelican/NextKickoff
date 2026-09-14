import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const competitions = [
  { url: "https://www.uefa.com/uefachampionsleague/fixtures-results/", fallbackId: 1, fallbackName: "UEFA Champions League" },
  { url: "https://www.uefa.com/uefaeuropaleague/fixtures-results/", fallbackId: 2, fallbackName: "UEFA Europa League" },
  { url: "https://www.uefa.com/uefaconferenceleague/fixtures-results/", fallbackId: 3, fallbackName: "UEFA Conference League" },
];

const prisma = new PrismaClient();

function pickName(team) {
  return team.translations?.displayName ?? team.translations?.internationalName ?? team.internationalName ?? team.name;
}

function pickCompetitionName(competition, fallbackName) {
  return competition?.translations?.name ?? competition?.name ?? fallbackName;
}

function pickKickoff(match) {
  return match.kickOffTime?.dateTime ?? match.kickOffTime?.date?.dateTime ?? match.kickOffTime?.date;
}

function matchStatus(match) {
  if (match.status?.cancelled) return "CANCELLED";
  if (match.status?.finished) return "FINISHED";
  if (match.status?.started) return "IN_PLAY";
  return "SCHEDULED";
}

async function scrapeCompetition(browser, competition) {
  const page = await browser.newPage();
  await page.goto(competition.url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.locator("pk-match-unit").first().waitFor({ timeout: 30_000 });
  const matches = await page.locator("pk-match-unit").evaluateAll((elements) => {
    const findMatchData = (element) => {
      const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber"));
      let fiber = fiberKey ? element[fiberKey] : null;
      while (fiber) {
        const matchData = fiber.memoizedProps?.matchData;
        if (matchData) return matchData;
        fiber = fiber.return;
      }
      return null;
    };
    return elements.map(findMatchData).filter(Boolean);
  });
  await page.close();
  return matches.map((match) => ({ match, competition }));
}

try {
  const browser = await chromium.launch({ headless: true });
  const scraped = (await Promise.all(competitions.map((competition) => scrapeCompetition(browser, competition)))).flat();
  await browser.close();

  const upcoming = scraped.filter(({ match }) => {
    const kickoff = pickKickoff(match);
    return kickoff && new Date(kickoff) >= new Date();
  });
  const leagues = new Map();
  const teams = new Map();
  for (const { match, competition: fallback } of upcoming) {
    const competition = match.competition ?? {};
    const leagueId = Number(competition.id ?? fallback.fallbackId);
    leagues.set(leagueId, { id: leagueId, name: pickCompetitionName(competition, fallback.fallbackName) });
    for (const team of [match.homeTeam, match.awayTeam]) {
      const id = Number(team?.id);
      const name = team && pickName(team);
      if (id && name) teams.set(id, { id, name, logo: team.logoUrl ?? null });
    }
  }

  await prisma.$transaction([
    ...[...leagues.values()].map((league) => prisma.league.upsert({
      where: { id: league.id },
      create: { ...league, country: "Europe" },
      update: { name: league.name, country: "Europe" },
    })),
    ...[...teams.values()].map((team) => prisma.team.upsert({ where: { id: team.id }, create: team, update: team })),
  ]);
  await prisma.$transaction([
    ...upcoming.map(({ match, competition: fallback }) => {
      const leagueId = Number(match.competition?.id ?? fallback.fallbackId);
      return prisma.fixture.upsert({
        where: { id: Number(match.id) },
        create: { id: Number(match.id), startsAt: new Date(pickKickoff(match)), status: matchStatus(match), leagueId, homeTeamId: Number(match.homeTeam.id), awayTeamId: Number(match.awayTeam.id) },
        update: { startsAt: new Date(pickKickoff(match)), status: matchStatus(match), leagueId, homeTeamId: Number(match.homeTeam.id), awayTeamId: Number(match.awayTeam.id) },
      });
    }),
    prisma.syncRun.upsert({
      where: { source: "uefa.com" },
      create: { source: "uefa.com", completedAt: new Date(), fixtureCount: upcoming.length },
      update: { completedAt: new Date(), fixtureCount: upcoming.length },
    }),
  ]);

  console.log(`Synced ${upcoming.length} upcoming UEFA fixtures and ${teams.size} teams.`);
} finally {
  await prisma.$disconnect();
}