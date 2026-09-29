/**
 * Pure helpers for the v2 pipeline: no Ollama, no Next, nothing that needs a
 * server. Kept apart so scripts/check-local-v2.mjs can import them directly.
 *
 * v2.1: the model no longer writes a paragraph. It fills a form (occupation,
 * relationship, look cues, type, traits, skills, requirements, and for leads
 * one story note). Code checks each field and assembles the description in the
 * order real breakdowns use. See BREAKDOWN-STYLE.md.
 */

import type { V2Tier } from "./cast";

export interface RoleFields {
  gender: string;
  ageMin: number;
  ageMax: number;
  occupation: string;
  relationship: string;
  lookCues: string[];
  type: string;
  traits: string[];
  skills: string[];
  requirements: string[];
  storyNote: string;
  ethnicity: string;
}

/** What the tier allows. Word caps are for the prose after the "Male, 20 to 30 years old, ..." head. */
export const TIER_RULES: Record<V2Tier, { words: number; traits: number; skills: number; story: boolean }> = {
  LEAD: { words: 90, traits: 4, skills: 4, story: true },
  SUPPORTING: { words: 65, traits: 3, skills: 3, story: false },
  "DAY PLAYER": { words: 40, traits: 2, skills: 2, story: false },
};

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().replace(/^[\s.;:,-]+|[\s;:,-]+$/g, "") : "");
const cleanList = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map(clean).filter(Boolean).slice(0, max) : [];
export const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;

// ---------------------------------------------------------------------------
// Schema-level validation (hard: a failure here means the reply is unusable)
// ---------------------------------------------------------------------------

export function validateFields(raw: unknown): { ok: true; fields: RoleFields } | { ok: false; why: string } {
  if (!raw || typeof raw !== "object") return { ok: false, why: "the answer was not a JSON object" };
  const r = raw as Record<string, unknown>;
  if (!["Male", "Female", "Non-binary"].includes(String(r.gender))) {
    return { ok: false, why: "gender must be Male, Female or Non-binary" };
  }
  const min = Number(r.ageMin);
  const max = Number(r.ageMax);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 99) {
    return { ok: false, why: "ageMin and ageMax must both be whole numbers between 1 and 99" };
  }
  if (min > max) return { ok: false, why: "ageMin must not be higher than ageMax" };
  const occupation = clean(r.occupation);
  if (wordCount(occupation) < 1 || wordCount(occupation) > 8) {
    return { ok: false, why: "occupation must be the person's job, rank or role in one to eight words" };
  }
  return {
    ok: true,
    fields: {
      gender: String(r.gender),
      ageMin: min,
      ageMax: max,
      occupation,
      relationship: clean(r.relationship),
      lookCues: cleanList(r.lookCues, 4),
      type: clean(r.type),
      traits: cleanList(r.traits, 8),
      skills: cleanList(r.skills, 6),
      requirements: cleanList(r.requirements, 6),
      storyNote: clean(r.storyNote),
      ethnicity: clean(r.ethnicity),
    },
  };
}

// ---------------------------------------------------------------------------
// Content checks (the reply has the right shape; is what it says right for a breakdown?)
// ---------------------------------------------------------------------------

/**
 * Filler that reads as a character summary. Every one of these is absent or
 * under 3% in the 308 real Breakdown Services entries measured for
 * BREAKDOWN-STYLE.md, and every one is what the 8B model wrote in the entries
 * the boss rejected.
 */
export const FILLER: RegExp[] = [
  /\bintrospective\b/i,
  /\bself[- ](?:critical|aware|reliant|assured|sacrificing)\b/i,
  /\bdecisive\b/i,
  /\bcomplex\b/i,
  /\bnuanced?\b/i,
  /\bmulti-?faceted\b/i,
  /\bdynamic\b/i,
  /\bwell[- ]rounded\b/i,
  /\bnatural leader\b/i,
  /\bleader among\b/i,
  /\bleadership\b/i,
  /\bsense of humou?r\b/i,
  /\bcalm (?:under|and focused|and collected)\b/i,
  /\bdemeanou?r\b/i,
  /\bresourceful\b/i,
  /\bprotective of\b/i,
  /\bmix of\b/i,
  /\bbut also\b/i,
  /\band yet\b/i,
  /\bair of\b/i,
  /\b(?:possibly|perhaps|likely|probably|seemingly|apparently)\b/i,
  /\bcarries? (?:himself|herself|themselves)\b/i,
  /\bcatalyst\b/i,
  /\bskilled\b/i,
  /\bidealistic\b/i,
  /\bdetermined to\b/i,
  /\bjourney\b/i,
  /\bthe (?:film|script|story|audience|screenplay)\b/i,
  /\bin the story\b/i,
];

/** Story verbs: the field is describing what happens instead of who the person is. */
export const PLOT_WORDS =
  /\b(?:when|after|then|until|eventually|before|while|once|later|ends up|goes on|dies|killed|shot|betrays?|betrayed|saves?|saved|reveals?|revealed|escapes?|escaped|learns?|discovers?|decides?|realis?es?|sacrifices?|survives?|finds out|has to|must (?:decide|choose))\b/i;

/** Age belongs in the head of the line. Digits and decades in the prose contradict or repeat it. */
export const AGE_IN_PROSE =
  /\d|\b(?:(?:thir|four|fif|six|seven|eigh|nine)teen|eleven|twelve|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|aged|elderly aged|twent(?:y|ies)|thirt(?:y|ies)|fort(?:y|ies)|fift(?:y|ies)|sixt(?:y|ies)|sevent(?:y|ies)|eight(?:y|ies)|ninet(?:y|ies)|teens|mid-?to|years? old|year-old)\b|\b(?:early|mid|late)[- ](?:to[- ])?(?:teens|twenties|thirties|forties|fifties|sixties|seventies)\b/i;

/** Looks the script has to have given. "Handsome" from a model is a guess about an actor's face. */
const SCENERY = /\b(?:life jackets?|life-?preservers?|sludge|cliffs?|water|sea|beach|sky|sun|smoke|fire|oil|waves?|rain|mud|sand|dust|rubble|wreckage|ship|boat|plane|train|room|deck|hull)\b/i;

const LOOK_CLAIMS = /\b(?:handsome|attractive|beautiful|pretty|gorgeous|rugged|striking|stunning|chiselled|chiseled|good-looking)\b/i;

const MOVEMENT =
  /\b(?:concentrates?|climbs?|dives?|hurtl\w+|gasps?|gasping|looks?|runs?|jumps?|grabs?|holds?|glances?|stares?|watches|leaps?|falls?|struggles?|reaches|turns?|steps?|walks?|stands?|sits?|nods?|shoots?|fires)\b/i;

/** Wording that is filler when it describes temperament, but is fine as a job ("Fortis Leader"). */
const TEMPERAMENT_FILLER: RegExp[] = [/\bleader\b/i, /\bwarrior\b/i, /\bbattle-hardened\b/i, /\bgrizzled\b/i, /\bpolished\b/i, /\bdiplomatic\b/i, /\bcompetent\b/i, /\bcapable\b/i, /\bconfident\b/i];

export type FieldName = "occupation" | "relationship" | "lookCues" | "type" | "traits" | "skills" | "requirements" | "storyNote";

export interface Problem {
  field: FieldName;
  /** Index inside a list field, or -1 for the whole field. */
  index: number;
  why: string;
  text: string;
}

function fieldTexts(f: RoleFields): { field: FieldName; index: number; text: string }[] {
  const out: { field: FieldName; index: number; text: string }[] = [];
  out.push({ field: "occupation", index: -1, text: f.occupation });
  if (f.relationship) out.push({ field: "relationship", index: -1, text: f.relationship });
  f.lookCues.forEach((t, i) => out.push({ field: "lookCues", index: i, text: t }));
  if (f.type) out.push({ field: "type", index: -1, text: f.type });
  f.traits.forEach((t, i) => out.push({ field: "traits", index: i, text: t }));
  f.skills.forEach((t, i) => out.push({ field: "skills", index: i, text: t }));
  f.requirements.forEach((t, i) => out.push({ field: "requirements", index: i, text: t }));
  if (f.storyNote) out.push({ field: "storyNote", index: -1, text: f.storyNote });
  return out;
}

const GENERIC = new Set(["skills", "skill", "experience", "experienced", "skilled", "able", "flying", "plane", "work", "the", "and", "with", "young", "old"]);
/** A skill, type or trait made only of words already in the job ("pilot skills", "flying a plane"). */
function restatesJob(text: string, f: RoleFields): boolean {
  const words = text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !GENERIC.has(w));
  const job = f.occupation.toLowerCase();
  if (!words.length) return text.toLowerCase().split(/[^a-z]+/).filter(Boolean).every((w) => GENERIC.has(w) || job.includes(w.slice(0, 5)));
  return words.every((w) => job.includes(w.slice(0, 5)));
}

const GENERIC_ASK = new Set(
  "non speaking speaks speaking dialogue line lines one stunt action physical work handling handles weapon weapons accent language mask costume wardrobe prosthetic prosthetics makeup kissing intimacy violence smoking minor animal animals period props prop brief scene scenes fight fighting fights swimming swim water boat vehicle driving shouting delivery uniform emotional range wide heavy armour armor blood makeup wet cold outdoors extended".split(" "),
);
/** A skill or requirement is fine when its specific words appear in what the model read, or when it is a stock production note. */
function skillGrounded(text: string, identity: string): boolean {
  const words = text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !GENERIC_ASK.has(w));
  if (!words.length) return true;
  return words.every((w) => identity.includes(w.slice(0, 5)));
}

function mostlyGrounded(text: string, hay: string): boolean {
  const words = text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  if (!words.length) return true;
  const hits = words.filter((w) => hay.includes(w.toLowerCase().replace(/[^a-z]/g, "").slice(0, 5))).length;
  return hits / words.length >= 0.7;
}

const stem = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "").slice(0, 5);

/** True when every meaningful word of `text` appears (by 5-letter stem) in the evidence the model saw. */
function grounded(text: string, identity: string): boolean {
  const words = text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  if (!words.length) return true;
  const hay = identity.toLowerCase();
  return words.every((w) => hay.includes(stem(w)));
}

/** The longest shared run of `n` words between `text` and any corpus text, or "". */
export function sharedRun(text: string, corpus: string[], n = 6): string {
  const toWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
  const grams = new Set<string>();
  for (const c of corpus) {
    const w = toWords(c);
    for (let i = 0; i + n <= w.length; i++) grams.add(w.slice(i, i + n).join(" "));
  }
  const w = toWords(text);
  for (let i = 0; i + n <= w.length; i++) {
    const g = w.slice(i, i + n).join(" ");
    if (grams.has(g)) return g;
  }
  return "";
}

export interface CheckContext {
  tier: V2Tier;
  /** Action lines only, lower-cased. Looks and situations must be found here. */
  scene?: string;
  /** Traits already used on this many other roles in the run, by lower-cased word. */
  traitUse?: Map<string, number>;
  /** Lower-cased text of everything the model was shown about this person. */
  identity: string;
  /** Names of the other characters, so a story note cannot be about somebody else. */
  otherNames: string[];
  /** Example texts the model was shown (worked pairs and retrieved entries), for the copy check. */
  examples: string[];
}

export function checkFields(f: RoleFields, ctx: CheckContext): Problem[] {
  const problems: Problem[] = [];
  const rules = TIER_RULES[ctx.tier];
  for (const t of fieldTexts(f)) {
    if (AGE_IN_PROSE.test(t.text) && t.field !== "requirements" && t.field !== "skills") {
      problems.push({ ...t, why: "an age or number (ages are printed separately)" });
      continue;
    }
    if ((t.field === "skills" || t.field === "requirements") && /\d\s*(?:years?|yrs)|\b(?:years? old)\b/i.test(t.text)) {
      problems.push({ ...t, why: "an age" });
      continue;
    }
    const temperament = t.field === "type" || t.field === "traits" || t.field === "storyNote";
    const filler = [...FILLER, ...(temperament ? TEMPERAMENT_FILLER : [])].map((p) => t.text.match(p)?.[0]).find(Boolean);
    if (filler) {
      problems.push({ ...t, why: `filler wording "${filler.toLowerCase()}"` });
      continue;
    }
    if (t.field === "lookCues" && (/\b\w+ing\b/i.test(t.text) || MOVEMENT.test(t.text) || /^(?:young|old|older|elderly|middle[- ]aged)$/i.test(t.text.trim()) || wordCount(t.text) > 5)) {
      problems.push({ ...t, why: "a look is how they appear (build, hair, dress, condition), not what they are doing" });
      continue;
    }
    if (t.field === "lookCues" && SCENERY.test(t.text)) {
      problems.push({ ...t, why: "that is the setting, not how the person looks" });
      continue;
    }
    if (t.field === "lookCues" && !grounded(t.text, ctx.scene ?? ctx.identity)) {
      problems.push({ ...t, why: "a look the script does not give" });
      continue;
    }
    if ((t.field === "skills" || t.field === "requirements") && !skillGrounded(t.text, ctx.identity)) {
      problems.push({ ...t, why: "a skill or requirement the script does not support" });
      continue;
    }
    if (LOOK_CLAIMS.test(t.text) && !ctx.identity.match(LOOK_CLAIMS)) {
      problems.push({ ...t, why: "a good-looks claim the script does not make" });
      continue;
    }
    if (["occupation", "relationship", "type", "storyNote"].includes(t.field)) {
      const plot = t.text.match(PLOT_WORDS)?.[0];
      if (plot) {
        problems.push({ ...t, why: `story wording "${plot.toLowerCase()}" (describe the person, not events)` });
        continue;
      }
    }
    if (t.field === "occupation" && !f.relationship && /^(?:an?\s+)?(?:young\s+|old\s+|older\s+)?(?:man|woman|boy|girl|guy|lad|person|male|female)\b/i.test(t.text)) {
      problems.push({ ...t, why: "occupation must be a job, rank or role in the world, not just man or woman" });
      continue;
    }
    if ((t.field === "skills" || t.field === "requirements" || t.field === "type") && restatesJob(t.text, f)) {
      problems.push({ ...t, why: "it only repeats the job" });
      continue;
    }
    if (t.field === "storyNote") {
      if (/\bto\s+[a-z]+|\b(?:helps?|protects?|fights?|fighting|defends?|rescues?|evacuat\w+|tries|trying|attempts?|flying|running|escap\w+|surviv\w+)\b/i.test(t.text)) {
        problems.push({ ...t, why: "storyNote describes what they do in the story; state their situation instead" });
        continue;
      }
      if (!rules.story) {
        problems.push({ ...t, why: "storyNote is for leads only" });
        continue;
      }
      if (wordCount(t.text) > 14) {
        problems.push({ ...t, why: "storyNote is over 14 words" });
        continue;
      }
      const other = ctx.otherNames.find((n) => n.length > 3 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t.text));
      if (other) {
        problems.push({ ...t, why: `it names another character (${other})` });
        continue;
      }
      if (!/^(?:carries|has|is|lives|works|serves|owns|owes|bears|hides|keeps|feels|wants|needs|grieving|haunted|mourning|widowed|alone|newly)\b/i.test(t.text.trim())) {
        problems.push({ ...t, why: "storyNote must state a situation (Carries..., Has..., Is..., Lives...), not an action" });
        continue;
      }
      if (!mostlyGrounded(t.text, ctx.scene ?? ctx.identity)) {
        problems.push({ ...t, why: "storyNote says things the script lines do not" });
        continue;
      }
    }
    if (t.field !== "occupation" && wordCount(t.text) > (t.field === "type" ? 6 : t.field === "storyNote" ? 14 : t.field === "relationship" ? 9 : t.field === "requirements" ? 9 : 6)) {
      problems.push({ ...t, why: "too long for this field" });
      continue;
    }
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    const exact = t.field !== "lookCues" && wordCount(t.text) >= 3 && ctx.examples.some((e) => norm(e) === norm(t.text));
    const run = exact ? norm(t.text) : wordCount(t.text) >= 6 ? sharedRun(t.text, ctx.examples, 6) : "";
    if (run) problems.push({ ...t, why: `copied wording from an example ("${run}")` });
  }
  const limit = ctx.tier === "DAY PLAYER" ? 2 : 3;
  f.traits.forEach((t, i) => {
    const key = t.toLowerCase().split(/[^a-z]+/)[0];
    if (ctx.traitUse && (ctx.traitUse.get(key) ?? 0) >= limit && !(ctx.scene ?? "").includes(key.slice(0, 5))) {
      problems.push({ field: "traits", index: i, why: `"${t}" is already on ${ctx.traitUse.get(key)} other roles; stock filler`, text: t });
    }
  });
  if (f.type) {
    const key = f.type.toLowerCase();
    if (ctx.traitUse && (ctx.traitUse.get(`type:${key}`) ?? 0) >= 2) {
      problems.push({ field: "type", index: -1, why: "the same type text is already on other roles", text: f.type });
    }
  }
  if (f.traits.length > rules.traits) {
    problems.push({ field: "traits", index: -1, why: `more than ${rules.traits} traits for this size of part`, text: f.traits.join(", ") });
  }
  return problems;
}

/** Remove exactly what the checks flagged. The occupation is the one field that cannot be removed. */
export function applyProblems(f: RoleFields, problems: Problem[]): { fields: RoleFields; usable: boolean } {
  const g: RoleFields = { ...f, lookCues: [...f.lookCues], traits: [...f.traits], skills: [...f.skills], requirements: [...f.requirements] };
  const drop: Record<string, Set<number>> = {};
  let usable = true;
  for (const p of problems) {
    if (p.field === "occupation") {
      usable = false;
      continue;
    }
    if (p.index === -1 && p.field === "traits") continue; // handled by the tier cap in assemble
    if (p.index === -1) {
      (g as unknown as Record<string, string>)[p.field] = "";
      continue;
    }
    (drop[p.field] ??= new Set()).add(p.index);
  }
  for (const key of ["lookCues", "traits", "skills", "requirements"] as const) {
    const gone = drop[key];
    if (gone) g[key] = g[key].filter((_, i) => !gone.has(i));
  }
  return { fields: g, usable };
}

// ---------------------------------------------------------------------------
// Assembly, in the order real breakdowns use
// ---------------------------------------------------------------------------

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const endDot = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
const dedupe = (a: string[]) =>
  a.filter((x, i) => {
    const lx = x.toLowerCase();
    return !a.some((y, j) => j !== i && (y.toLowerCase() === lx ? j < i : y.toLowerCase().includes(lx) && lx.length < y.length));
  });

/**
 * identity sentence, look, type, traits, skills and requirements, story note.
 * Over the tier's word cap, whole segments come off, least important first:
 * story note, traits, type, look, then trailing skills. The identity sentence is never cut.
 */
export function assembleBody(f: RoleFields, tier: V2Tier, speaking: boolean): string {
  const rules = TIER_RULES[tier];
  const said = `${f.occupation} ${f.type}`.toLowerCase();
  const traits = dedupe(f.traits).filter((t) => !said.includes(t.toLowerCase().slice(0, 6))).slice(0, rules.traits);
  const asks = dedupe([...f.skills, ...f.requirements]).filter(
    (a) => !/^(?:speaking|day player|supporting|lead|brief (?:appearance|speaking role)|speaking role|brief|minimal action|one scene)$/i.test(a.trim()) &&
      !/^(?:day player|brief speaking)/i.test(a.trim()) &&
      !(speaking && /non-?speaking|no dialogue|silent/i.test(a)) &&
      !/^speaking\b/i.test(a.trim()),
  );
  if (!speaking && !asks.some((a) => /non-?speaking|no dialogue|silent/i.test(a))) asks.push("non-speaking");

  const sameAs = (a: string, b: string) => !!a && a.toLowerCase().replace(/[^a-z]/g, "") === b.toLowerCase().replace(/[^a-z]/g, "");
  const identity = endDot(cap(f.relationship ? `${f.occupation}, ${f.relationship}` : f.occupation));
  if (sameAs(f.type, f.occupation)) f = { ...f, type: "" };
  f = { ...f, lookCues: f.lookCues.filter((l) => !sameAs(l, f.occupation)) };
  const segments: { key: string; text: string; priority: number }[] = [
    { key: "identity", text: identity, priority: 100 },
    { key: "look", text: f.lookCues.length ? endDot(cap(dedupe(f.lookCues).slice(0, 3).join(", "))) : "", priority: 60 },
    { key: "type", text: f.type ? endDot(cap(f.type)) : "", priority: 50 },
    { key: "traits", text: traits.length ? endDot(cap(traits.join(", "))) : "", priority: 40 },
    { key: "asks", text: asks.length ? asks.slice(0, rules.skills + 1).map((a) => endDot(cap(a))).join(" ") : "", priority: 80 },
    { key: "story", text: rules.story && f.storyNote ? endDot(cap(f.storyNote)) : "", priority: 20 },
  ];
  const order = ["identity", "look", "type", "traits", "asks", "story"];
  let live = segments.filter((s) => s.text);
  const total = () => live.reduce((n, s) => n + wordCount(s.text), 0);
  while (total() > rules.words) {
    const victim = [...live].filter((s) => s.key !== "identity").sort((a, b) => a.priority - b.priority)[0];
    if (!victim) break;
    if (victim.key === "asks" && victim.text.split(/(?<=\.)\s+/).length > 1) {
      const parts = victim.text.split(/(?<=\.)\s+/);
      parts.pop();
      victim.text = parts.join(" ");
      continue;
    }
    live = live.filter((s) => s !== victim);
  }
  return live.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).map((s) => s.text).join(" ");
}

// ---------------------------------------------------------------------------
// Age helpers
// ---------------------------------------------------------------------------

/** A defensible playing range from the job alone, about ten years wide. Marked as an estimate in diagnostics. */
export function estimateAge(name: string): [number, number] {
  const n = name.toLowerCase();
  if (/\b(boy|girl|kid|child|lad)\b/.test(n)) return [10, 15];
  if (/\b(youth|cadet|teen|teenager)\b/.test(n)) return [15, 19];
  if (/\b(elderly|old|grandfather|grandmother|veteran)\b/.test(n)) return [65, 80];
  if (/\b(admiral|general|colonel|commander|judge|senator|president|professor|editor|mayor)\b/.test(n)) return [50, 60];
  if (/\b(captain|major|inspector|sergeant|officer|doctor|engineer|leader|mr|mrs|father|mother)\b/.test(n)) return [35, 50];
  if (/\b(private|soldier|seaman|sailor|nurse|corporal|lieutenant|pilot|student)\b/.test(n)) return [22, 32];
  return [30, 45];
}

/** Keep a model range inside a width the trade would use: 15 years unless the script states an age. */
export function narrowRange(min: number, max: number, width = 15): [number, number] {
  if (max - min <= width) return [min, max];
  const mid = Math.round((min + max) / 2);
  const lo = Math.max(1, mid - Math.floor(width / 2));
  return [lo, lo + width];
}

/**
 * The age is printed from its own field, so any age written into the prose is
 * either a repeat or, when the 8B model slips, a contradiction ("mid-30s" for a
 * character the script says is fifty-nine). Take the whole phrase out.
 *
 * v2.0 removed only the "30s" from "mid-to-late 30s" and left "in his mid-to-,".
 * The phrase now goes as one piece, and a dangling "mid-to-" / "early-" is swept.
 */
export function stripAgeClaims(body: string): string {
  const half = String.raw`(?:early|mid|late)(?:[- ]to[- ](?:early|mid|late)?)?`;
  const decade = String.raw`(?:${half}[- ]?)?\d{1,2}0['’]?s`;
  return (
    body
      // "likely in his mid-to-late 30s or early 40s", "in her early 20s", "mid-30s"
      .replace(new RegExp(String.raw`,?\s*\b(?:likely|probably|possibly|perhaps)?\s*(?:in\s+(?:his|her|their)\s+)?${decade}(?:\s+(?:or|to)\s+${decade})?`, "gi"), "")
      // "in his mid-to-, ..." (what an earlier pass left behind) and any bare half-decade
      .replace(new RegExp(String.raw`,?\s*\b(?:in\s+(?:his|her|their)\s+)?${half}[- ]?(?=[,.;:]|\s+(?:who|and|with|but)\b)`, "gi"), "")
      // "around 12-15 years old", "aged 30 to 40", "35-year-old"
      .replace(/,?\s*\b(?:around|about|roughly|aged?)\s+\d{1,2}(?:\s*(?:to|-)\s*\d{1,2})?(?:[- ]years?[- ]old)?\b/gi, "")
      .replace(/,?\s*\b\d{1,2}(?:\s*(?:to|-)\s*\d{1,2})?[- ]years?[- ]old\b/gi, "")
      // "Young man, 19, in a ..." -> a bare number between commas after a person noun
      .replace(/\b((?:man|woman|boy|girl|lad|youth|kid|male|female)),\s*\d{1,2}\s*,/gi, "$1,")
      // debris: "likely or,", ", ,", " ,"
      .replace(/\b(?:likely|probably|possibly|perhaps)\s+(?:or\s+)?(?=[,.])/gi, "")
      .replace(/,\s*(?:or\s*)?,/g, ",")
      .replace(/\s+([,.])/g, "$1")
      .replace(/,\s*\./g, ".")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

/** Junior ranks and trainees are not in their forties. Applied only when the script gives no age. */
export function clampByRank(name: string, occupation: string, min: number, max: number): [number, number] {
  const n = `${name} ${occupation}`.toLowerCase();
  if (/\b(private|soldier|seaman|sailor|cadet|recruit|conscript|highlander|grenadier|trooper|rookie|student|apprentice|deckhand|survivor|infantry)\b/.test(n) && !/\b(senior|chief|petty|admiral|officer|captain|commander|colonel|major|general|sergeant|master|engineer)\b/.test(n)) {
    const lo = Math.max(min, 18);
    const hi = Math.min(max, 35);
    return hi - lo >= 7 ? [lo, hi] : [18, 30];
  }
  return [min, max];
}

/** True when the occupation shares no word with the role name or the lines the model was shown. */
export function occupationUngrounded(occupation: string, roleName: string, scene: string): boolean {
  const words = occupation.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !["young", "older", "elderly", "senior", "junior", "local", "civilian"].includes(w));
  if (!words.length) return false;
  const hay = `${roleName} ${scene}`.toLowerCase();
  return !words.some((w) => hay.includes(w.slice(0, 5)));
}

const DECADES: Record<string, number> = { twenties: 20, thirties: 30, forties: 40, fifties: 50, sixties: 60, seventies: 70, eighties: 80 };

/** "Dawson (fifties, civilian dress)" or "FARELL (40's, TEXAN)": a decade the script gives, as a [min, max] range. */
export function statedDecade(names: string[], sentences: string[]): [number, number] | null {
  const alt = names.filter(Boolean).map((n) => n.replace(/\./g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (!alt) return null;
  const re = new RegExp(`(?:${alt})\\s*\\(\\s*(?:now\\s+)?(?:(early|mid|late)[- ])?(twenties|thirties|forties|fifties|sixties|seventies|eighties|(\\d)0['’]?s)`, "i");
  for (const raw of sentences) {
    const m = re.exec(raw.replace(/\./g, ""));
    if (!m) continue;
    const base = m[2] && DECADES[m[2].toLowerCase()] ? DECADES[m[2].toLowerCase()] : m[3] ? Number(m[3]) * 10 : 0;
    if (!base) continue;
    const part = (m[1] ?? "").toLowerCase();
    return part === "early" ? [base, base + 4] : part === "mid" ? [base + 3, base + 7] : part === "late" ? [base + 6, base + 9] : [base, base + 9];
  }
  return null;
}
