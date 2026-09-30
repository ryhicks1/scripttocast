/**
 * Removing a watermark from extracted text, and repairing what OCR gets wrong.
 * Pure functions on text and positions: no files, no tools, no logging of text.
 *
 * Three jobs:
 *  - text-layer watermark: a PDF whose text layer holds a name stamped on every
 *    page at an angle. Those items are dropped, but only when the same string
 *    repeats across pages AND sits at a non-axis angle, so script content that
 *    merely repeats (a cue, "CONTINUED") is never touched.
 *  - OCR watermark residue: repeated mid-page lines at variable or identical
 *    positions, and runs of weak short lines laid out along a diagonal.
 *  - OCR cue misreads: a rare cue that is a near-miss of a frequent cue or a
 *    name from the cast list is snapped to it.
 */
import { CUE_INDENT, cueName, looksLikeCue } from "./screenplay";
import type { Line } from "./extract";
import { isRealWord, wordTokens } from "./wordcheck";

// ------------------------------------------------------- text-layer watermark

export interface RawItem {
  str: string;
  x: number;
  y: number;
  /** Rotation of the text baseline in degrees, -180..180. */
  angle: number;
}

/** True for text set at an angle no screenplay uses (not 0, 90, 180 or 270). */
export function isDiagonal(angle: number): boolean {
  const a = Math.abs(((angle % 90) + 90) % 90);
  return Math.min(a, 90 - a) > 5;
}

/**
 * Indexes (per page) of items that belong to a diagonal watermark: a diagonal
 * string that shows up on at least 40% of pages (and at least 3). Returns
 * empty sets for documents with too few pages to be sure.
 */
export function findTextWatermark(pages: RawItem[][]): Set<number>[] {
  const none = pages.map(() => new Set<number>());
  if (pages.length < 3) return none;
  const seen = new Map<string, Set<number>>();
  pages.forEach((items, p) => {
    for (const item of items) {
      if (!isDiagonal(item.angle)) continue;
      const key = item.str.trim().toLowerCase();
      if (!key) continue;
      let set = seen.get(key);
      if (!set) seen.set(key, (set = new Set()));
      set.add(p);
    }
  });
  const need = Math.max(3, Math.ceil(pages.length * 0.4));
  const marks = new Set([...seen].filter(([, set]) => set.size >= need).map(([key]) => key));
  if (!marks.size) return none;
  return pages.map((items) => {
    const out = new Set<number>();
    items.forEach((item, i) => {
      if (isDiagonal(item.angle) && marks.has(item.str.trim().toLowerCase())) out.add(i);
    });
    return out;
  });
}

// ---------------------------------------------------------------- OCR residue

export interface RowLike {
  text: string;
  x: number;
  y: number;
  conf?: number;
}

const normal = (text: string) => text.toLowerCase().replace(/[^a-z]/g, "");
const KEEP_REPEATS = /^(more|continued|contd|beat|cut ?to|fade ?(in|out|to)|the ?end|omitted)$/;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function std(values: number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/**
 * Rows of an OCR'd document that are watermark rather than script.
 *
 * A line is watermark when the same text (letters only) appears on at least 40%
 * of pages (and at least 4), away from the header and footer bands, and its
 * position gives it away: identical on every page, or wandering across the
 * page. A cue or a repeated speech stays in its column and drifts only
 * vertically, so it is kept. Runs of four or more short, weak rows whose
 * positions lie on a diagonal line are removed too: that is stipple read as text.
 */
export function watermarkRows(pages: RowLike[][], pageHeights: number[]): Set<RowLike> {
  const drop = new Set<RowLike>();
  const groups = new Map<string, { page: number; row: RowLike }[]>();
  pages.forEach((rows, page) => {
    const height = pageHeights[page] ?? 792;
    for (const row of rows) {
      if (row.y > height * 0.9 || row.y < height * 0.08) continue;
      const key = normal(row.text);
      if (key.length < 4 || KEEP_REPEATS.test(key)) continue;
      const list = groups.get(key);
      if (list) list.push({ page, row });
      else groups.set(key, [{ page, row }]);
    }
  });
  const need = Math.max(4, Math.ceil(pages.length * 0.4));
  for (const [key, list] of groups) {
    if (new Set(list.map((e) => e.page)).size < need) continue;
    const xs = list.map((e) => e.row.x);
    const ys = list.map((e) => e.row.y);
    // Robust to a few strays: a cue that OCR pushed left by a junk prefix is
    // still a cue. Wandering means most instances are NOT in one column.
    const mid = median(xs);
    const inColumn = xs.filter((x) => Math.abs(x - mid) < 18).length / xs.length;
    const wandering = inColumn < 0.5 && std(xs) > 30;
    // Identical position on every page is proof only for a long line: a short cue
    // can land on the same spot by chance, a whole sentence cannot.
    const fixed = std(xs) < 6 && std(ys) < 6 && key.length >= 10;
    if (wandering || fixed) for (const e of list) drop.add(e.row);
  }

  for (const rows of pages) {
    const weak = rows.filter((r) => {
      const tokens = wordTokens(r.text);
      const real = tokens.filter(isRealWord).length;
      return r.text.trim().length <= 24 && tokens.length <= 3 && real / Math.max(1, tokens.length) < 0.6 && (r.conf ?? 0) < 75;
    });
    if (weak.length < 4) continue;
    const sorted = [...weak].sort((a, b) => a.y - b.y);
    // Greedy: extend a run while x moves the same way as y.
    for (let i = 0; i + 3 < sorted.length; i++) {
      const run = [sorted[i]];
      for (let j = i + 1; j < sorted.length; j++) {
        const last = run[run.length - 1];
        if (sorted[j].y - last.y > 4 && Math.abs(sorted[j].x - last.x) > 8) run.push(sorted[j]);
      }
      if (run.length < 4) continue;
      const dx = run[run.length - 1].x - run[0].x;
      const dy = run[run.length - 1].y - run[0].y;
      if (Math.abs(dx) < 100 || dy < 100) continue;
      const slope = dy / dx;
      const fits = run.filter((r) => Math.abs(r.y - run[0].y - slope * (r.x - run[0].x)) < 30).length;
      if (fits >= 4 && fits >= run.length * 0.8) for (const r of run) drop.add(r);
    }
  }
  return drop;
}

// ------------------------------------------------------------------ cue snap

// Letters tesseract confuses in this face. A swap inside a group costs half.
const CONFUSABLE = ["PF", "RH", "TI", "IL", "TL", "HB", "HE", "OQ", "OC", "CG", "EF", "UV", "RA", "MN", "S5", "O0", "ZI", "1I"];
const confusable = (a: string, b: string) => CONFUSABLE.some((g) => g.includes(a) && g.includes(b));

/** Edit distance where OCR-typical swaps are cheap. */
export function ocrDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const sub = a[i - 1] === b[j - 1] ? 0 : confusable(a[i - 1], b[j - 1]) ? 0.5 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub);
    }
    prev = cur;
  }
  return prev[n];
}

const isNameToken = (t: string) => /^[A-Z][A-Z'’.-]*$/.test(t) && /[A-Z]{2}/.test(t);
const isQualifier = (t: string) => /^\(.*\)?$/.test(t) && t.length > 1;
const isJunkToken = (t: string) => !/[A-Za-z]{4,}/.test(t) && !isNameToken(t);

/**
 * OCR leaves stipple fragments beside cues ("ISAAC 2", "SAMANTHA ,", "JAY oo",
 * "| . DAN"), which stops the line reading as a cue. On a line at a cue indent
 * that begins (after stray marks) with an upper-case name, drop the leading
 * and trailing tokens that are short, lower-case or punctuation. In place;
 * returns the number of lines changed. Names, qualifiers and real upper-case
 * words are never removed.
 */
export function cleanCueLines(pageLines: Line[][]): number {
  let changed = 0;
  for (const lines of pageLines) {
    for (const line of lines) {
      if (line.indent < CUE_INDENT) continue;
      const tokens = line.text.trim().split(/\s+/);
      if (tokens.length < 2) continue;
      let start = 0;
      while (start < tokens.length && isJunkToken(tokens[start])) start++;
      let end = tokens.length;
      while (end > start + 1 && isJunkToken(tokens[end - 1]) && !isQualifier(tokens[end - 1])) end--;
      const kept = tokens.slice(start, end);
      if (!kept.length || !isNameToken(kept[0].replace(/^[^A-Z]+/, "")) || (start === 0 && end === tokens.length)) continue;
      // Only when what is left is a cue: names, "/", "&", qualifiers.
      const text = kept.join(" ");
      if (!kept.every((t) => isNameToken(t) || isQualifier(t) || t === "/" || t === "&")) continue;
      if (text !== line.text) {
        line.text = text;
        changed++;
      }
    }
  }
  return changed;
}

export interface CueFix {
  from: string;
  to: string;
  count: number;
}

/** How far a misread may be from the right name, by name length. */
function cueLimit(length: number): number {
  return length <= 3 ? 0.5 : length <= 5 ? 1 : length <= 8 ? 1.5 : 2;
}

/** A cast entry that reads like a name: letters and spaces, no stray one-letter words. */
function cleanCastName(name: string): boolean {
  return /^[A-Z]{3,}(?: [A-Z]{2,})*$/.test(name);
}

/** Trailing junk tokens of one or two letters, which OCR adds after a cue ("THORP TI"). */
function headOf(name: string): string {
  const tokens = name.split(" ");
  while (tokens.length > 1 && tokens[tokens.length - 1].length <= 3) tokens.pop();
  return tokens.join(" ").replace(/[^A-Z ]/g, "");
}

/**
 * Snap misread cues to the right name, in place. Only lines at a cue indent
 * that read like cues are considered ("A / B" dual cues are handled per name).
 *
 * The cast list is the reference. It is OCR too, so an entry is used only if it
 * reads like a name (one stray letter such as "FICWER W" disqualifies it). A
 * name that is itself a clean cast entry is never rewritten. Anything else is
 * rewritten to the closest reference name within the ocrDistance limit: the
 * clean cast names, plus names the script itself repeats at least twice and at
 * least twice as often as the misread (for characters the cast list mangled).
 * Repeating a misreading many times does not make it right: "SETTY" seven times
 * still becomes the cast list's "HETTY". Chains are resolved (SNANTEA to
 * SAMANTEA to SAMANTHA). A mangled tail is matched by leading letters.
 */
export function snapCues(pageLines: Line[][], castNames: string[]): CueFix[] {
  const cues: { line: Line; parts: string[] }[] = [];
  for (const lines of pageLines) {
    for (const line of lines) {
      if (line.indent < CUE_INDENT) continue;
      // Stray marks in front of a cue ("| ISAAC") come from stipple and page edges.
      const cleaned = line.text.replace(/^[^A-Za-z0-9(]+/, "").trim();
      if (!looksLikeCue(cleaned)) continue;
      const parts = cueName(cleaned)
        .toUpperCase()
        .split(/\s*[\/&]\s*/)
        .map((part) => part.replace(/[^A-Z' -]/g, "").replace(/\s+/g, " ").trim())
        .filter((part) => part.length >= 2);
      if (parts.length) {
        line.text = cleaned;
        cues.push({ line, parts });
      }
    }
  }
  const counts = new Map<string, number>();
  for (const cue of cues) for (const part of cue.parts) counts.set(part, (counts.get(part) ?? 0) + 1);

  // The cast list is OCR too. Names also appear in capitals in the action
  // ("THORFINN, ISAAC and HETTY."), and that second reading repairs the list:
  // an entry that is a near-miss of such a word (or a split of it) is replaced.
  const actionCaps = new Map<string, number>();
  pageLines.slice(2).forEach((lines) => {
    for (const line of lines) {
      if (line.indent >= CUE_INDENT) continue;
      for (const token of line.text.match(/\b[A-Z]{4,}\b/g) ?? []) {
        actionCaps.set(token, (actionCaps.get(token) ?? 0) + 1);
      }
    }
  });
  const repairWord = (word: string): string => {
    if (actionCaps.has(word)) return word;
    let best: { name: string; cost: number; n: number } | null = null;
    for (const [other, n] of actionCaps) {
      if (Math.abs(other.length - word.length) > 1) continue;
      const cost = ocrDistance(word, other);
      if (cost <= 1 && (!best || cost < best.cost || (cost === best.cost && n > best.n))) best = { name: other, cost, n };
    }
    return best ? best.name : word;
  };
  const repaired = (entry: string): string => {
    const tokens = entry.split(" ");
    // "THORF INN": one name split in two, and the joined word is used in the action.
    if (tokens.length === 2 && actionCaps.has(tokens.join("")) && tokens.some((t) => t.length <= 4)) return tokens.join("");
    // Longer entries ("CHOLERA VICTIM MATHAN") are repaired word by word, last word only:
    // the leading words are common English and the name is the part OCR mangles.
    if (tokens.length > 1) tokens[tokens.length - 1] = repairWord(tokens[tokens.length - 1]);
    else tokens[0] = repairWord(tokens[0]);
    return tokens.join(" ");
  };
  const cast = new Set(castNames.map((n) => n.toUpperCase()));
  const reference = new Set([...cast].map(repaired).filter(cleanCastName));
  for (const name of [...cast]) if (!reference.has(repaired(name))) cast.delete(name);
  for (const name of reference) cast.add(name);
  const matches = (name: string, candidate: string): number => {
    if (Math.abs(candidate.length - name.length) <= 2) {
      const d = ocrDistance(name, candidate);
      if (d <= cueLimit(Math.min(name.length, candidate.length))) return d;
    }
    // A mangled tail: compare the leading letters only.
    const head = headOf(name);
    if (candidate.length >= 7 && head.length >= 4 && head.length < candidate.length) {
      const d = ocrDistance(head, candidate.slice(0, head.length));
      if (d <= Math.max(1, head.length * 0.3)) return d + 1;
    }
    return Infinity;
  };

  const fixes = new Map<string, CueFix>();
  for (const [name, count] of counts) {
    if (reference.has(name)) continue;
    let best: { name: string; cost: number } | null = null;
    // "JAY SO": a short junk tail after a real name.
    const head = headOf(name);
    if (head !== name && reference.has(head)) {
      fixes.set(name, { from: name, to: head, count });
      continue;
    }
    // "THORF INN": OCR split one name in two. Joined, it may already be a name.
    const joined = name.replace(/ /g, "");
    if (joined !== name && reference.has(joined)) {
      fixes.set(name, { from: name, to: joined, count });
      continue;
    }
    const pool = new Set<string>(reference);
    for (const [other, n] of counts) if (n >= 2 && n >= count * 2 && !cast.has(other)) pool.add(other);
    for (const candidate of pool) {
      if (candidate === name) continue;
      const cost = matches(name, candidate);
      // A name spoken many times needs a very close match before it is called a misread.
      if (count >= 5 && cost > 1) continue;
      if (cost < Infinity && (!best || cost < best.cost)) best = { name: candidate, cost };
    }
    if (best) fixes.set(name, { from: name, to: best.name, count });
  }
  const resolve = (name: string): string => {
    let cur = name;
    for (let i = 0; i < 4 && fixes.has(cur); i++) cur = fixes.get(cur)!.to;
    return cur;
  };
  for (const fix of fixes.values()) fix.to = resolve(fix.to);

  // OCR sometimes places a cue a little left of its column (its first word read
  // late), which would make it dialogue. An upper-case line that is exactly a
  // known name, sitting between the dialogue and cue columns, goes back to the
  // cue column. Only names; qualifiers allowed; nothing else is moved.
  const cueIndents = cues.map((c) => c.line.indent).sort((a, b) => a - b);
  const cueColumn = cueIndents.length >= 5 ? cueIndents[Math.floor(cueIndents.length / 2)] : 0;
  if (cueColumn >= CUE_INDENT) {
    const names = new Set([...reference, ...[...counts].filter(([, n]) => n >= 3).map(([name]) => name)]);
    for (const lines of pageLines) {
      for (const line of lines) {
        if (line.indent >= CUE_INDENT || line.indent < CUE_INDENT * 0.75) continue;
        const text = line.text.replace(/^[^A-Za-z0-9(]+/, "").trim();
        if (!looksLikeCue(text)) continue;
        const parts = cueName(text).toUpperCase().split(/\s*[\/&]\s*/);
        if (parts.every((part) => names.has(fixes.get(part)?.to ?? part))) {
          line.text = text;
          line.indent = cueColumn;
          cues.push({ line, parts });
        }
      }
    }
  }

  for (const cue of cues) {
    if (!cue.parts.some((part) => fixes.has(part))) continue;
    const cleaned = cue.line.text.replace(/^[^A-Za-z0-9(]+/, "").trim();
    const qualifier = /\s*\([^)]*\)?\s*$/.exec(cleaned)?.[0] ?? "";
    cue.line.text = cue.parts.map((part) => fixes.get(part)?.to ?? part).join(" / ") + qualifier;
  }
  return [...fixes.values()];
}

const SCENE_TOKENS: [string, string][] = [["INT", "INT."], ["EXT", "EXT."]];

/**
 * Scene headings OCR'd from a numbered script: "1 THT. HOUSE - DAY (D3) 1".
 * Numbers in both margins are stripped (the parser looks for a heading that
 * starts with INT./EXT.) and a badly read INT/EXT is repaired when the rest of
 * the line still looks like a slugline: upper case, a " - " time-of-day split.
 * In place; returns how many lines were changed.
 */
export function repairSceneHeadings(pageLines: Line[][]): number {
  let changed = 0;
  for (const lines of pageLines) {
    for (const line of lines) {
      if (line.indent >= CUE_INDENT) continue;
      // Quote marks and stipple between the margin number and the heading are noise.
      const raw = line.text.trim().replace(/^(\d{1,3}[A-Z]?)\s+[^A-Za-z0-9(]+/, "$1 ");
      const compound = /^(?:(\d{1,3}[A-Z]?)\s+)?((?:INT|EXT)[.,]?\/(?:INT|EXT)[.,]?)\s+(\S.*?)(?:\s+(\d{1,3}[A-Z]?))?$/.exec(raw);
      if (compound && (compound[1] || compound[4]) && compound[3].includes(" - ")) {
        const text = `${compound[2].replace(/,/g, ".")} ${compound[3]}`;
        if (text !== line.text) {
          line.text = text;
          changed++;
        }
        continue;
      }
      const m = /^(?:(\d{1,3}[A-Z]?)\s+)?([A-Za-z(]{2,4})[.,?]?\s+(\S.*?)(?:\s+(\d{1,3}[A-Z]?))?$/.exec(raw);
      if (!m || !(m[1] || m[4])) continue;
      const rest = m[3];
      const letters = rest.replace(/[^A-Za-z]/g, "");
      if (letters.length < 8 || !rest.includes(" - ")) continue;
      const upper = letters.replace(/[^A-Z]/g, "").length / letters.length;
      if (upper < 0.85) continue;
      const token = m[2].replace(/[^A-Za-z]/g, "").toUpperCase();
      let best = { token: "", cost: 9 };
      for (const [name, out] of SCENE_TOKENS) {
        const cost = ocrDistance(token, name);
        if (cost < best.cost) best = { token: out, cost };
      }
      if (best.cost > 2) continue;
      const text = `${best.token} ${rest}`;
      if (text !== line.text) {
        line.text = text;
        changed++;
      }
    }
  }
  return changed;
}

/** All-caps words of 3+ letters on the first pages: the cast list and title lines. */
export function castNamesFrom(pageLines: Line[][], pages = 3): string[] {
  const names = new Set<string>();
  // The page headed "CAST" when there is one; otherwise the first few pages.
  const front = pageLines.slice(0, pages);
  const castPage = front.find((lines) => lines.slice(0, 6).some((line) => /\bCAST\b/i.test(line.text)));
  for (const lines of castPage ? [castPage] : front) {
    for (const line of lines) {
      const text = line.text.trim();
      // A name, or a name then the actor: take the leading run of capitals.
      const lead = /^[A-Z][A-Z'.-]*(?: [A-Z][A-Z'.-]*){0,2}/.exec(text)?.[0];
      if (lead && lead.length >= 3 && lead.length <= 30) names.add(lead.replace(/[.'-]+$/, ""));
    }
  }
  return [...names];
}
