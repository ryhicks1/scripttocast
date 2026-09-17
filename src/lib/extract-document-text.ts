import { inflateRawSync } from "zlib";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Pull readable text from an uploaded casting document for the local Ollama
 * path. PDFs use unpdf (page-labeled). DOCX is unzipped to word/document.xml.
 * Legacy .doc is a best-effort printable-string scrape.
 */
export async function extractUploadedDocumentText(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
): Promise<string> {
  const lower = fileName.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    return extractPdfText(fileName, buffer);
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    return extractDocxText(fileName, buffer);
  }
  if (mimeType === "application/msword" || lower.endsWith(".doc")) {
    return extractDocBinary(fileName, buffer);
  }
  return `=== ${fileName} ===\n${buffer.toString("utf8").slice(0, 200_000)}`;
}

async function extractPdfText(fileName: string, buffer: Buffer): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    const labeled = pages.map((pageText, i) => {
      const body = (pageText || "").trim();
      return `--- PAGE ${i + 1} of ${totalPages} ---\n${
        body || "[no extractable text on this page]"
      }`;
    });
    return `=== ${fileName} (${totalPages} pages) ===\n${labeled.join("\n\n")}`;
  } catch {
    return `=== ${fileName} ===\n[PDF unreadable — no text layer extracted]`;
  }
}

function extractDocxText(fileName: string, buffer: Buffer): string {
  const xml = readZipEntryUtf8(buffer, "word/document.xml");
  if (!xml) {
    return `=== ${fileName} ===\n[Could not read DOCX word/document.xml]`;
  }
  return `=== ${fileName} ===\n${docxXmlToPlainText(xml)}`;
}

function docxXmlToPlainText(xml: string): string {
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\b[^/]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) =>
      String.fromCharCode(parseInt(n, 16)),
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Best-effort: pull long printable UTF-16LE / ASCII runs from a .doc. */
function extractDocBinary(fileName: string, buffer: Buffer): string {
  const chunks: string[] = [];
  let utf16 = "";
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    const code = buffer.readUInt16LE(i);
    const printable = code === 10 || code === 13 || code === 9 || (code >= 32 && code < 0xd800);
    if (printable) {
      utf16 += String.fromCharCode(code);
    } else {
      if (utf16.trim().length >= 24) chunks.push(utf16.trim());
      utf16 = "";
    }
  }
  if (utf16.trim().length >= 24) chunks.push(utf16.trim());

  const ascii = buffer
    .toString("latin1")
    .match(/[\t\n\r\x20-\x7e]{24,}/g)
    ?.map((s) => s.trim()) ?? [];

  const text = [...chunks, ...ascii].join("\n").slice(0, 200_000);
  if (!text) {
    return `=== ${fileName} ===\n[Legacy .doc had no extractable text]`;
  }
  return `=== ${fileName} ===\n${text}`;
}

function readZipEntryUtf8(buffer: Buffer, entryName: string): string | null {
  const bytes = readZipEntry(buffer, entryName);
  return bytes ? bytes.toString("utf8") : null;
}

/**
 * Locate a ZIP entry via the central directory (reliable sizes) and inflate it.
 */
function readZipEntry(buffer: Buffer, entryName: string): Buffer | null {
  const eocd = findEocd(buffer);
  if (eocd < 0) return null;

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount && offset + 46 <= buffer.length; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");

    if (name === entryName) {
      if (localOffset + 30 > buffer.length) return null;
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return Buffer.from(compressed);
      if (method === 8) return inflateRawSync(compressed);
      return null;
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return null;
}

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}
