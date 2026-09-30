/**
 * Local OCR for scanned and watermarked scripts. Nothing here leaves the Mac.
 *
 * Scripts arrive as scans, and the agencies that circulate them stamp a
 * person's name across every page as a dense grey stipple. Raw OCR reads the
 * stipple as text and scrambles the page. The image work (blur, then a per-page
 * cut chosen from the page's own histogram) is in ocr-image.ts. This file runs
 * it page by page and picks, per page, the attempt with the most real words:
 *
 *   1. Render the page (pdftoppm applies /Rotate, so pages stored upside down
 *      come out upright), blur, cut at the estimated threshold, OCR.
 *   2. Mostly real words: keep. Otherwise flip 180 degrees, then ask tesseract's
 *      orientation detector, then try other cuts and a heavier blur.
 *
 * Handling of files: the upload goes once into a private (0700) temp dir, pages
 * are rendered one at a time and deleted as soon as they are read, the cleaned
 * page goes to tesseract on stdin (never a file), and the directory is removed
 * in `finally`, including on error. Tools run through execFile with argument
 * arrays. Script text is never logged and error messages never carry it.
 */
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  binarize, candidateThresholds, gaussianBlur, inkFraction, parsePgm, toPbm,
  type Gray, type Rotation,
} from "./ocr-image";
import { wordStats, type WordStats } from "./wordcheck";

/** A line as OCR saw it, in PDF points. */
export interface OcrRow {
  text: string;
  x: number;
  /** Baseline from the bottom of the page. */
  y: number;
  /** Mean word confidence, 0 to 100. */
  conf: number;
  /** Height of the tallest word in points, for diagonal-watermark tests. */
  size: number;
}

export interface OcrPageReport {
  threshold: number;
  passes: number;
  rotation: number;
  ratio: number;
  words: number;
  blank: boolean;
}

export interface OcrResult {
  pages: OcrRow[][];
  reports: OcrPageReport[];
  ms: number;
}

export type OcrProgress = (done: number, total: number) => void;

export class OcrUnavailableError extends Error {
  constructor(readonly missing: string[]) {
    super(`OCR needs ${missing.join(" and ")} (brew install poppler tesseract)`);
    this.name = "OcrUnavailableError";
  }
}

const DPI = 300;
const PT_PER_PX = 72 / DPI;
const MAX_PAGES = 250;
const TOOL_TIMEOUT_MS = 120_000;
const CONCURRENCY = 3;
const SEARCH_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
/** A page above this share of real words is good enough; stop trying cuts. */
const GOOD_RATIO = 0.75;
/** Fewer words than this and a ratio means nothing (title pages, near-blank pages). */
const MIN_JUDGED_WORDS = 20;

/** OCR is on unless LOCAL_OCR is 0, false, off or no. */
export function ocrEnabled(): boolean {
  const flag = (process.env.LOCAL_OCR ?? "").trim().toLowerCase();
  return !(flag === "0" || flag === "false" || flag === "off" || flag === "no");
}

const toolCache = new Map<string, string | null>();
export function findTool(name: string): string | null {
  const cached = toolCache.get(name);
  if (cached !== undefined) return cached;
  const dirs = [...(process.env.PATH ?? "").split(delimiter), ...SEARCH_DIRS];
  let found: string | null = null;
  for (const dir of dirs) {
    if (!dir) continue;
    try {
      const candidate = join(dir, name);
      accessSync(candidate, constants.X_OK);
      found = candidate;
      break;
    } catch {
      // Not in this directory.
    }
  }
  toolCache.set(name, found);
  return found;
}

export function ocrToolsMissing(): string[] {
  return [findTool("pdftoppm") ? "" : "poppler", findTool("tesseract") ? "" : "tesseract"].filter(Boolean);
}

function run(file: string, args: string[], input?: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        timeout: TOOL_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
        // One tesseract thread per process; parallelism comes from running pages side by side.
        env: {
          ...process.env,
          OMP_THREAD_LIMIT: "1",
          PATH: [...(process.env.PATH ?? "").split(delimiter), ...SEARCH_DIRS].join(delimiter),
        },
      },
      (error, stdout) => {
        // Generic on purpose: stderr and arguments can hold file names or text.
        if (error) reject(new Error(`${file.split("/").pop()} failed`));
        else resolve(stdout);
      },
    );
    if (input) {
      child.stdin?.on("error", () => {});
      child.stdin?.end(input);
    }
  });
}

// -------------------------------------------------------------- OCR reading

interface TsvWord {
  key: string;
  left: number;
  top: number;
  height: number;
  conf: number;
  text: string;
}

function parseTsv(tsv: string): TsvWord[] {
  const words: TsvWord[] = [];
  for (const line of tsv.split("\n")) {
    const c = line.split("\t");
    if (c.length < 12 || c[0] !== "5") continue;
    const text = c.slice(11).join("\t").trim();
    const conf = Number(c[10]);
    if (!text || !(conf >= 0)) continue;
    words.push({ key: `${c[2]}.${c[3]}.${c[4]}`, left: Number(c[6]), top: Number(c[7]), height: Number(c[9]), conf, text });
  }
  return words;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Tesseract TSV to lines in points, top of page first. */
export function rowsFromTsv(tsv: string, pageHeightPx: number): OcrRow[] {
  const byLine = new Map<string, TsvWord[]>();
  for (const word of parseTsv(tsv)) {
    const list = byLine.get(word.key);
    if (list) list.push(word);
    else byLine.set(word.key, [word]);
  }
  const rows: OcrRow[] = [];
  for (const words of byLine.values()) {
    words.sort((a, b) => a.left - b.left);
    const bottom = median(words.map((w) => w.top + w.height));
    rows.push({
      text: words.map((w) => w.text).join(" "),
      x: words[0].left * PT_PER_PX,
      y: (pageHeightPx - bottom) * PT_PER_PX,
      conf: words.reduce((s, w) => s + w.conf, 0) / words.length,
      size: Math.max(...words.map((w) => w.height)) * PT_PER_PX,
    });
  }
  return rows.sort((a, b) => b.y - a.y);
}

/** Real words earn; non-words cost half as much, so a cut that lets stipple in does not win by volume. */
function scoreOf(stats: WordStats): number {
  return stats.real - 0.5 * (stats.words - stats.real);
}

interface Attempt {
  rows: OcrRow[];
  stats: WordStats;
  threshold: number;
  rotation: Rotation;
}

async function readOnce(tesseract: string, blurred: Gray, threshold: number, rotation: Rotation): Promise<Attempt> {
  const bin = binarize(blurred, threshold, rotation);
  const input = toPbm(bin);
  const args = ["stdin", "stdout", "-l", "eng", "--psm", "6", "-c", "preserve_interword_spaces=1", "tsv"];
  let tsv = "";
  try {
    tsv = await run(tesseract, args, input);
  } catch {
    // Tesseract sometimes gives up on a page it cannot segment. One retry, then
    // this attempt counts as empty and another cut or rotation can still win.
    try {
      tsv = await run(tesseract, args, input);
    } catch {
      tsv = "";
    }
  }
  const rows = rowsFromTsv(tsv, bin.h);
  return { rows, stats: wordStats(rows.map((r) => r.text).join("\n")), threshold, rotation };
}

async function detectRotation(tesseract: string, blurred: Gray, threshold: number): Promise<Rotation | null> {
  try {
    const out = await run(tesseract, ["stdin", "stdout", "--psm", "0", "-l", "osd"], toPbm(binarize(blurred, threshold)));
    const angle = Number(/Rotate:\s*(\d+)/.exec(out)?.[1]);
    return angle === 0 || angle === 90 || angle === 180 || angle === 270 ? angle : null;
  } catch {
    return null;
  }
}

interface DocState {
  rotation: Rotation;
  /** Pages where extra passes did not help; after a few, stop spending on them. */
  wastedRetries: number;
}

export async function ocrPage(
  tesseract: string,
  gray: Gray,
  state: DocState,
): Promise<{ rows: OcrRow[]; report: OcrPageReport }> {
  const blurred = gaussianBlur(gray, 1.5);
  const { first, others } = candidateThresholds(blurred);
  let passes = 1;

  if (inkFraction(binarize(blurred, first).bits) < 0.0005) {
    return { rows: [], report: { threshold: first, passes: 0, rotation: 0, ratio: 0, words: 0, blank: true } };
  }

  let best = await readOnce(tesseract, blurred, first, state.rotation);
  const judged = (a: Attempt) => a.stats.words >= MIN_JUDGED_WORDS;

  // Wrong way up: a right-way page is mostly real words, an upside-down one is not.
  if (judged(best) && best.stats.ratio < 0.5) {
    const flipped = await readOnce(tesseract, blurred, first, ((state.rotation + 180) % 360) as Rotation);
    passes++;
    if (scoreOf(flipped.stats) > scoreOf(best.stats)) best = flipped;
    if (best.stats.ratio < 0.5) {
      const angle = await detectRotation(tesseract, blurred, first);
      if (angle !== null && angle !== best.rotation) {
        const turned = await readOnce(tesseract, blurred, first, angle);
        passes++;
        if (scoreOf(turned.stats) > scoreOf(best.stats)) best = turned;
      }
    }
  }

  // Other cuts, then a heavier blur, for a watermark the first guess did not clear.
  if (judged(best) && best.stats.ratio < GOOD_RATIO && state.wastedRetries < 3) {
    const before = best.stats.ratio;
    for (const cut of others.slice(0, 3)) {
      const attempt = await readOnce(tesseract, blurred, cut, best.rotation);
      passes++;
      if (scoreOf(attempt.stats) > scoreOf(best.stats)) best = attempt;
    }
    if (best.stats.ratio < GOOD_RATIO) {
      const heavy = gaussianBlur(gray, 2.5);
      const attempt = await readOnce(tesseract, heavy, candidateThresholds(heavy).first, best.rotation);
      passes++;
      if (scoreOf(attempt.stats) > scoreOf(best.stats)) best = attempt;
    }
    if (best.stats.ratio - before < 0.05) state.wastedRetries++;
  }

  if (judged(best) && best.stats.ratio >= 0.5) state.rotation = best.rotation;
  return {
    rows: best.rows,
    report: {
      threshold: best.threshold,
      passes,
      rotation: best.rotation,
      ratio: best.stats.ratio,
      words: best.stats.words,
      blank: false,
    },
  };
}

/** OCR every page of a PDF. Throws OcrUnavailableError when the tools are missing. */
export async function ocrPdf(pdf: Buffer, pageCount: number, onProgress: OcrProgress = () => {}): Promise<OcrResult> {
  const missing = ocrToolsMissing();
  if (missing.length) throw new OcrUnavailableError(missing);
  if (pageCount > MAX_PAGES) throw new Error(`OCR is limited to ${MAX_PAGES} pages (this file has ${pageCount}).`);
  const pdftoppm = findTool("pdftoppm")!;
  const tesseract = findTool("tesseract")!;
  const started = Date.now();

  const dir = await mkdtemp(join(tmpdir(), "s2c-ocr-"));
  try {
    await chmod(dir, 0o700);
    const source = join(dir, "in.pdf");
    await writeFile(source, pdf, { mode: 0o600 });

    const pages: OcrRow[][] = new Array(pageCount);
    const reports: OcrPageReport[] = new Array(pageCount);
    const state: DocState = { rotation: 0, wastedRetries: 0 };
    let next = 0;
    let done = 0;

    const worker = async (id: number, limit: number) => {
      while (next < limit) {
        const index = next++;
        const base = join(dir, `w${id}`);
        const file = `${base}.pgm`;
        try {
          await run(pdftoppm, ["-f", String(index + 1), "-l", String(index + 1), "-r", String(DPI), "-gray", "-singlefile", source, base]);
          const gray = parsePgm(await readFile(file));
          await rm(file, { force: true });
          const result = await ocrPage(tesseract, gray, state);
          pages[index] = result.rows;
          reports[index] = result.report;
        } finally {
          await rm(file, { force: true });
        }
        onProgress(++done, pageCount);
      }
    };
    // The first page alone, so the orientation guess is known before pages fan out.
    await worker(0, Math.min(1, pageCount));
    await Promise.all(Array.from({ length: CONCURRENCY }, (_, id) => worker(id + 1, pageCount)));
    return { pages, reports, ms: Date.now() - started };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
