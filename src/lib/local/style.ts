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

/** Returns the book-voice phrases found in a description. */
export function findBookVoice(text: string): string[] {
  if (!text) return [];
  return BOOK_VOICE.flatMap((pattern) => {
    const match = text.match(pattern);
    return match ? [match[0].toLowerCase().trim()] : [];
  });
}
