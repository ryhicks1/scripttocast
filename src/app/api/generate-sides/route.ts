import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const scriptFile = formData.get("script") as File | null;
    const roleName = formData.get("roleName") as string;
    const pageNumbers = JSON.parse(formData.get("pageNumbers") as string || "[]") as number[];

    if (!scriptFile || !roleName) {
      return NextResponse.json({ error: "Missing script file or role name" }, { status: 400 });
    }

    const scriptBuffer = await scriptFile.arrayBuffer();

    let pdfBytes: Uint8Array;

    if (pageNumbers.length > 0) {
      // Extract specific pages
      const srcDoc = await PDFDocument.load(scriptBuffer);
      const newDoc = await PDFDocument.create();

      for (const pageNum of pageNumbers) {
        const idx = pageNum - 1; // 0-indexed
        if (idx >= 0 && idx < srcDoc.getPageCount()) {
          const [copiedPage] = await newDoc.copyPages(srcDoc, [idx]);
          newDoc.addPage(copiedPage);
        }
      }

      pdfBytes = await newDoc.save();
    } else {
      // If no page numbers specified, try to find pages by character name
      // Parse text from each page and find which ones mention the role
      const { getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(scriptBuffer));

      const matchingPages: number[] = [];
      const roleUpper = roleName.toUpperCase().trim();
      // Also check common variations
      const roleVariants = [roleUpper];
      if (roleUpper.includes(" — ")) roleVariants.push(roleUpper.split(" — ")[0].trim());
      if (roleUpper.includes(" - ")) roleVariants.push(roleUpper.split(" - ")[0].trim());

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((item: any) => item.str || "").join(" ").toUpperCase();

        // Check if any variant of the role name appears on this page
        for (const variant of roleVariants) {
          if (pageText.includes(variant)) {
            matchingPages.push(i);
            break;
          }
        }
      }

      if (matchingPages.length === 0) {
        return NextResponse.json({
          error: `Character "${roleName}" not found in script. The script may use different formatting.`,
          pageCount: pdf.numPages,
        }, { status: 404 });
      }

      // Extract matching pages
      const srcDoc = await PDFDocument.load(scriptBuffer);
      const newDoc = await PDFDocument.create();

      for (const pageNum of matchingPages) {
        const idx = pageNum - 1;
        if (idx >= 0 && idx < srcDoc.getPageCount()) {
          const [copiedPage] = await newDoc.copyPages(srcDoc, [idx]);
          newDoc.addPage(copiedPage);
        }
      }

      pdfBytes = await newDoc.save();
    }

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
