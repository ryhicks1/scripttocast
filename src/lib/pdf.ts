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


/** Thrown when a document cannot be sent and cannot be split to fit. */
export class PdfEncryptedError extends Error {
  constructor(public readonly fileName: string) {
    super(
      `"${fileName}" is password-protected and too large to send in one piece. ` +
      `Please upload a version without password protection.`
    );
    this.name = "PdfEncryptedError";
  }
}

/**
 * Identify pdf-lib's EncryptedPDFError.
 *
 * This matches on the message rather than `instanceof EncryptedPDFError`, which
 * looks like the obvious check but is always false. pdf-lib's CJS build targets
 * ES5, so `class EncryptedPDFError extends Error` is emitted through tslib's
 * __extends — and subclassing a built-in under ES5 loses the prototype link.
 * The thrown value's constructor is plain Error:
 *
 *   e.constructor.name              -> "Error"
 *   e instanceof EncryptedPDFError  -> false
 *
 * Verified against pdf-lib 1.17. Do not "fix" this back to instanceof.
 */
function isEncryptedPdfError(error: unknown): boolean {
  return error instanceof Error &&
    /Input document to `PDFDocument\.load` is encrypted/.test(error.message);
}

/**
 * Load a PDF, reporting password protection rather than throwing on it.
 *
 * Scripts are routinely circulated with an owner password set — readable in any
 * viewer, but flagged encrypted to restrict printing or copying. pdf-lib cannot
 * decrypt, and `ignoreEncryption` does not help: it skips the check, then fails
 * to parse the encrypted objects anyway. So an encrypted document yields no
 * usable PDFDocument, and callers must not try to rewrite one.
 */
export async function loadPdf(
  bytes: Buffer,
): Promise<{ doc: PDFDocument; encrypted: false } | { doc: null; encrypted: true }> {
  try {
    return { doc: await PDFDocument.load(bytes), encrypted: false };
  } catch (error) {
    if (isEncryptedPdfError(error)) return { doc: null, encrypted: true };
    throw error;
  }
}

/**
 * Turn an uploaded PDF into chunks that fit the API's page and size limits.
 *
 * A document that already fits is passed through byte for byte rather than
 * re-saved: faster, exact, and the only workable path for an encrypted file.
 * Since a feature script sits far below the page limit, that is the normal case.
 */
export async function chunkPdf(bytes: Buffer, fileName: string): Promise<PdfChunk[]> {
  const asSingleChunk = () => [{
    fileName,
    pageOffset: 1,
    base64: bytes.toString("base64"),
  }];

  const { doc, encrypted } = await loadPdf(bytes);

  if (encrypted) {
    // Page count is unknowable and splitting is impossible, so the only option
    // is to forward the file as uploaded and let the API judge it.
    if (bytes.length <= MAX_CHUNK_BYTES) return asSingleChunk();
    throw new PdfEncryptedError(fileName);
  }

  const pageCount = doc.getPageCount();
  if (pageCount <= MAX_PDF_PAGES && bytes.length <= MAX_CHUNK_BYTES) {
    return asSingleChunk();
  }

  return splitPdf(doc, fileName, 0, pageCount);
}
