import "dotenv/config";
import { chromium, type Browser } from "playwright";
import { UEFA_COMPETITIONS } from "../src/lib/competitions";
import { buildTeamInput, persistMatches, upsertCompetitions, type MatchInput } from "../src/lib/persist";
import { prisma } from "../src/lib/prisma";

const UEFA_SOURCE = "uefa";
const DATE_BUTTON = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} \w{3}$/;

type ScrapedTeam = {
  international: string | null;
  display: string | null;
  official: string | null;
  logo: string | null;
};

type ScrapedMatch = {
  id: string;
  kickoff: string | null;
  finished: boolean;
  started: boolean;
  cancelled: boolean;
  round: string | null;
  matchday: number | null;
  home: ScrapedTeam;
  away: ScrapedTeam;
};

function statusOf(match: ScrapedMatch) {
  if (match.cancelled) return "CANCELLED";
  if (match.finished) return "FINISHED";
  if (match.started) return "IN_PLAY";
  return "SCHEDULED";
}

/**
 * uefa.com renders fixtures client side, so the structured match payload is read
 * from the React props behind each rendered match card.
 */
async function scrapeCompetition(browser: Browser, competition: (typeof UEFA_COMPETITIONS)[number]) {
  const page = await browser.newPage();
  const collected = new Map<string, ScrapedMatch>();

  try {
    await page.goto(competition.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator("pk-match-unit").first().waitFor({ timeout: 45_000 });

    const dateButtons = page.locator("button").filter({ hasText: DATE_BUTTON });
    const dateCount = await dateButtons.count();

    for (let index = 0; index < Math.max(dateCount, 1); index += 1) {
      if (dateCount > 0) {
        await dateButtons.nth(index).click({ timeout: 15_000 }).catch(() => undefined);
        await page.waitForTimeout(350);
      }

      // Helpers must stay inline: tsx/esbuild wraps named functions in __name(), which
      // is not defined inside the browser context Playwright serialises this into.
      const matches = (await page.locator("pk-match-unit").evaluateAll((elements) =>
        elements
          .map((element) => {
            const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber"));
            let fiber = fiberKey ? (element as unknown as Record<string, any>)[fiberKey] : null;
            while (fiber) {
              if (fiber.memoizedProps?.matchData) return fiber.memoizedProps.matchData;
              fiber = fiber.return;
            }
            return null;
          })
          .filter(Boolean)
          .map((match: any) => ({
            id: String(match.id),
            kickoff: match.kickOffTime?.dateTime ?? match.kickOffTime?.date ?? null,
            finished: Boolean(match.status?.finished),
            started: Boolean(match.status?.started),
            cancelled: Boolean(match.status?.cancelled),
            round: match.round?.translations?.name ?? match.round?.name ?? null,
            matchday: typeof match.matchday === "number" ? match.matchday : null,
            home: {
              international: match.homeTeam?.internationalName ?? null,
              display: match.homeTeam?.translations?.displayName ?? null,
              official: match.homeTeam?.translations?.displayOfficialName ?? null,
              logo: match.homeTeam?.logoUrl ?? match.homeTeam?.mediumLogoUrl ?? null,
            },
            away: {
              international: match.awayTeam?.internationalName ?? null,
              display: match.awayTeam?.translations?.displayName ?? null,
              official: match.awayTeam?.translations?.displayOfficialName ?? null,
              logo: match.awayTeam?.logoUrl ?? match.awayTeam?.mediumLogoUrl ?? null,
            },
          })),
      )) as ScrapedMatch[];

      for (const match of matches) collected.set(match.id, match);
    }
  } finally {
    await page.close();
  }

  return [...collected.values()];
}

function toMatchInput(
  match: ScrapedMatch,
  competition: (typeof UEFA_COMPETITIONS)[number],
): MatchInput | null {
  if (!match.kickoff) return null;

  const homeName = match.home.official ?? match.home.international ?? match.home.display;
  const awayName = match.away.official ?? match.away.international ?? match.away.display;
  if (!homeName || !awayName) return null;

  const homeTeam = buildTeamInput({
    names: [match.home.international, match.home.official, match.home.display],
    name: match.home.international ?? homeName,
    crest: match.home.logo,
  });
  const awayTeam = buildTeamInput({
    names: [match.away.international, match.away.official, match.away.display],
    name: match.away.international ?? awayName,
    crest: match.away.logo,
  });
  if (!homeTeam || !awayTeam) return null;

  return {
    externalId: match.id,
    utcDate: new Date(match.kickoff),
    status: statusOf(match),
    stage: match.round,
    matchday: match.matchday,
    competitionCode: competition.code,
    homeTeam,
    awayTeam,
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  let inputs: MatchInput[] = [];

  try {
    await upsertCompetitions(UEFA_SOURCE, UEFA_COMPETITIONS);

    for (const competition of UEFA_COMPETITIONS) {
      const scraped = await scrapeCompetition(browser, competition);
      const mapped = scraped
        .map((match) => toMatchInput(match, competition))
        .filter((match): match is MatchInput => match !== null);

      console.log(`${competition.name}: found ${mapped.length} fixtures`);
      inputs = inputs.concat(mapped);
    }
  } finally {
    await browser.close();
  }

  const result = await persistMatches(UEFA_SOURCE, inputs);
  console.log(`Stored ${result.matchCount} UEFA fixtures and ${result.teamCount} clubs.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
