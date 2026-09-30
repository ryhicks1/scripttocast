/**
 * Turning uploads into text, page by page, keeping the layout.
 *
 * Extracting a screenplay as plain text throws away the one signal that says
 * what a line IS. Screenplay format is margins: action sits at the left margin,
 * dialogue is indented about an inch further, and a character cue further still.
 * Flatten that and "MARA VOSS, late thirties, backs the rig in" and "Tell them
 * the bay was blocked" are just two lines, which is how action lines ended up
 * being handed to the model as dialogue — and how descriptions came back as
 * scene narration.
 *
 * So lines carry their left edge, measured relative to the page's own margin,
 * and screenplay.ts uses it to tell elements apart. A document with no usable
 * layout (a plain text upload, an oddly built PDF) reports an indent of zero
 * everywhere and the parser falls back to its text-only heuristics.
 *
 * Nothing here writes to disk: the document exists only for the life of the
 * request.
 */
import { getDocumentProxy } from "unpdf";
import { LocalAnalysisError } from "./errors";
import { ocrEnabled, ocrPdf, ocrToolsMissing, OcrUnavailableError, type OcrPageReport } from "./ocr";
import { castNamesFrom, cleanCueLines, findTextWatermark, repairSceneHeadings, snapCues, watermarkRows, type RawItem } from "./watermark";
import { looksGarbled, wordStats, type WordStats } from "./wordcheck";

export interface Line {
  text: string;
  /** Left edge in points, relative to this document's action margin. */
  indent: number;
  /**
   * Baseline in PDF points from the bottom of the page, when the PDF gave one.
   * Sides use it to mark exactly where a scene starts and ends on the page.
   */
  y?: number;
}

export interface ExtractedDocument {
  name: string;
  /** 1-indexed pages, as text. */
  pages: string[];
  /** The same pages as lines with indents. Empty when layout is unavailable. */
  pageLines: Line[][];
  kind: "pdf" | "text";
  /** Present only when the pages came from local OCR. Numbers, never text. */
  ocr?: OcrSummary;
  /** Present when a repeating text-layer watermark was removed. */
  watermarkItemsRemoved?: number;
}

export interface OcrSummary {
  /** Why OCR ran: no text layer, or a text layer that read as garbage. */
  reason: "no-text-layer" | "garbled-text-layer";
  ms: number;
  pages: number;
  /** Share of words that are real English words, over the whole document. */
  realWordRatio: number;
  lowConfidencePages: number;
  rowsRemovedAsWatermark: number;
  cuesCorrected: number;
  headingsRepaired: number;
  perPage: OcrPageReport[];
}

export interface ExtractOptions {
  /**
   * When to try local OCR on a PDF.
   *  - "off" (default): never. This is what v1 has always done.
   *  - "empty": only when the PDF has no text layer, i.e. exactly where the
   *    extractor would otherwise throw, so nothing that worked changes.
   *  - "auto": also when there is a text layer that reads as garbage.
   * LOCAL_OCR=0 in the environment turns OCR off whatever is asked for.
   */
  ocr?: "off" | "empty" | "auto";
  /** Phase updates while OCR runs, for the progress stream. */
  onOcr?: (event: { stage: "start" | "page"; done: number; total: number; reason: string }) => void;
}

/** Below this, a PDF has no usable text layer — almost always a scan. */
const MIN_TEXT_CHARS = 200;
/** Plain text is cut into pseudo-pages so page numbers still mean something. */
const TEXT_PAGE_CHARS = 3000;
/** Text items within this many points of each other are on the same line. */
const LINE_TOLERANCE = 2;

export async function extractDocument(file: File, options: ExtractOptions = {}): Promise<ExtractedDocument> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    const text = buffer.toString("utf8");
    if (text.trim().length < MIN_TEXT_CHARS) {
      throw new LocalAnalysisError(`"${file.name}" contains almost no text.`, 400);
    }
    const pages = splitIntoPages(text);
    return { name: file.name, pages, pageLines: linesWithoutLayout(pages), kind: "text" };
  }

  // Everything new below is behind this switch. With it off (v1's default) the
  // extraction is the same code path it always was.
  const mode = ocrEnabled() ? (options.ocr ?? "off") : "off";
  // Cleaning (text-layer watermark removal, word spacing) is v2-only ("auto").
  // "empty" changes nothing for a PDF that already has text.
  const clean = mode === "auto";

  let layer: TextLayer;
  try {
    layer = await readTextLayer(buffer, clean);
  } catch (error) {
    throw new LocalAnalysisError(
      `Could not read "${file.name}" as a PDF.`,
      400,
      error instanceof Error ? error.message : String(error),
    );
  }
  let pageLines = layer.pageLines;
  let pages = pageLines.map((lines) => lines.map((line) => line.text).join("\n"));
  const total = pages.reduce((sum, page) => sum + page.trim().length, 0);

  const reason = ocrReason(total, mode === "auto" ? wordStats(pages.join("\n")) : null);

  let ocr: OcrSummary | undefined;
  if (reason && mode !== "off") {
    const attempt = await tryOcr(file.name, buffer, layer.numPages, reason, options);
    if (attempt) {
      const layerRatio = wordStats(pages.join("\n")).ratio;
      // A garbled text layer is only replaced when the scan really reads better.
      // An empty one is replaced by anything with enough text.
      const better = reason === "no-text-layer" || attempt.summary.realWordRatio > layerRatio + 0.1;
      const ocrPages = attempt.pageLines.map((lines) => lines.map((line) => line.text).join("\n"));
      const ocrTotal = ocrPages.reduce((sum, page) => sum + page.trim().length, 0);
      if (better && ocrTotal >= MIN_TEXT_CHARS) {
        pageLines = attempt.pageLines;
        pages = ocrPages;
        ocr = attempt.summary;
      } else if (reason === "no-text-layer") {
        throw new LocalAnalysisError(
          `"${file.name}" is a scan and the local OCR could not read enough text from it ` +
            `(${ocrTotal} characters). Is it a very faint or low-resolution scan? ` +
            `A cleaner copy, or one already run through OCR, should work.`,
          422,
        );
      }
    }
  }

  const finalTotal = pages.reduce((sum, page) => sum + page.trim().length, 0);
  if (finalTotal < MIN_TEXT_CHARS) {
    // A scanned script is an image, and there is no text to read. Refusing is
    // the honest answer: the alternative is handing the model an empty document
    // and printing whatever it invents.
    throw new LocalAnalysisError(
      `"${file.name}" has no text layer — it looks like a scan or photos of pages. ` +
        ((options.ocr ?? "off") !== "off" && !ocrEnabled()
          ? `Local OCR is switched off (LOCAL_OCR=0). `
          : `Nothing can be read from it locally. `) +
        `Run it through OCR first ` +
        `(macOS Preview, Acrobat, or "ocrmypdf in.pdf out.pdf") and upload the result.`,
      400,
    );
  }

  return {
    name: file.name,
    pages,
    pageLines,
    kind: "pdf",
    ...(ocr ? { ocr } : {}),
    ...(layer.watermarkItemsRemoved ? { watermarkItemsRemoved: layer.watermarkItemsRemoved } : {}),
  };
}

/**
 * Whether a text layer needs OCR, and why. `stats` is passed only when garbled
 * layers are in scope (mode "auto"). Empty means fewer than MIN_TEXT_CHARS,
 * exactly where the extractor used to throw.
 */
export function ocrReason(totalChars: number, stats: WordStats | null): OcrSummary["reason"] | null {
  if (totalChars < MIN_TEXT_CHARS) return "no-text-layer";
  if (stats && looksGarbled(stats)) return "garbled-text-layer";
  return null;
}

/**
 * Local OCR, or null when it cannot run (tools missing, or it failed). The
 * caller decides what to tell the user; nothing here logs script text.
 */
async function tryOcr(
  name: string,
  buffer: Buffer,
  numPages: number,
  reason: OcrSummary["reason"],
  options: ExtractOptions,
): Promise<{ pageLines: Line[][]; summary: OcrSummary } | null> {
  const missing = ocrToolsMissing();
  if (missing.length) {
    if (reason === "no-text-layer") {
      throw new LocalAnalysisError(
        `"${name}" has no text layer — it looks like a scan. Reading it locally needs ${missing.join(" and ")}: ` +
          `run "brew install poppler tesseract" and try again, or run it through OCR first ` +
          `(macOS Preview, Acrobat) and upload the result.`,
        400,
      );
    }
    return null;
  }
  options.onOcr?.({ stage: "start", done: 0, total: numPages, reason });
  let result;
  try {
    result = await ocrPdf(buffer, numPages, (done, total) => options.onOcr?.({ stage: "page", done, total, reason }));
  } catch (error) {
    if (error instanceof OcrUnavailableError) return null;
    if (reason === "garbled-text-layer") return null;
    throw new LocalAnalysisError(
      `"${name}" is a scan, and reading it locally failed.`,
      422,
      error instanceof Error ? error.message : String(error),
    );
  }

  const heights = result.pages.map(() => 792);
  const dropped = watermarkRows(result.pages, heights);
  const rows = result.pages.map((page) => page.filter((row) => !dropped.has(row)).filter((row) => row.text.trim()));
  const pageLines = normaliseIndents(rows.map((page) => page.map((row) => ({ text: row.text, x: row.x, y: row.y }))));
  const headings = repairSceneHeadings(pageLines);
  cleanCueLines(pageLines);
  const cast = castNamesFrom(pageLines);
  const fixes = snapCues(pageLines, cast);

  const everything = pageLines.map((lines) => lines.map((line) => line.text).join("\n")).join("\n");
  const stats = wordStats(everything);
  return {
    pageLines,
    summary: {
      reason,
      ms: result.ms,
      pages: numPages,
      realWordRatio: stats.ratio,
      lowConfidencePages: result.reports.filter((r) => !r.blank && r.words >= 20 && r.ratio < 0.6).length,
      rowsRemovedAsWatermark: dropped.size,
      cuesCorrected: fixes.reduce((sum, fix) => sum + fix.count, 0),
      headingsRepaired: headings,
      perPage: result.reports,
    },
  };
}

interface TextLayer {
  pageLines: Line[][];
  numPages: number;
  watermarkItemsRemoved: number;
}

export interface LayerItem extends RawItem {
  width: number;
  height: number;
}

/**
 * Gap-based spacing applies only to PDFs whose text items are single words
 * with no space items between them, which is what OCR tools write. Elsewhere a
 * gap inside a row is left alone: normal PDFs can split words mid-run with
 * kerning, and a space there would break the word.
 */
export function isWordPerItemLayer(pages: LayerItem[][]): boolean {
  let items = 0;
  let blank = 0;
  let spaced = 0;
  let multiWord = 0;
  for (const page of pages) {
    for (const item of page) {
      items++;
      if (!item.str.trim()) blank++;
      else if (/\S\s+\S/.test(item.str)) spaced++;
      else if (/\s$|^\s/.test(item.str)) multiWord++;
    }
  }
  if (items < 50) return false;
  return blank / items < 0.03 && (spaced + multiWord) / items < 0.05;
}

/** A gap wider than this share of the text height is a space. */
const WORD_GAP = 0.2;

/**
 * Items arrive in reading order but split mid-line, so regroup by baseline.
 * With `spaceFix` (word-per-item layers only), a gap wider than a fifth of the
 * text height between one item's end and the next one's start becomes a space.
 */
export function groupIntoRows(
  items: LayerItem[],
  spaceFix: boolean,
): { text: string; x: number; y: number }[] {
  const rows = new Map<number, { text: string; x: number; y: number; end: number }>();
  const order: number[] = [];
  for (const item of items) {
    const y = Math.round(item.y / LINE_TOLERANCE) * LINE_TOLERANCE;
    const existing = rows.get(y);
    if (existing) {
      if (spaceFix) {
        const gap = item.x - existing.end;
        if (gap > Math.max(1, WORD_GAP * item.height) && !/\s$/.test(existing.text) && !/^\s/.test(item.str)) {
          existing.text += " ";
        }
        existing.end = Math.max(existing.end, item.x + item.width);
      }
      existing.text += item.str;
      existing.x = Math.min(existing.x, item.x);
    } else {
      rows.set(y, { text: item.str, x: item.x, y, end: item.x + item.width });
      order.push(y);
    }
  }
  return order.map((y) => rows.get(y)!).filter((row) => row.text.trim());
}

/** Read the PDF's own text layer and group it into lines with left edges. */
async function readTextLayer(buffer: Buffer, clean: boolean): Promise<TextLayer> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pages: LayerItem[][] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: LayerItem[] = [];
    for (const item of content.items) {
      const str = (item as { str?: string }).str ?? "";
      const transform = (item as { transform?: number[] }).transform;
      if (!str || !transform) continue;
      items.push({
        str,
        x: transform[4],
        y: transform[5],
        angle: (Math.atan2(transform[1], transform[0]) * 180) / Math.PI,
        width: (item as { width?: number }).width ?? 0,
        height: (item as { height?: number }).height ?? Math.abs(transform[3]) ?? 0,
      });
    }
    pages.push(items);
  }

  let removed = 0;
  let kept = pages;
  if (clean) {
    // A name stamped across every page at an angle sits in the text layer too,
    // and lands in the middle of real lines. Repeats at an odd angle only.
    const marks = findTextWatermark(pages);
    kept = pages.map((items, p) => items.filter((_, i) => !marks[p].has(i)));
    removed = pages.reduce((sum, items, p) => sum + marks[p].size, 0);
  }
  const spaceFix = clean && isWordPerItemLayer(kept);

  const raw = kept.map((items) => groupIntoRows(items, spaceFix));

  return { pageLines: normaliseIndents(raw), numPages: pdf.numPages, watermarkItemsRemoved: removed };
}

/**
 * Convert absolute left edges into indents relative to the document's action
 * margin.
 *
 * The action margin is the leftmost edge that is actually a column — not the
 * most common one. Dialogue and cues outnumber action, so the most common edge
 * is often the dialogue column, and every real indent comes out negative.
 *
 * A sparse gutter to the left of that column is not the margin either. Scene
 * numbers and revision marks sit there. Treating them as the margin made every
 * action line look indented, so the parser read action as dialogue and the
 * model described a sword fight instead of the person.
 *
 * Relative rather than absolute so this survives any page size or margin
 * preset. When a document has no meaningful spread of left edges — a plain text
 * file, or a PDF whose indentation is spaces inside one text run — every indent
 * comes out at zero and the text-only heuristics take over.
 */
function normaliseIndents(pages: { text: string; x: number; y?: number }[][]): Line[][] {
  const counts = new Map<number, number>();
  for (const page of pages) {
    for (const row of page) {
      const bucket = Math.round(row.x / 4) * 4;
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
  }
  if (!counts.size) return pages.map((page) => page.map((row) => ({ text: row.text, indent: 0, y: row.y })));

  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const recurring = [...counts.entries()]
    .filter(([, n]) => n >= Math.max(3, total * 0.02))
    .sort((a, b) => a[0] - b[0]);
  const margin = actionMargin(recurring, total) ?? Math.min(...counts.keys());
  return pages.map((page) =>
    page.map((row) => ({ text: row.text, indent: Math.max(0, Math.round(row.x - margin)), y: row.y })),
  );
}

/**
 * Leftmost real column. A bucket that holds under 8% of lines is a gutter when
 * a column at least three times larger sits within an inch to its right.
 */
function actionMargin(recurring: [number, number][], total: number): number | null {
  if (!recurring.length) return null;
  for (let i = 0; i < recurring.length; i++) {
    const [bucket, count] = recurring[i];
    const beside = recurring.find(
      ([other, n]) => other > bucket && other - bucket <= 90 && n >= count * 3 && n >= total * 0.08,
    );
    if (count < total * 0.08 && beside) continue;
    return bucket;
  }
  return recurring[0][0];
}

function linesWithoutLayout(pages: string[]): Line[][] {
  return pages.map((page) =>
    page.split(/\r?\n/).filter((text) => text.trim()).map((text) => ({ text, indent: 0 })),
  );
}

function splitIntoPages(text: string): string[] {
  const pages: string[] = [];
  for (let i = 0; i < text.length; i += TEXT_PAGE_CHARS) {
    pages.push(text.slice(i, i + TEXT_PAGE_CHARS));
  }
  return pages.length ? pages : [text];
}
