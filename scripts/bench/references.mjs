/**
 * Reading the reference breakdowns — the ones clients wrote for real, and
 * provided to develop this tool — into roles that can be compared field by
 * field.
 *
 * Breakdowns arrive in whatever shape a casting office uses, so this is
 * deliberately forgiving, and `npm run bench:inspect` exists to show exactly
 * what it made of each one. Check that before trusting a score: a role the
 * parser missed reads as a role the tool missed.
 *
 * Each project is a folder holding the script PDF and the breakdown, as
 * .txt / .md / .pdf, or as .json when a format defeats the parser:
 *
 *   { "roles": [ { "name": "", "gender": "", "age": "", "roleType": "", "description": "" } ] }
 *
 * Word files: save as PDF or plain text first.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

export const ROLE_TYPES = [
  "SERIES REGULAR",
  "RECURRING",
  "GUEST STAR",
  "CO-STAR",
  "LEAD",
  "SUPPORTING",
  "DAY PLAYER",
  "FEATURED",
  "UNDER 5",
  "PRINCIPAL",
];

/** Lead / supporting / day player, whatever the office called it. */
export function tierOf(roleType) {
  const t = (roleType ?? "").toUpperCase();
  if (/LEAD|REGULAR/.test(t)) return "LEAD";
  if (/DAY|CO-?STAR|UNDER ?5|FEATURED|BIT/.test(t)) return "DAY PLAYER";
  if (t) return "SUPPORTING";
  return "";
}

const GENDER = /\b(male|female|man|woman|men|women|boy|girl|non-?binary|any gender|all genders|gender ?fluid|gender non-?conforming)\b/i;

export function genderOf(text) {
  const m = (text ?? "").match(GENDER);
  if (!m) return "";
  const g = m[1].toLowerCase();
  if (/^(male|man|men|boy)$/.test(g)) return "male";
  if (/^(female|woman|women|girl)$/.test(g)) return "female";
  return "any";
}

/**
 * An age range as [low, high], from "35-45", "35 to 45", "30s", "late 40s",
 * "mid 20s to early 30s", "18+". Empty when there is none.
 */
export function ageRangeOf(text) {
  const t = (text ?? "").toLowerCase();
  const range = t.match(/\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\b/);
  if (range) return [Number(range[1]), Number(range[2])];
  const decades = [...t.matchAll(/\b(early|mid|late)?[\s-]*(\d)0'?s\b/g)];
  if (decades.length) {
    const bounds = decades.map(([, part, d]) => {
      const base = Number(d) * 10;
      if (part === "early") return [base, base + 4];
      if (part === "mid") return [base + 3, base + 7];
      if (part === "late") return [base + 6, base + 9];
      return [base, base + 9];
    });
    return [Math.min(...bounds.map((b) => b[0])), Math.max(...bounds.map((b) => b[1]))];
  }
  const plus = t.match(/\b(\d{1,2})\s*\+/);
  if (plus) return [Number(plus[1]), 99];
  const single = t.match(/\b(\d{1,2})\s*(?:years?\s*old|yo)\b/);
  if (single) return [Number(single[1]), Number(single[1])];
  return [];
}

function roleTypeIn(text) {
  const upper = (text ?? "").toUpperCase();
  return ROLE_TYPES.find((type) => upper.includes(type)) ?? "";
}

/**
 * Split breakdown text into role entries. A role starts at a header: a name in
 * square brackets, or a line that is a name in capitals, optionally followed by
 * a colon, a dash or the start of the description on the same line.
 */
export function parseBreakdownText(raw) {
  const text = raw.replace(/\r/g, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const header =
    /^\s*(?:\[\s*([^\]\n]{2,60}?)\s*\]|([A-Z][A-Z0-9 .'"()&/-]{1,50}?)\s*(?::|—|–|\s-\s|$))\s*(.*)$/;
  const roles = [];
  let current = null;
  for (const line of text.split("\n")) {
    const m = line.match(header);
    const candidate = m && (m[1] ?? m[2])?.trim();
    const looksLikeName =
      candidate &&
      candidate.split(/\s+/).length <= 6 &&
      !/^(INT|EXT|PROJECT|CASTING|SUBMISSION|RATE|DATES?|LOCATION|UNION|NOTES?|SYNOPSIS|STORYLINE|ROLES?)\b/i.test(candidate) &&
      (m[1] !== undefined || candidate === candidate.toUpperCase());
    if (looksLikeName) {
      current = { name: candidate.replace(/["()]/g, "").trim(), body: m[3] ?? "" };
      roles.push(current);
    } else if (current && line.trim()) {
      current.body += ` ${line.trim()}`;
    }
  }
  return roles
    .map(({ name, body }) => ({
      name,
      gender: genderOf(body),
      age: ageRangeOf(body),
      roleType: roleTypeIn(body),
      description: body.trim(),
    }))
    .filter((role) => role.description.split(/\s+/).length >= 4);
}

async function textOfPdf(path) {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(path)));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** One project folder: its script and its reference roles. */
export async function loadProject(dir) {
  const files = readdirSync(dir).filter((f) => !f.startsWith("."));
  const pdfs = files.filter((f) => extname(f).toLowerCase() === ".pdf");
  const isBreakdown = (f) => /breakdown|roles|casting/i.test(f);
  const script = pdfs.find((f) => !isBreakdown(f)) ?? null;
  const reference =
    files.find((f) => isBreakdown(f) && /\.(json|txt|md)$/i.test(f)) ??
    pdfs.find((f) => isBreakdown(f) && f !== script) ??
    null;
  const project = { name: basename(dir), dir, script: script && join(dir, script), reference: reference && join(dir, reference), roles: [] };
  if (!reference) return project;

  const path = join(dir, reference);
  if (/\.json$/i.test(reference)) {
    const data = JSON.parse(readFileSync(path, "utf8"));
    project.roles = (data.roles ?? []).map((r) => ({
      name: r.name,
      gender: genderOf(r.gender ?? r.description),
      age: ageRangeOf(r.age ?? r.description),
      roleType: (r.roleType ?? roleTypeIn(r.description)).toUpperCase(),
      description: r.description ?? "",
    }));
  } else {
    const text = /\.pdf$/i.test(reference) ? await textOfPdf(path) : readFileSync(path, "utf8");
    project.roles = parseBreakdownText(text);
  }
  return project;
}

/** Every project folder under the data directory. */
export async function loadProjects(dataDir) {
  const dirs = readdirSync(dataDir)
    .map((d) => join(dataDir, d))
    .filter((d) => statSync(d).isDirectory())
    .sort();
  const projects = [];
  for (const dir of dirs) projects.push(await loadProject(dir));
  return projects;
}

/**
 * Tune or holdout, fixed per project. Decided by the folder name, so adding a
 * project never moves another one between sets — the holdout stays unseen.
 */
export function splitOf(name, holdoutShare = 0.3) {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h / 2 ** 32 < holdoutShare ? "holdout" : "tune";
}

/** Loose name match: "Dom Cobb" and "COBB" are the same role. */
export function sameRole(a, b) {
  const words = (s) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1);
  const x = words(a);
  const y = words(b);
  if (!x.length || !y.length) return false;
  return x.every((w) => y.includes(w)) || y.every((w) => x.includes(w));
}
