import "dotenv/config";
import { chromium, type Browser, type Page } from "playwright";
import { UEFA_COMPETITIONS } from "../src/lib/competitions";
import { buildTeamInput, persistMatches, upsertCompetitions, type MatchInput } from "../src/lib/persist";
import { prisma } from "../src/lib/prisma";

const UEFA_SOURCE = "uefa";
const MAX_SCROLL_STEPS = 200;

type ScrapedTeam = {
  international: unknown;
  display: unknown;
  official: unknown;
  code: unknown;
  country: unknown;
  logo: unknown;
  placeholder: boolean;
};

type ScrapedMatch = {
  id: string;
  kickoff: unknown;
  status: unknown;
  round: unknown;
  matchday: number | null;
  home: ScrapedTeam;
  away: ScrapedTeam;
};

/** uefa.com returns many labels as locale maps such as { EN: "Feyenoord" }. */
function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferred = record.EN ?? record.en;
    if (typeof preferred === "string") return preferred.trim() || null;

    const first = Object.values(record).find(
      (item) => typeof item === "string" && item.trim().length > 0,
    );
    return typeof first === "string" ? first.trim() : null;
  }

  return null;
}

/** Match status arrives either as a string enum or as an object of flags. */
function statusOf(raw: unknown): string {
  if (raw && typeof raw === "object") {
    const flags = raw as Record<string, unknown>;
    if (flags.cancelled) return "CANCELLED";
    if (flags.finished) return "FINISHED";
    if (flags.started) return "IN_PLAY";
    return "SCHEDULED";
  }

  const value = (text(raw) ?? "").toUpperCase();
  if (value.includes("CANCEL")) return "CANCELLED";
  if (value.includes("POSTPON")) return "POSTPONED";
  if (value.includes("FINISH") || value.includes("FULL")) return "FINISHED";
  if (value.includes("LIVE") || value.includes("PLAY") || value.includes("PAUSE")) return "IN_PLAY";
  return "SCHEDULED";
}

// Helpers stay inline below: tsx/esbuild wraps named functions in __name(), which
// is not defined inside the browser context Playwright serialises them into.
async function extractRendered(page: Page): Promise<ScrapedMatch[]> {
  return (await page.locator("pk-match-unit").evaluateAll((elements) =>
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
        status: match.status ?? null,
        round: match.round?.translations?.name ?? match.round?.name ?? null,
        matchday: typeof match.matchday === "number" ? match.matchday : null,
        home: {
          international: match.homeTeam?.internationalName ?? null,
          display: match.homeTeam?.translations?.displayName ?? null,
          official: match.homeTeam?.translations?.displayOfficialName ?? null,
          code: match.homeTeam?.translations?.displayTeamCode ?? match.homeTeam?.teamCode ?? null,
          country: match.homeTeam?.translations?.countryName ?? null,
          logo: match.homeTeam?.logoUrl ?? match.homeTeam?.mediumLogoUrl ?? null,
          placeholder: Boolean(match.homeTeam?.isPlaceHolder),
        },
        away: {
          international: match.awayTeam?.internationalName ?? null,
          display: match.awayTeam?.translations?.displayName ?? null,
          official: match.awayTeam?.translations?.displayOfficialName ?? null,
          code: match.awayTeam?.translations?.displayTeamCode ?? match.awayTeam?.teamCode ?? null,
          country: match.awayTeam?.translations?.countryName ?? null,
          logo: match.awayTeam?.logoUrl ?? match.awayTeam?.mediumLogoUrl ?? null,
          placeholder: Boolean(match.awayTeam?.isPlaceHolder),
        },
      })),
  )) as ScrapedMatch[];
}

/**
 * The fixture list is virtualised: cards unmount once scrolled past, so matches are
 * collected incrementally while scrolling through the season.
 */
async function scrapeCompetition(browser: Browser, competition: (typeof UEFA_COMPETITIONS)[number]) {
  const page = await browser.newPage();
  const collected = new Map<string, ScrapedMatch>();

  try {
    await page.goto(competition.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator("pk-match-unit").first().waitFor({ timeout: 45_000 });
    await page.waitForTimeout(600);

    let stagnant = 0;
    for (let step = 0; step < MAX_SCROLL_STEPS && stagnant < 6; step += 1) {
      const before = collected.size;
      for (const match of await extractRendered(page)) collected.set(match.id, match);
      stagnant = collected.size === before ? stagnant + 1 : 0;

      const atBottom = await page.evaluate(() => {
        window.scrollBy(0, Math.round(window.innerHeight * 0.75));
        return window.scrollY + window.innerHeight >= document.body.scrollHeight - 120;
      });
      await page.waitForTimeout(450);

      if (atBottom) {
        for (const match of await extractRendered(page)) collected.set(match.id, match);
        break;
      }
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
  const kickoff = text(match.kickoff);
  if (!kickoff) return null;

  const utcDate = new Date(kickoff);
  if (Number.isNaN(utcDate.getTime())) return null;

  // Knockout slots without a drawn opponent ("Winners SF-1") are not real clubs.
  if (match.home.placeholder || match.away.placeholder) return null;

  const home = {
    international: text(match.home.international),
    official: text(match.home.official),
    display: text(match.home.display),
    code: text(match.home.code),
    country: text(match.home.country),
    logo: text(match.home.logo),
  };
  const away = {
    international: text(match.away.international),
    official: text(match.away.official),
    display: text(match.away.display),
    code: text(match.away.code),
    country: text(match.away.country),
    logo: text(match.away.logo),
  };

  const homeName = home.official ?? home.international ?? home.display;
  const awayName = away.official ?? away.international ?? away.display;
  if (!homeName || !awayName) return null;

  const homeTeam = buildTeamInput({
    names: [home.international, home.official, home.display],
    name: home.international ?? homeName,
    tla: home.code,
    country: home.country,
    crest: home.logo,
  });
  const awayTeam = buildTeamInput({
    names: [away.international, away.official, away.display],
    name: away.international ?? awayName,
    tla: away.code,
    country: away.country,
    crest: away.logo,
  });
  if (!homeTeam || !awayTeam) return null;

  return {
    externalId: match.id,
    utcDate,
    status: statusOf(match.status),
    stage: text(match.round),
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

      console.log(`${competition.name}: ${scraped.length} cards seen, ${mapped.length} usable fixtures`);
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
