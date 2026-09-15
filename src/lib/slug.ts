const CLUB_WORDS = new Set([
  "fc", "afc", "cf", "sc", "ac", "as", "ssc", "bv", "sv", "vfb", "vfl", "fk",
  "nk", "sk", "rc", "rcd", "cd", "ud", "us", "ss", "ogc", "rsc",
]);

/** Normalised club key used to merge the same club arriving from different sources. */
export function teamSlug(name: string): string {
  const rawWords = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  // Punctuated initialisms ("N.E.C.", "F.C. Copenhagen") arrive as loose letters,
  // while the other source spells them solid.
  const words: string[] = [];
  let run = 0;
  for (const word of rawWords) {
    if (word.length === 1 && run > 0) {
      words[words.length - 1] += word;
    } else {
      words.push(word);
    }
    run = word.length === 1 ? run + 1 : 0;
  }

  const trimmed = words.filter(
    (word, index) => !(CLUB_WORDS.has(word) && (index === 0 || index === words.length - 1)),
  );

  return (trimmed.length ? trimmed : words).join("-");
}

/** Slug variants for one club, most specific first, used to match across sources. */
export function teamSlugCandidates(...names: Array<unknown>): string[] {
  const candidates = names
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    .map(teamSlug)
    .filter(Boolean);

  return [...new Set(candidates)];
}
