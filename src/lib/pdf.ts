import { PDFDocument } from "pdf-lib";

// Claude accepts 600 PDF pages per request on large-context models, and 32MB
// per request overall. Base64 inflates by 4/3, so cap raw bytes well under that
// to leave room for the prompt.
export const MAX_PDF_PAGES = 600;
export const MAX_CHUNK_BYTES = 20 * 1024 * 1024;

export interface PdfChunk {
  fileName: string;
  /** First page number of this chunk within the original document (1-indexed). */
  pageOffset: number;
  base64: string;
}

/**
 * Split a PDF into chunks that fit the API's page and size limits. Most scripts
 * come back as a single chunk; only very long or image-heavy PDFs split.
 */
export async function splitPdf(
  source: PDFDocument,
  fileName: string,
  startPage: number,
  endPage: number,
): Promise<PdfChunk[]> {
  const pageCount = endPage - startPage;
  if (pageCount <= 0) return [];

  if (pageCount <= MAX_PDF_PAGES) {
    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(
      source,
      Array.from({ length: pageCount }, (_, i) => startPage + i),
    );
    pages.forEach((p) => doc.addPage(p));
    const bytes = await doc.save();

    if (bytes.length <= MAX_CHUNK_BYTES || pageCount === 1) {
      return [{
        fileName,
        pageOffset: startPage + 1,
        base64: Buffer.from(bytes).toString("base64"),
      }];
    }
  }

  // Too many pages or too many bytes — halve and recurse.
  const mid = startPage + Math.ceil(pageCount / 2);
  const [left, right] = await Promise.all([
    splitPdf(source, fileName, startPage, mid),
    splitPdf(source, fileName, mid, endPage),
  ]);
  return [...left, ...right];
}
