/**
 * Book voice: the register a small model falls into when asked to describe a
 * person, and the one thing a casting director notices immediately.
 *
 * This is a different failure from the narrative-summary voice that
 * description-quality.ts catches. That one retells the plot ("in the story",
 * "his journey"). This one writes a novel:
 *
 *   "He carries himself with an air of quiet authority, his tailored suit
 *    accentuating his lean physique. His smile is quick and disarming, but his
 *    gaze can be unnerving."
 *
 * Nothing there is castable. It is atmosphere, and llama3.2 produces it by
 * default because that is what character description looks like in its training
 * data. The public prompt suppresses this on a frontier model by argument — a
 * cut test, a list of banned constructions, worked examples. A 3B model does
 * not hold that, so the rule is applied here after generation instead.
 *
 * Every pattern below was checked against the 310 real Breakdown Services
 * entries with scripts/check-style-filters.mjs. Together they fire on 2.9% of
 * them, against 6.5% for the narrative-voice check that is already accepted —
 * so a hit is good evidence of book voice rather than of writing well.
 *
 * One pattern was measured and then deliberately removed: "beneath his anxious
 * exterior" and its variants accounted for more than half of all matches in
 * real copy, and the same construction appears in the public prompt as an
 * example of the house style done *well*. A filter that fires on the style
 * guide's own model answer is wrong, however book-ish it reads.
 */
const BOOK_VOICE: RegExp[] = [
  // The single strongest tell, and one this codebase taught the model to write:
  // an earlier version of the description prompt asked for "how they carry
  // themselves", and got it back verbatim in almost every description.
  /\bcarr(y|ies|ying) (himself|herself|themselves|myself)\b/i,
  /\ban air of\b/i,
  /\bexude[sd]?\b/i,
  /\ba voice of reason\b/i,
  /\bmoral compass\b/i,
  /\bin a world (of|where)\b/i,
  /\b(is|as) a (shield|mask|armou?r|wall|weapon)\b/i,
  /\ba deep sense of\b/i,
  // "His smile is quick and disarming, but his gaze can be unnerving."
  /\b(his|her|their) (gaze|smile|eyes|presence|demeanou?r) (is|are|can be)\b/i,
  // Possessive absolute: ", his tailored suit accentuating his lean physique".
  /,\s+(his|her|their)\s+[a-z]+(\s+[a-z]+)?\s+[a-z]+ing\b/i,
];

/**
 * Scene narration: the model retelling a moment instead of describing a person.
 *
 * Distinct from the plot-summary voice in description-quality.ts, which talks
 * about the story from outside it ("in the story", "by the end"). This is the
 * model paraphrasing the action line it was handed — "stares out at the sea,
 * lost in thought", "Cobb watches her with interest". Given an action beat as
 * evidence, a small model returns an action beat.
 *
 * Measured against the 310 real entries: every pattern here appears in 0% of
 * them, which is as clean a separation as this corpus offers. Deliberately
 * excluded after measuring: "navigate" (2.9% of real entries) and "sense of
 * humour" (1.0%) — both are ordinary trade usage despite reading as filler.
 */
const SCENE_NARRATION: RegExp[] = [
  /\bstar(e|es|ing) (out|off|into)\b/i,
  /\blost in thought\b/i,
  /\bwatch(es|ing)\b/i,
  /\bwith interest\b/i,
  /\bwith a mix of\b/i,
  /\beventually\b/i,
  /\bis trying to\b/i,
  /\bdriven by (a|his|her|their) (desire|need)\b/i,
];

/** Returns the book-voice phrases found in a description. */
export function findBookVoice(text: string): string[] {
  if (!text) return [];
  return [...BOOK_VOICE, ...SCENE_NARRATION].flatMap((pattern) => {
    const match = text.match(pattern);
    return match ? [match[0].toLowerCase().trim()] : [];
  });
}

/**
 * Phrases the model reuses across different roles.
 *
 * A run came back with "a dry sense of humor" on two unrelated characters —
 * the tell that the model has run out of evidence and is reaching for stock
 * filler. No regex catches this, because the phrase is fine in isolation and
 * only wrong because it is doing duty for two different people.
 *
 * This reports rather than edits: the phrases are logged and counted, so a run
 * that leans on filler is visible without the pipeline silently deleting copy
 * it cannot replace.
 */
export function findRepeatedPhrases(descriptions: string[], minRoles = 2): string[] {
  const WINDOW = 4;
  const rolesByPhrase = new Map<string, Set<number>>();

  descriptions.forEach((description, roleIndex) => {
    const words = description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    for (let i = 0; i + WINDOW <= words.length; i++) {
      const phrase = words.slice(i, i + WINDOW).join(" ");
      const roles = rolesByPhrase.get(phrase) ?? new Set<number>();
      roles.add(roleIndex);
      rolesByPhrase.set(phrase, roles);
    }
  });

  const repeated = [...rolesByPhrase.entries()]
    .filter(([, roles]) => roles.size >= minRoles)
    .sort((a, b) => b[1].size - a[1].size)
    .map(([phrase]) => phrase);

  // Keep the longest form of overlapping windows: "a dry sense of humor"
  // surfaces as two windows, and reporting both is noise.
  return repeated.filter((phrase) => !repeated.some((other) => other !== phrase && other.includes(phrase)));
}
