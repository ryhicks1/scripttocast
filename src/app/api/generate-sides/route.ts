import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import { loadPdf } from "@/lib/pdf";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const scriptFile = formData.get("script") as File | null;
    const roleName = formData.get("roleName") as string;
    const pageNumbersStr = formData.get("pageNumbers") as string || "[]";

    if (!scriptFile || !roleName) {
      return NextResponse.json({ error: "Missing script file or role name" }, { status: 400 });
    }

    const pageNumbers: number[] = JSON.parse(pageNumbersStr);
    const selections: Selection[] = JSON.parse((formData.get("selections") as string) || "[]");
    const scriptBuffer = Buffer.from(await scriptFile.arrayBuffer());

    // Extracting pages means writing a new document, and pdf-lib cannot
    // decrypt — it would emit a file whose pages are unreadable rather than
    // fail. Better to say so than to hand back a broken PDF.
    const loaded = await loadPdf(scriptBuffer);
    if (loaded.encrypted) {
      return NextResponse.json(
        {
          error:
            `"${scriptFile.name}" is password-protected, so sides cannot be extracted from it. ` +
            `Please upload a version without password protection.`,
        },
        { status: 400 },
      );
    }

    const srcDoc = loaded.doc;
    const totalPages = srcDoc.getPageCount();
    const newDoc = await PDFDocument.create();
    const font = await newDoc.embedFont(StandardFonts.HelveticaBold);

    if (selections.length) {
      // Chosen scenes, each marked where the actor starts and stops, the way a
      // casting office marks up sides by hand.
      for (const selection of selections) {
        for (const pageNum of selection.pages) {
          const idx = pageNum - 1;
          if (idx < 0 || idx >= totalPages) continue;
          const [copied] = await newDoc.copyPages(srcDoc, [idx]);
          const page = newDoc.addPage(copied);
          stampHeader(page, font, `${roleName.toUpperCase()} · ${selection.heading}`);
          if (pageNum === selection.start.page) markStart(page, font, selection.start.y);
          if (pageNum === selection.end.page) markEnd(page, font, selection.end.y);
        }
      }
    } else {
      // Older callers: explicit pages, unmarked.
      const pagesToExtract =
        pageNumbers.length > 0 ? pageNumbers : Array.from({ length: totalPages }, (_, i) => i + 1);
      for (const pageNum of pagesToExtract) {
        const idx = pageNum - 1;
        if (idx >= 0 && idx < totalPages) {
          const [copiedPage] = await newDoc.copyPages(srcDoc, [idx]);
          newDoc.addPage(copiedPage);
        }
      }
    }

    const pdfBytes = await newDoc.save();
    const filename = `Sides_${roleName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;

    return new NextResponse(pdfBytes as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error("Sides generation error:", error);
    return NextResponse.json({ error: error.message || "Failed to generate sides" }, { status: 500 });
  }
}

interface Selection {
  heading: string;
  pages: number[];
  start: { page: number; y?: number };
  end: { page: number; y?: number };
}

const MARK = rgb(0.8, 0.1, 0.1);
/** Space above a baseline that still belongs to its line. */
const LINE_ASCENT = 11;

function stampHeader(page: PDFPage, font: PDFFont, text: string) {
  const { height } = page.getSize();
  page.drawText(text.slice(0, 90), { x: 36, y: height - 20, size: 7, font, color: rgb(0.45, 0.45, 0.45) });
}

/** Fade everything above the first line to read, and mark where it starts. */
function markStart(page: PDFPage, font: PDFFont, y?: number) {
  const { width, height } = page.getSize();
  const at = y === undefined ? height - 36 : Math.min(height - 30, y + LINE_ASCENT + 3);
  if (at < height - 30) {
    page.drawRectangle({ x: 0, y: at, width, height: height - 28 - at, color: rgb(1, 1, 1), opacity: 0.7 });
  }
  page.drawLine({ start: { x: 30, y: at }, end: { x: width - 30, y: at }, thickness: 1.2, color: MARK });
  page.drawText("START", { x: 32, y: at + 3, size: 9, font, color: MARK });
}

/** Fade everything below the last line to read, and mark where it ends. */
function markEnd(page: PDFPage, font: PDFFont, y?: number) {
  const { width } = page.getSize();
  const at = y === undefined ? 36 : Math.max(24, y - 5);
  if (at > 24) {
    page.drawRectangle({ x: 0, y: 0, width, height: at, color: rgb(1, 1, 1), opacity: 0.7 });
  }
  page.drawLine({ start: { x: 30, y: at }, end: { x: width - 30, y: at }, thickness: 1.2, color: MARK });
  page.drawText("END", { x: 32, y: at - 11, size: 9, font, color: MARK });
}
