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

export interface Line {
  text: string;
  /** Left edge in points, relative to this document's action margin. */
  indent: number;
}

export interface ExtractedDocument {
  name: string;
  /** 1-indexed pages, as text. */
  pages: string[];
  /** The same pages as lines with indents. Empty when layout is unavailable. */
  pageLines: Line[][];
  kind: "pdf" | "text";
}

/** Below this, a PDF has no usable text layer — almost always a scan. */
const MIN_TEXT_CHARS = 200;
/** Plain text is cut into pseudo-pages so page numbers still mean something. */
const TEXT_PAGE_CHARS = 3000;
/** Text items within this many points of each other are on the same line. */
const LINE_TOLERANCE = 2;

export async function extractDocument(file: File): Promise<ExtractedDocument> {
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

  let pageLines: Line[][];
  try {
    pageLines = await extractLines(buffer);
  } catch (error) {
    throw new LocalAnalysisError(
      `Could not read "${file.name}" as a PDF.`,
      400,
      error instanceof Error ? error.message : String(error),
    );
  }

  const pages = pageLines.map((lines) => lines.map((line) => line.text).join("\n"));
  const total = pages.reduce((sum, page) => sum + page.trim().length, 0);
  if (total < MIN_TEXT_CHARS) {
    // Known weak spot: a scanned script is an image, and there is no text to
    // read. Refusing is the honest answer — the alternative is handing the
    // model an empty document and printing whatever it invents.
    throw new LocalAnalysisError(
      `"${file.name}" has no text layer — it looks like a scan or photos of pages. ` +
        `Nothing can be read from it locally. Run it through OCR first ` +
        `(macOS Preview, Acrobat, or "ocrmypdf in.pdf out.pdf") and upload the result.`,
      400,
    );
  }

  return { name: file.name, pages, pageLines, kind: "pdf" };
}

/** Group a PDF's text items into lines, and measure each line's left edge. */
async function extractLines(buffer: Buffer): Promise<Line[][]> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const raw: { text: string; x: number }[][] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    // Items arrive in reading order but split mid-line, so regroup by baseline.
    const rows = new Map<number, { text: string; x: number }>();
    const order: number[] = [];
    for (const item of content.items) {
      const str = (item as { str?: string }).str ?? "";
      const transform = (item as { transform?: number[] }).transform;
      if (!str || !transform) continue;
      const x = transform[4];
      const y = Math.round(transform[5] / LINE_TOLERANCE) * LINE_TOLERANCE;

      const existing = rows.get(y);
      if (existing) {
        existing.text += str;
        existing.x = Math.min(existing.x, x);
      } else {
        rows.set(y, { text: str, x });
        order.push(y);
      }
    }

    raw.push(order.map((y) => rows.get(y)!).filter((row) => row.text.trim()));
  }

  return normaliseIndents(raw);
}

/**
 * Convert absolute left edges into indents relative to the document's action
 * margin.
 *
 * The action margin is the LEFTMOST edge that recurs — not the most common one.
 * In a screenplay, dialogue and character cues each outnumber action lines, so
 * picking the most common edge lands on the dialogue column and every real
 * indent comes out negative.
 *
 * Relative rather than absolute so this survives any page size or margin
 * preset. When a document has no meaningful spread of left edges — a plain text
 * file, or a PDF whose indentation is spaces inside one text run — every indent
 * comes out at zero and the text-only heuristics take over.
 */
function normaliseIndents(pages: { text: string; x: number }[][]): Line[][] {
  const counts = new Map<number, number>();
  for (const page of pages) {
    for (const row of page) {
      const bucket = Math.round(row.x / 4) * 4;
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
  }
  if (!counts.size) return pages.map((page) => page.map((row) => ({ text: row.text, indent: 0 })));

  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const recurring = [...counts.entries()]
    .filter(([, n]) => n >= Math.max(3, total * 0.02))
    .map(([bucket]) => bucket);
  const margin = recurring.length ? Math.min(...recurring) : Math.min(...counts.keys());
  return pages.map((page) =>
    page.map((row) => ({ text: row.text, indent: Math.max(0, Math.round(row.x - margin)) })),
  );
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
