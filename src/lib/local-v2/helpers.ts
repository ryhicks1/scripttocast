/**
 * Pure helpers for the v2 pipeline: no Ollama, no Next, nothing that needs a
 * server. Kept apart so scripts/check-local-v2.mjs can import them directly.
 */

export interface RoleReply {
  gender: string;
  ageMin: number;
  ageMax: number;
  ethnicity: string;
  description: string;
  traits: string[];
}

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;

export function validateReply(raw: unknown): { ok: true; reply: RoleReply } | { ok: false; why: string } {
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
  if (max - min > 30) return { ok: false, why: "the age range is wider than 30 years; narrow it" };
  const description = clean(r.description);
  if (wordCount(description) < 6) return { ok: false, why: "the description is empty or a fragment; write it in full sentences" };
  if (!Array.isArray(r.traits)) return { ok: false, why: "traits must be an array" };
  return {
    ok: true,
    reply: {
      gender: String(r.gender),
      ageMin: min,
      ageMax: max,
      ethnicity: clean(r.ethnicity),
      description,
      traits: (r.traits as unknown[]).map(clean).filter(Boolean).slice(0, 6),
    },
  };
}

/** A defensible playing range from the job alone. Marked as an estimate in diagnostics. */
export function estimateAge(name: string): [number, number] {
  const n = name.toLowerCase();
  if (/\b(boy|girl|kid|child|lad)\b/.test(n)) return [10, 15];
  if (/\b(youth|cadet|teen|teenager)\b/.test(n)) return [15, 19];
  if (/\b(elderly|old|grandfather|grandmother|veteran)\b/.test(n)) return [65, 85];
  if (/\b(admiral|general|colonel|commander|judge|senator|president|professor|editor|mayor)\b/.test(n)) return [45, 65];
  if (/\b(captain|major|inspector|sergeant|officer|doctor|engineer|leader|mr|mrs|father|mother)\b/.test(n)) return [30, 55];
  if (/\b(private|soldier|seaman|sailor|nurse|corporal|lieutenant|pilot|student)\b/.test(n)) return [20, 35];
  return [25, 45];
}

/**
 * The age is printed from its own field, so any age written into the prose is
 * either a repeat or, when the 8B model slips, a contradiction ("mid-30s" for a
 * character the script says is fifty-nine). Take it out of the prose.
 */
export function stripAgeClaims(body: string): string {
  const decade = String.raw`(?:(?:early|mid|late)[- ])?\d{1,2}0s`;
  return body
    // "likely in his 30s or 40s", "in her early 20s", "mid-30s"
    .replace(new RegExp(String.raw`,?\s*\b(?:likely|probably|possibly|perhaps)?\s*(?:in\s+(?:his|her|their)\s+)?${decade}(?:\s+(?:or|to)\s+${decade})?`, "gi"), "")
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
    .trim();
}
