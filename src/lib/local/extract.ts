/**
 * Turning uploads into text, page by page.
 *
 * Page-level extraction is what makes accurate pageNumbers possible without
 * asking the model for them — see screenplay.ts. Nothing here writes to disk:
 * the document exists only for the life of the request.
 */
import { extractText } from "unpdf";
import { LocalAnalysisError } from "./errors";

export interface ExtractedDocument {
  name: string;
  /** 1-indexed pages, as text. */
  pages: string[];
  kind: "pdf" | "text";
}

/** Below this, a PDF has no usable text layer — almost always a scan. */
const MIN_TEXT_CHARS = 200;
/** Plain text is cut into pseudo-pages so page numbers still mean something. */
const TEXT_PAGE_CHARS = 3000;

export async function extractDocument(file: File): Promise<ExtractedDocument> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    const text = buffer.toString("utf8");
    if (text.trim().length < MIN_TEXT_CHARS) {
      throw new LocalAnalysisError(`"${file.name}" contains almost no text.`, 400);
    }
    return { name: file.name, pages: splitIntoPages(text), kind: "text" };
  }

  let pages: string[];
  try {
    const result = await extractText(new Uint8Array(buffer), { mergePages: false });
    pages = result.text;
  } catch (error) {
    throw new LocalAnalysisError(
      `Could not read "${file.name}" as a PDF.`,
      400,
      error instanceof Error ? error.message : String(error),
    );
  }

  const total = pages.reduce((sum, page) => sum + page.trim().length, 0);
  if (total < MIN_TEXT_CHARS) {
    // Known weak spot: a scanned script is an image, and unpdf returns nothing.
    // The old code passed the empty string to the model, which then invented a
    // breakdown out of nothing. Refusing is the honest answer.
    throw new LocalAnalysisError(
      `"${file.name}" has no text layer — it looks like a scan or photos of pages. ` +
        `Nothing can be read from it locally. Run it through OCR first ` +
        `(macOS Preview, Acrobat, or "ocrmypdf in.pdf out.pdf") and upload the result.`,
      400,
    );
  }

  return { name: file.name, pages, kind: "pdf" };
}

function splitIntoPages(text: string): string[] {
  const pages: string[] = [];
  for (let i = 0; i < text.length; i += TEXT_PAGE_CHARS) {
    pages.push(text.slice(i, i + TEXT_PAGE_CHARS));
  }
  return pages.length ? pages : [text];
}
