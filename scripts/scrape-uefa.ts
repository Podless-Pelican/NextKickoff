import "dotenv/config";
import { UEFA_COMPETITIONS } from "../src/lib/competitions";
import { buildTeamInput, persistMatches, upsertCompetitions, type MatchInput } from "../src/lib/persist";
import { prisma } from "../src/lib/prisma";

const UEFA_SOURCE = "uefa";
const MATCH_API = "https://match.uefa.com/v5/matches";
const PAGE_SIZE = 100;
const MAX_OFFSET = 2_000;

type UefaCompetition = (typeof UEFA_COMPETITIONS)[number];

/** uefa.com returns most labels as locale maps such as { EN: "Feyenoord" }. */
type Localised = string | Record<string, unknown> | null | undefined;

type ApiTeam = {
  internationalName?: string | null;
  teamCode?: string | null;
  isPlaceHolder?: boolean;
  logoUrl?: string | null;
  mediumLogoUrl?: string | null;
  translations?: {
    displayName?: Localised;
    displayOfficialName?: Localised;
    displayTeamCode?: Localised;
    countryName?: Localised;
  };
};

type ApiMatch = {
  id?: string;
  kickOffTime?: { dateTime?: string };
  status?: string;
  round?: { translations?: { name?: Localised } };
  matchday?: { sequenceNumber?: string };
  homeTeam?: ApiTeam;
  awayTeam?: ApiTeam;
};

function text(value: Localised): string | null {
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

function statusOf(raw: Localised): string {
  const value = (text(raw) ?? "").toUpperCase();
  if (value.includes("CANCEL")) return "CANCELLED";
  if (value.includes("POSTPON")) return "POSTPONED";
  if (value.includes("FINISH") || value.includes("FULL")) return "FINISHED";
  if (value.includes("LIVE") || value.includes("PLAYING") || value.includes("PAUSE")) return "IN_PLAY";
  return "SCHEDULED";
}

/** UEFA labels the 2026/27 season as 2027 and rolls over in July. */
function currentSeasonYear(now = new Date()): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 6 ? year + 1 : year;
}

async function fetchCompetition(competition: UefaCompetition, seasonYear: number) {
  const matches: ApiMatch[] = [];

  for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
    const url = new URL(MATCH_API);
    url.searchParams.set("competitionId", String(competition.competitionId));
    url.searchParams.set("seasonYear", String(seasonYear));
    url.searchParams.set("phase", "ALL");
    url.searchParams.set("fromDate", `${seasonYear - 1}-06-01`);
    url.searchParams.set("toDate", `${seasonYear}-06-30`);
    url.searchParams.set("order", "ASC");
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("utcOffset", "0");

    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`uefa.com returned ${response.status} for ${competition.code}`);
    }

    const page = (await response.json()) as ApiMatch[];
    if (!Array.isArray(page) || page.length === 0) break;

    matches.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return matches;
}

function toMatchInput(match: ApiMatch, competition: UefaCompetition): MatchInput | null {
  const kickoff = match.kickOffTime?.dateTime;
  if (!match.id || !kickoff) return null;

  const utcDate = new Date(kickoff);
  if (Number.isNaN(utcDate.getTime())) return null;

  // Knockout slots without a drawn opponent ("Winners SF-1") are not real clubs.
  if (match.homeTeam?.isPlaceHolder || match.awayTeam?.isPlaceHolder) return null;

  const read = (team: ApiTeam | undefined) => ({
    international: team?.internationalName?.trim() || null,
    official: text(team?.translations?.displayOfficialName),
    display: text(team?.translations?.displayName),
    code: text(team?.translations?.displayTeamCode) ?? team?.teamCode?.trim() ?? null,
    country: text(team?.translations?.countryName),
    logo: team?.logoUrl ?? team?.mediumLogoUrl ?? null,
  });

  const home = read(match.homeTeam);
  const away = read(match.awayTeam);

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

  const matchday = Number(match.matchday?.sequenceNumber);

  return {
    externalId: match.id,
    utcDate,
    status: statusOf(match.status),
    stage: text(match.round?.translations?.name),
    matchday: Number.isFinite(matchday) ? matchday : null,
    competitionCode: competition.code,
    homeTeam,
    awayTeam,
  };
}

async function main() {
  const seasonYear = currentSeasonYear();

  let inputs: MatchInput[] = [];
  for (const competition of UEFA_COMPETITIONS) {
    const fetched = await fetchCompetition(competition, seasonYear);
    const mapped = fetched
      .map((match) => toMatchInput(match, competition))
      .filter((match): match is MatchInput => match !== null);

    console.log(`${competition.name}: ${fetched.length} returned, ${mapped.length} usable fixtures`);
    inputs = inputs.concat(mapped);
  }

  await upsertCompetitions(UEFA_SOURCE, UEFA_COMPETITIONS);
  const result = await persistMatches(UEFA_SOURCE, inputs);
  console.log(`Stored ${result.matchCount} UEFA fixtures and ${result.teamCount} clubs (season ${seasonYear}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
