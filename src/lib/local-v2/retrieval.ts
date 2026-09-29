/**
 * Local retrieval of real breakdown entries, for tone and structure.
 *
 * The bank is Breakdown Services text, marked confidential. It is NEVER in this
 * repository. It is read from a file on this machine named by S2C_FEWSHOT_BANK
 * (or ~/.scripttocast/fewshot-bank.LOCAL-CONFIDENTIAL.json), held in memory for
 * the run, and the few entries that match a role are placed in that one
 * role's prompt to the local model. Nothing is written anywhere and nothing
 * leaves the machine; the only consumer is loopback Ollama.
 *
 * Ranking is plain BM25 over the entry text, plus small bonuses for the same
 * tier, a consistent gender and an age range that covers the stated age.
 * No model, no embeddings, no network.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { V2Tier } from "./cast";

export interface BankEntry {
  id: number;
  name: string;
  tier: string;
  text: string;
  words: number;
  /** Prose without the head or production lines: what the model sees. Filled by buildBank. */
  prose?: string;
  plotHeavy?: boolean;
  garbled?: boolean;
  headOk?: boolean;
}

export interface Bank {
  path: string;
  entries: BankEntry[];
  tokens: string[][];
  idf: Map<string, number>;
  avgLen: number;
}

const STOP = new Set(
  "the a an and or of to in on at for with as is are was were be been by from that this it its his her their he she they them who whom which but not no so than then into out up down over under about also very more most one two can will would should must may might have has had do does did just only both each any all some such".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [])
    .map((w) => w.replace(/'s$/, "").replace(/(?<=[a-z]{4})s$/, ""))
    .filter((w) => !STOP.has(w));
}

let cached: { path: string; bank: Bank | null; error?: string } | null = null;

export function bankPath(): string {
  return process.env.S2C_FEWSHOT_BANK?.trim() || join(homedir(), ".scripttocast", "fewshot-bank.LOCAL-CONFIDENTIAL.json");
}

export function retrievalEnabled(): boolean {
  const v = process.env.OLLAMA_V2_RETRIEVAL?.trim().toLowerCase();
  return v === undefined || v === "" ? true : !["0", "false", "off", "no"].includes(v);
}

/**
 * What the model is shown from a real entry: the prose after the "Man; 30 to 40
 * years old; all ethnicities." head, with production lines (rate, union, local
 * hire, scene counts, tier tag) cut off. The head is left out on purpose: the
 * model must not copy an ethnicity or an age from a stranger's entry.
 */
export function proseOf(text: string): string {
  return text
    .replace(/^[^.]*?\d+\s*(?:to|-)\s*\d+\s*years old[^.]*\.\s*/i, "")
    .replace(/^(?:Man|Woman|Male|Female|Boy|Girl|Any gender)[^.]{0,80}\.\s*/i, "")
    .replace(/\s*\.{2,}\s*(?:[A-Z ,/]+)?(?:SUPPORTING|LEAD|DAY ?PLAYER)[^]*$/i, ".")
    .replace(/\s*\(\d+\s*(?:scenes?|lines?|days?)[^)]*\)\.?/gi, "")
    .replace(/\s*(?:SAG|Must be based|Must be LA|LOOKING FOR|PLEASE|Rate|Day Rate|Talent must)[^]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildBank(raw: unknown, path = "(memory)"): Bank {
  const list = Array.isArray(raw) ? (raw as BankEntry[]) : [];
  const entries = list
    .filter(
      (e) => e && typeof e.text === "string" && !e.plotHeavy && !e.garbled && e.headOk !== false && e.words >= 12 && e.words <= 110 &&
        /^(Man|Woman|Boy|Girl|Any gender)[;,]/.test(e.text),
    )
    .map((e) => ({ ...e, prose: proseOf(e.text) }))
    .filter((e) => e.prose.split(/\s+/).length >= 6);
  const tokens = entries.map((e) => tokenize(e.prose ?? e.text));
  const df = new Map<string, number>();
  for (const t of tokens) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = entries.length || 1;
  const idf = new Map<string, number>();
  for (const [w, d] of df) idf.set(w, Math.log(1 + (n - d + 0.5) / (d + 0.5)));
  const avgLen = tokens.reduce((s, t) => s + t.length, 0) / n || 1;
  return { path, entries, tokens, idf, avgLen };
}

/** Null when the flag is off or the file is missing; the reason is in `error`. */
export function loadBank(): { bank: Bank | null; error?: string } {
  const path = bankPath();
  if (cached && cached.path === path) return cached;
  if (!existsSync(path)) {
    cached = { path, bank: null, error: `no bank file at ${path}` };
    return cached;
  }
  try {
    const bank = buildBank(JSON.parse(readFileSync(path, "utf8")), path);
    cached = { path, bank: bank.entries.length ? bank : null, error: bank.entries.length ? undefined : "bank has no usable entries" };
  } catch (e) {
    cached = { path, bank: null, error: `bank unreadable: ${e instanceof Error ? e.message : String(e)}` };
  }
  return cached;
}

export interface Query {
  text: string;
  tier: V2Tier;
  gender: "Male" | "Female" | null;
  age: number | null;
}

const TIER_BONUS = 1.2;

function ageCovers(text: string, age: number): boolean {
  const m = /(\d{1,2}) to (\d{1,2}) years old/.exec(text);
  return !!m && age >= Number(m[1]) - 1 && age <= Number(m[2]) + 1;
}

export function retrieve(bank: Bank, q: Query, k: number, exclude: RegExp | null = null): BankEntry[] {
  const qt = tokenize(q.text);
  const tf = new Map<string, number>();
  for (const w of qt) tf.set(w, (tf.get(w) ?? 0) + 1);
  const K1 = 1.2;
  const B = 0.75;
  const scored: { e: BankEntry; s: number }[] = [];
  bank.entries.forEach((e, i) => {
    const head = /^(Man|Male|Men|Boy)\b/i.test(e.text) ? "Male" : /^(Woman|Female|Women|Girl)\b/i.test(e.text) ? "Female" : "Any";
    if (q.gender && head !== "Any" && head !== q.gender) return;
    if (exclude && exclude.test(e.prose ?? e.text)) return;
    const doc = bank.tokens[i];
    const counts = new Map<string, number>();
    for (const w of doc) counts.set(w, (counts.get(w) ?? 0) + 1);
    let s = 0;
    for (const [w, qf] of tf) {
      const f = counts.get(w);
      if (!f) continue;
      const idf = bank.idf.get(w) ?? 0;
      s += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * doc.length) / bank.avgLen))) * Math.min(2, qf);
    }
    if (e.tier === q.tier) s += TIER_BONUS;
    else if (e.tier === "NONE") s -= 0.2;
    else s -= 0.4;
    if (q.age !== null && ageCovers(e.text, q.age)) s += 0.8;
    scored.push({ e, s });
  });
  scored.sort((a, b) => b.s - a.s || a.e.id - b.e.id);
  // Spread: never two entries that begin with the same three words.
  const out: BankEntry[] = [];
  const seen = new Set<string>();
  for (const { e } of scored) {
    const key = (e.prose ?? e.text).split(/\s+/).slice(0, 6).join(" ").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= k) break;
  }
  return out;
}
