import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getUserBranding, hexToRgb } from "@/lib/branding";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const scriptFile = formData.get("script") as File | null;
    const roleName = formData.get("roleName") as string;
    const pageNumbersStr = formData.get("pageNumbers") as string || "[]";

    if (!scriptFile || !roleName) {
      return NextResponse.json({ error: "Missing script file or role name" }, { status: 400 });
    }

    // Get user branding
    let branding: Awaited<ReturnType<typeof getUserBranding>> | null = null;
    try {
      const supabase = await createServerClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) branding = await getUserBranding(user.id);
    } catch {}

    const pageNumbers: number[] = JSON.parse(pageNumbersStr);
    const scriptBuffer = await scriptFile.arrayBuffer();
    const srcDoc = await PDFDocument.load(scriptBuffer);
    const totalPages = srcDoc.getPageCount();

    const pagesToExtract = pageNumbers.length > 0 ? pageNumbers : Array.from({ length: totalPages }, (_, i) => i + 1);

    const newDoc = await PDFDocument.create();
    const font = await newDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await newDoc.embedFont(StandardFonts.HelveticaBold);

    // Add branded cover page if user has branding set up
    if (branding && branding.companyName !== "Script To Cast") {
      const coverPage = newDoc.addPage([595.28, 841.89]); // A4
      const { width, height } = coverPage.getSize();
      const colorRgb = hexToRgb(branding.brandColor);
      const brandColor = rgb(colorRgb[0] / 255, colorRgb[1] / 255, colorRgb[2] / 255);

      // Logo
      let logoY = height - 120;
      if (branding.logoBytes && branding.logoFormat) {
        try {
          const logoImage = branding.logoFormat === "png"
            ? await newDoc.embedPng(branding.logoBytes)
            : await newDoc.embedJpg(branding.logoBytes);
          const scale = Math.min(80 / logoImage.width, 80 / logoImage.height);
          const logoW = logoImage.width * scale;
          const logoH = logoImage.height * scale;
          coverPage.drawImage(logoImage, {
            x: (width - logoW) / 2,
            y: logoY - logoH,
            width: logoW,
            height: logoH,
          });
          logoY -= logoH + 20;
        } catch {
          // Logo embed failed
        }
      }

      // Company name
      const nameSize = 24;
      const nameWidth = fontBold.widthOfTextAtSize(branding.companyName, nameSize);
      coverPage.drawText(branding.companyName, {
        x: (width - nameWidth) / 2,
        y: logoY,
        size: nameSize,
        font: fontBold,
        color: brandColor,
      });

      // Divider
      coverPage.drawLine({
        start: { x: width / 2 - 40, y: logoY - 15 },
        end: { x: width / 2 + 40, y: logoY - 15 },
        thickness: 1,
        color: rgb(0.8, 0.8, 0.8),
      });

      // SIDES FOR
      const sidesText = "SIDES FOR";
      const sidesWidth = font.widthOfTextAtSize(sidesText, 12);
      coverPage.drawText(sidesText, {
        x: (width - sidesWidth) / 2,
        y: logoY - 40,
        size: 12,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });

      // Role name
      const roleSize = 28;
      const roleWidth = fontBold.widthOfTextAtSize(roleName, roleSize);
      coverPage.drawText(roleName, {
        x: (width - roleWidth) / 2,
        y: logoY - 70,
        size: roleSize,
        font: fontBold,
        color: rgb(0, 0, 0),
      });

      // Footer with contact details
      const footerParts: string[] = [];
      if (branding.contactEmail) footerParts.push(branding.contactEmail);
      if (branding.contactPhone) footerParts.push(branding.contactPhone);
      if (branding.contactWebsite) footerParts.push(branding.contactWebsite);
      if (footerParts.length > 0) {
        const footerText = footerParts.join("  |  ");
        const footerWidth = font.widthOfTextAtSize(footerText, 8);
        coverPage.drawText(footerText, {
          x: (width - footerWidth) / 2,
          y: 40,
          size: 8,
          font,
          color: rgb(0.6, 0.6, 0.6),
        });
      }
    }

    // Copy script pages
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
