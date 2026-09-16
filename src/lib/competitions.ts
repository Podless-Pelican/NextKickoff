export type CompetitionSeed = {
  code: string;
  externalId: string;
  name: string;
  area: string;
  type: "LEAGUE" | "CUP";
  scope: "DOMESTIC" | "INTERNATIONAL";
};

/** The 12 competitions included in the football-data.org free tier. */
export const FOOTBALL_DATA_COMPETITIONS: CompetitionSeed[] = [
  { code: "CL", externalId: "2001", name: "UEFA Champions League", area: "Europe", type: "CUP", scope: "INTERNATIONAL" },
  { code: "EC", externalId: "2018", name: "European Championship", area: "Europe", type: "CUP", scope: "INTERNATIONAL" },
  { code: "PL", externalId: "2021", name: "Premier League", area: "England", type: "LEAGUE", scope: "DOMESTIC" },
  { code: "ELC", externalId: "2016", name: "Championship", area: "England", type: "LEAGUE", scope: "DOMESTIC" },
  { code: "BL1", externalId: "2002", name: "Bundesliga", area: "Germany", type: "LEAGUE", scope: "DOMESTIC" },
  { code: "DED", externalId: "2003", name: "Eredivisie", area: "Netherlands", type: "LEAGUE", scope: "DOMESTIC" },
  { code: "FL1", externalId: "2015", name: "Ligue 1", area: "France", type: "LEAGUE", scope: "DOMESTIC" },
  { code: "SA", externalId: "2019", name: "Serie A", area: "Italy", type: "LEAGUE", scope: "DOMESTIC" },
  { code: "PD", externalId: "2014", name: "La Liga", area: "Spain", type: "LEAGUE", scope: "DOMESTIC" },
  { code: "PPL", externalId: "2017", name: "Primeira Liga", area: "Portugal", type: "LEAGUE", scope: "DOMESTIC" },
  { code: "BSA", externalId: "2013", name: "Campeonato Brasileiro Serie A", area: "Brazil", type: "LEAGUE", scope: "DOMESTIC" },
];

/** Competitions taken from the uefa.com match API because the free tier omits them. */
export const UEFA_COMPETITIONS = [
  {
    code: "UEL",
    externalId: "14",
    competitionId: 14,
    name: "UEFA Europa League",
    area: "Europe",
    type: "CUP" as const,
    scope: "INTERNATIONAL" as const,
  },
  {
    code: "UECL",
    externalId: "2019",
    competitionId: 2019,
    name: "UEFA Conference League",
    area: "Europe",
    type: "CUP" as const,
    scope: "INTERNATIONAL" as const,
  },
];

export const DOMESTIC_LEAGUE_CODES = new Set(
  FOOTBALL_DATA_COMPETITIONS.filter((item) => item.scope === "DOMESTIC").map((item) => item.code),
);
