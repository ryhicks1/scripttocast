import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";

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
    const scriptBuffer = await scriptFile.arrayBuffer();
    const srcDoc = await PDFDocument.load(scriptBuffer);
    const totalPages = srcDoc.getPageCount();

    // If no specific pages given, include all pages (user will get the full script as sides)
    const pagesToExtract = pageNumbers.length > 0 ? pageNumbers : Array.from({ length: totalPages }, (_, i) => i + 1);

    const newDoc = await PDFDocument.create();
    for (const pageNum of pagesToExtract) {
      const idx = pageNum - 1;
      if (idx >= 0 && idx < totalPages) {
        const [copiedPage] = await newDoc.copyPages(srcDoc, [idx]);
        newDoc.addPage(copiedPage);
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
