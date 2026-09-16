"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { buildCalendar, type CalendarEvent } from "@/lib/ics";
import { filterMatches, hasAnySelection } from "@/lib/matches";

const STORAGE_KEY = "next-kickoff-selection";
const MATCH_MINUTES = 115;

export type CompetitionView = {
  id: number;
  name: string;
  area: string;
  scope: string;
};

export type TeamView = {
  id: number;
  name: string;
  crest: string | null;
  competitionId: number | null;
};

export type MatchView = {
  id: number;
  utcDate: string;
  stage: string | null;
  competitionId: number;
  competitionName: string;
  homeTeamId: number;
  awayTeamId: number;
  homeName: string;
  homeCrest: string | null;
  awayName: string;
  awayCrest: string | null;
};

type Selection = { teams: number[]; competitions: number[] };

const EMPTY: Selection = { teams: [], competitions: [] };

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item)) : [];
}

function chip(selected: boolean) {
  return [
    "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition",
    selected
      ? "border-emerald-400 bg-emerald-400/15 text-emerald-200"
      : "border-[#1f2c47] bg-[#111a2e] text-slate-300 hover:border-slate-500",
  ].join(" ");
}

export default function Dashboard({
  competitions,
  teams,
  matches,
  timeZone,
  syncRuns,
  generatedAt,
}: {
  competitions: CompetitionView[];
  teams: TeamView[];
  matches: MatchView[];
  timeZone: string;
  syncRuns: { source: string; completedAt: string }[];
  generatedAt: string;
}) {
  const [selection, setSelection] = useState<Selection>(EMPTY);
  const [expandedLeagues, setExpandedLeagues] = useState<number[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Selections live in the browser, so the first paint must match the prerendered HTML.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        setSelection({ teams: numbers(parsed.teams), competitions: numbers(parsed.competitions) });
      }
    } catch {
      // A corrupt entry should not break the page.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  }, [selection, hydrated]);

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
      }),
    [timeZone],
  );

  const selectedTeams = useMemo(() => new Set(selection.teams), [selection.teams]);
  const selectedCompetitions = useMemo(() => new Set(selection.competitions), [selection.competitions]);
  const hasSelection = hasAnySelection(selection.competitions, selection.teams);

  const visible = useMemo(
    () => (hydrated ? filterMatches(matches, selection.competitions, selection.teams, new Date()) : []),
    [hydrated, matches, selection.competitions, selection.teams],
  );

  const leagueGroups = useMemo(
    () =>
      competitions
        .filter((competition) => competition.scope === "DOMESTIC")
        .map((competition) => ({
          competition,
          teams: teams.filter((team) => team.competitionId === competition.id),
        }))
        .filter((group) => group.teams.length > 0),
    [competitions, teams],
  );

  const availableCompetitions = useMemo(() => {
    if (selectedTeams.size === 0) return competitions;

    const competitionIds = new Set(
      matches
        .filter((match) => selectedTeams.has(match.homeTeamId) || selectedTeams.has(match.awayTeamId))
        .map((match) => match.competitionId),
    );
    return competitions.filter((competition) => competitionIds.has(competition.id));
  }, [competitions, matches, selectedTeams]);

  useEffect(() => {
    if (selectedTeams.size === 0) return;

    const availableIds = new Set(availableCompetitions.map((competition) => competition.id));
    setSelection((current) => {
      const competitions = current.competitions.filter((id) => availableIds.has(id));
      return competitions.length === current.competitions.length ? current : { ...current, competitions };
    });
  }, [availableCompetitions, selectedTeams]);

  const toggle = (key: keyof Selection, id: number) =>
    setSelection((current) => ({
      ...current,
      [key]: current[key].includes(id)
        ? current[key].filter((value) => value !== id)
        : [...current[key], id],
    }));

  const setLeague = (ids: number[], selected: boolean) =>
    setSelection((current) => ({
      ...current,
      teams: selected
        ? [...new Set([...current.teams, ...ids])]
        : current.teams.filter((id) => !ids.includes(id)),
    }));

  const download = () => {
    const events: CalendarEvent[] = visible.map((match) => {
      const start = new Date(match.utcDate);
      return {
        uid: `match-${match.id}@next-kickoff`,
        start,
        end: new Date(start.getTime() + MATCH_MINUTES * 60_000),
        summary: `${match.homeName} vs ${match.awayName}`,
        description: match.stage ? `${match.competitionName} · ${match.stage}` : match.competitionName,
      };
    });

    const blob = new Blob([buildCalendar(events, "Next Kickoff")], {
      type: "text/calendar;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "next-kickoff.ics";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="mx-auto max-w-7xl px-6 pb-20 pt-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#1f2c47] pb-6">
        <div>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Next Kickoff</h1>
          <p className="mt-2 text-base text-slate-400">Create your personal football calendar</p>
        </div>
        <div className="text-right text-sm text-slate-400">
          {syncRuns.map((run) => (
            <p key={run.source}>
              {run.source === "football-data" ? "Domestic leagues updated" : "UEFA leagues updated"}: {formatter.format(new Date(run.completedAt))}
            </p>
          ))}
          <p className="text-xs text-slate-500">Site deployed: {formatter.format(new Date(generatedAt))}</p>
        </div>
      </header>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-4">
        <p className="max-w-2xl text-sm leading-6 text-slate-300">
          Select the clubs and competitions you want to follow. Then, add their upcoming matches to your calendar.
        </p>
        {visible.length ? (
          <button
            type="button"
            onClick={download}
            className="cursor-pointer rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-[#07111f] shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300"
          >
            Add {visible.length} {visible.length === 1 ? "match" : "matches"} to calendar
          </button>
        ) : null}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section className="rounded-2xl border border-[#1f2c47] bg-[#0f172a]/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Clubs</h2>
            <span className="text-xs text-slate-400">{selection.teams.length} selected</span>
          </div>

          {teams.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">Run an import to load clubs.</p>
          ) : (
            <div className="mt-5 space-y-6">
              {leagueGroups.map((group) => {
                const ids = group.teams.map((team) => team.id);
                const allSelected = ids.every((id) => selectedTeams.has(id));
                const expanded = expandedLeagues.includes(group.competition.id);
                const teamListId = `league-${group.competition.id}-teams`;
                return (
                  <div key={group.competition.id}>
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={teamListId}
                        onClick={() =>
                          setExpandedLeagues((current) =>
                            expanded
                              ? current.filter((id) => id !== group.competition.id)
                              : [...current, group.competition.id],
                          )
                        }
                        className="flex min-w-0 cursor-pointer items-center gap-2 text-left text-sm font-semibold text-slate-200 hover:text-white"
                      >
                        <span aria-hidden="true" className="w-3 text-xs text-slate-500">
                          {expanded ? "-" : "+"}
                        </span>
                        <span>
                          {group.competition.area}
                          <span className="ml-2 font-normal text-slate-500">{group.competition.name}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setLeague(ids, !allSelected)}
                        className="shrink-0 cursor-pointer text-xs text-emerald-400 hover:underline"
                      >
                        {allSelected ? "Clear all" : "Select all"}
                      </button>
                    </div>
                    {expanded ? (
                      <div id={teamListId} className="mt-3 flex flex-wrap gap-2">
                        {group.teams.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        onClick={() => toggle("teams", team.id)}
                        className={chip(selectedTeams.has(team.id))}
                      >
                        {team.crest ? (
                          <Image
                            src={team.crest}
                            alt=""
                            width={16}
                            height={16}
                            className="h-4 w-4 object-contain"
                          />
                        ) : null}
                        {team.name}
                      </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[#1f2c47] bg-[#0f172a]/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Competitions</h2>
            <span className="text-xs text-slate-400">{selection.competitions.length} selected</span>
          </div>

          {competitions.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">Run an import to load competitions.</p>
          ) : availableCompetitions.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">No competitions found for the selected clubs.</p>
          ) : (
            <div className="mt-5 flex flex-wrap gap-2">
              {availableCompetitions.map((competition) => (
                <button
                  key={competition.id}
                  type="button"
                  onClick={() => toggle("competitions", competition.id)}
                  className={chip(selectedCompetitions.has(competition.id))}
                >
                  {competition.name}
                  <span className="text-xs text-slate-500">{competition.area}</span>
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setSelection(EMPTY)}
            className="mt-6 cursor-pointer text-xs text-slate-400 hover:text-slate-200"
          >
            Reset all selections
          </button>
        </section>
      </div>

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#1f2c47] pb-4">
          <h2 className="text-lg font-semibold">Upcoming matches</h2>
          <span className="text-3xl font-semibold text-emerald-400">{visible.length}</span>
        </div>

        {!hasSelection ? (
          <p className="mt-6 rounded-xl border border-dashed border-[#1f2c47] p-6 text-sm text-slate-400">
            Pick the clubs you follow on the left and the competitions on the right. Matches appear when a
            selected club plays in a selected competition.
          </p>
        ) : visible.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-[#1f2c47] p-6 text-sm text-slate-400">
            No upcoming matches for this combination.
          </p>
        ) : (
          <ul className="mt-2">
            {visible.map((match) => (
              <li
                key={match.id}
                className="grid gap-2 border-b border-[#16223a] py-4 md:grid-cols-[190px_minmax(0,1fr)_200px] md:items-center md:gap-6"
              >
                <time dateTime={match.utcDate} className="text-sm text-slate-400">
                  {formatter.format(new Date(match.utcDate))}
                </time>
                <div className="flex items-center gap-3 font-medium">
                  <span className="flex items-center gap-2">
                    {match.homeCrest ? (
                      <Image
                        src={match.homeCrest}
                        alt=""
                        width={18}
                        height={18}
                        className="h-[18px] w-[18px] object-contain"
                      />
                    ) : null}
                    {match.homeName}
                  </span>
                  <span className="text-xs uppercase tracking-wide text-emerald-400">vs</span>
                  <span className="flex items-center gap-2">
                    {match.awayCrest ? (
                      <Image
                        src={match.awayCrest}
                        alt=""
                        width={18}
                        height={18}
                        className="h-[18px] w-[18px] object-contain"
                      />
                    ) : null}
                    {match.awayName}
                  </span>
                </div>
                <p className="text-sm text-slate-400">
                  {match.competitionName}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
