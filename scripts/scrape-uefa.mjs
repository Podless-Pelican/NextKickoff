import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const competitions = [
  { url: "https://www.uefa.com/uefaeuropaleague/fixtures-results/", fallbackId: 73, name: "UEFA Europa League" },
  { url: "https://www.uefa.com/uefaconferenceleague/fixtures-results/", fallbackId: 10216, name: "UEFA Conference League" },
];

const prisma = new PrismaClient();

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
  const dateButtons = page.locator("button").filter({ hasText: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} \w{3}$/ });
  const matchMap = new Map();

  for (let index = 0; index < await dateButtons.count(); index += 1) {
    await dateButtons.nth(index).click();
    await page.waitForTimeout(300);
    const matches = await page.locator("pk-match-unit").evaluateAll((elements) => {
      const findMatchData = (element) => {
        const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber"));
        let fiber = fiberKey ? element[fiberKey] : null;
        while (fiber) {
          if (fiber.memoizedProps?.matchData) return fiber.memoizedProps.matchData;
          fiber = fiber.return;
        }
        return null;
      };
      return elements.map(findMatchData).filter(Boolean);
    });
    for (const match of matches) matchMap.set(match.id, match);
  }

  await page.close();
  return [...matchMap.values()].map((match) => ({ competition, match }));
}

try {
  const browser = await chromium.launch({ headless: true });
  const scraped = (await Promise.all(competitions.map((competition) => scrapeCompetition(browser, competition)))).flat();
  await browser.close();

  const upcoming = scraped.filter(({ match }) => {
    const kickoff = match.kickOffTime?.dateTime;
    return kickoff && new Date(kickoff) >= new Date();
  });
  const leagues = new Map();
  const teams = new Map();
  for (const { competition, match } of upcoming) {
    const leagueId = Number(match.competition?.id ?? competition.fallbackId);
    const leagueName = match.competition?.translations?.name ?? match.competition?.name ?? competition.name;
    leagues.set(leagueId, { id: leagueId, name: leagueName });
    for (const team of [match.homeTeam, match.awayTeam]) {
      const id = Number(team?.id);
      const name = team?.translations?.displayName ?? team?.internationalName;
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
    ...upcoming.map(({ competition, match }) => prisma.fixture.upsert({
      where: { id: Number(match.id) },
      create: { id: Number(match.id), startsAt: new Date(match.kickOffTime.dateTime), status: matchStatus(match), leagueId: Number(match.competition?.id ?? competition.fallbackId), homeTeamId: Number(match.homeTeam.id), awayTeamId: Number(match.awayTeam.id) },
      update: { startsAt: new Date(match.kickOffTime.dateTime), status: matchStatus(match), leagueId: Number(match.competition?.id ?? competition.fallbackId), homeTeamId: Number(match.homeTeam.id), awayTeamId: Number(match.awayTeam.id) },
    })),
    prisma.syncRun.upsert({
      where: { source: "uefa.com" },
      create: { source: "uefa.com", completedAt: new Date(), fixtureCount: upcoming.length },
      update: { completedAt: new Date(), fixtureCount: upcoming.length },
    }),
  ]);
  console.log(`Synced ${upcoming.length} upcoming UEFA fixtures.`);
} finally {
  await prisma.$disconnect();
}