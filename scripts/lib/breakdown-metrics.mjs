/**
 * Metrics shared by the corpus parser and the local-output scorer.
 *
 * Both sides are measured by exactly the same code, which is the only way the
 * comparison means anything: "our descriptions are 41 words, theirs are 44" is
 * only true if "word" means the same thing on both sides.
 *
 * The narrative-voice patterns are imported from the app rather than copied, so
 * a change to src/lib/description-quality.ts moves the corpus baseline and the
 * candidate score together. Node runs the TypeScript directly.
 */
import { findNarrativeVoice } from "../../src/lib/description-quality.ts";

/** Tier words as the trade writes them, longest first so "LARGE CO-STAR" wins. */
export const ROLE_TYPES = [
  "AEP SERIES REGULAR",
  "SERIES REGULAR",
  "LARGE CO-STAR",
  "GUEST STAR",
  "RECURRING",
  "DAY PLAYER",
  "SUPPORTING",
  "PRINCIPAL",
  "FEATURED",
  "VOICEOVER",
  "HAND MODEL",
  "CO-STAR",
  "EXTRA",
  "LEAD",
];

const GENDER = /\b(male|female|man|woman|men|women|non-?binary|any gender|all genders|trans(gender)?|gender[- ]?non[- ]?conforming)\b/i;
const AGE = /(\b\d{1,2}\s*(to|-|–|—|\+)\s*\d{0,2}|\b\d{1,2}s\b|\bteen|\bmid[- ]?\d{2}|\blate \d{2}|\bearly \d{2}|\b\d{1,2}\s*(years old|yo)\b|\b\d{1,2}\+|\bany age\b|\b\d{1,2}\b)/i;
const ETHNICITY =
  /\b(all ethnicities|any ethnicity|open ethnicity|ethnically ambiguous|white|black|african[- ]american|latino|latina|latinx|hispanic|asian|south asian|east asian|middle eastern|indigenous|native american|caucasian|mixed race|poc)\b/i;

/** Sentence split that tolerates "Mrs." and "18+ to play H.S." reasonably well. */
export function sentencesOf(text) {
  return text
    .split(/(?<=[.!?])["”')\]]?\s+(?=[A-Z0-9"“('\[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function wordsOf(text) {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * Measure one description.
 *
 * `head` is the canonical demographic opener the house style asks for —
 * "[GENDER], [AGE RANGE], [ETHNIC BACKGROUND]." — recognised on the first
 * sentence rather than on an exact template, because the real corpus writes it
 * a dozen ways ("Man; 45 to 55 years old; White.", "Character portrayed is
 * male, 18+ to play High School, Latino.", "Female, mid 50s – early 60s,
 * Latina.").
 */
export function measureDescription(description) {
  const text = (description ?? "").trim();
  const sentences = sentencesOf(text);
  const first = sentences[0] ?? "";

  const gender = GENDER.test(first);
  const age = AGE.test(first);
  const ethnicity = ETHNICITY.test(first);
  const hasHead = gender && age;

  // Prose is everything after the demographic opener — what an actor actually
  // reads to know who they are playing.
  const prose = hasHead ? sentences.slice(1) : sentences;

  const roleType = ROLE_TYPES.find((tier) => new RegExp(`\\b${tier}\\b`).test(text.toUpperCase())) ?? null;

  return {
    chars: text.length,
    words: wordsOf(text).length,
    proseWords: wordsOf(prose.join(" ")).length,
    sentences: sentences.length,
    proseSentences: prose.length,
    hasHead,
    gender,
    age,
    ethnicity,
    roleType,
    narrativeVoice: findNarrativeVoice(text),
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base];
  return Number((sorted[base] + rest * (next - sorted[base])).toFixed(2));
}

export function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
  return {
    mean: Number(mean.toFixed(2)),
    p10: quantile(sorted, 0.1),
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
  };
}

function rate(count, total) {
  return total ? Number((count / total).toFixed(3)) : 0;
}

/** Aggregate a list of measured descriptions into one comparable profile. */
export function summarise(measurements) {
  const total = measurements.length;
  const byRoleType = {};
  for (const m of measurements) {
    const key = m.roleType ?? "(none stated)";
    byRoleType[key] = (byRoleType[key] ?? 0) + 1;
  }

  return {
    count: total,
    words: distribution(measurements.map((m) => m.words)),
    proseWords: distribution(measurements.map((m) => m.proseWords)),
    sentences: distribution(measurements.map((m) => m.sentences)),
    proseSentences: distribution(measurements.map((m) => m.proseSentences)),
    demographicHeadRate: rate(measurements.filter((m) => m.hasHead).length, total),
    genderStatedRate: rate(measurements.filter((m) => m.gender).length, total),
    ageStatedRate: rate(measurements.filter((m) => m.age).length, total),
    ethnicityStatedRate: rate(measurements.filter((m) => m.ethnicity).length, total),
    roleTypeStatedRate: rate(measurements.filter((m) => m.roleType).length, total),
    narrativeVoiceRate: rate(measurements.filter((m) => m.narrativeVoice.length).length, total),
    emptyRate: rate(measurements.filter((m) => m.words < 3).length, total),
    roleTypes: byRoleType,
  };
}
