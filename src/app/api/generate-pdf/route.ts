import { NextResponse } from "next/server";
import jsPDF from "jspdf";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getUserBranding, textColorForBg } from "@/lib/branding";

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { roleName, projectName, brand, location, productionDates, videos, photos, filmingNotes } = data;

    // Get user branding if logged in
    let userId: string | null = null;
    try {
      const supabase = await createServerClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) userId = user.id;
    } catch {}

    const branding = userId ? await getUserBranding(userId) : null;
    const brandRgb = branding?.brandColorRgb || [0, 0, 0];
    const barTextRgb = branding ? textColorForBg(brandRgb) : [255, 255, 255] as [number, number, number];
    const companyName = branding?.companyName || "Script To Cast";

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const w = doc.internal.pageSize.getWidth();
    const m = 15;
    let y = 0;

    // Header bar
    if (branding) {
      doc.setFillColor(brandRgb[0], brandRgb[1], brandRgb[2]);
    } else {
      doc.setFillColor(0, 0, 0);
    }
    doc.rect(0, 0, w, 20, "F");

    let headerX = m;
    if (branding?.logoBase64) {
      try {
        const fmt = branding.logoFormat === "png" ? "PNG" : "JPEG";
        doc.addImage(branding.logoBase64, fmt, m, 2, 16, 16);
        headerX = m + 20;
      } catch {
        // Logo embed failed, continue without
      }
    }

    doc.setTextColor(barTextRgb[0], barTextRgb[1], barTextRgb[2]);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(companyName, headerX, 13);

    // Optional header text below
    if (branding?.headerText) {
      y = 24;
      doc.setTextColor(100);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.text(branding.headerText, m, y);
      y += 6;
    } else {
      y = 28;
    }

    // Job info table
    doc.setFillColor(240, 240, 240);
    doc.rect(m, y, w - m * 2, 6, "F");
    doc.setTextColor(0);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("JOB INFORMATION", m + 2, y + 4.5);
    y += 8;

    const info = [
      ["Project:", projectName],
      ["Brand:", brand],
      ["Location:", location],
      ["Production Dates:", productionDates],
      ["Role Name:", roleName],
    ].filter(([, v]) => v);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (const [label, value] of info) {
      doc.setFont("helvetica", "bold");
      doc.text(label, m + 2, y + 3.5);
      doc.setFont("helvetica", "normal");
      doc.text(value, m + 40, y + 3.5);
      y += 5;
    }
    y += 5;

    // Section bar helper
    function sectionBar(title: string) {
      if (branding) {
        doc.setFillColor(brandRgb[0], brandRgb[1], brandRgb[2]);
        doc.rect(m, y, w - m * 2, 6, "F");
        doc.setTextColor(barTextRgb[0], barTextRgb[1], barTextRgb[2]);
      } else {
        doc.setFillColor(0, 0, 0);
        doc.rect(m, y, w - m * 2, 6, "F");
        doc.setTextColor(255, 255, 255);
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(title, m + 2, y + 4.5);
      y += 10;
      doc.setTextColor(0);
    }

    // Step 1
    sectionBar("Step 1: Online Talent Form");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Please complete the Online Talent Form. Submissions cannot be accepted without a completed form.", m, y);
    y += 8;

    // Step 2
    sectionBar("Step 2: Record Audition Videos");
    for (let i = 0; i < (videos || []).length; i++) {
      const v = videos[i];
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`VIDEO ${i + 1} (LABEL IT '${v.label}')`, m, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(v.description, w - m * 2);
      doc.text(lines, m, y);
      y += lines.length * 4 + 4;
      if (y > 270) { doc.addPage(); y = 15; }
    }

    // Step 3
    if (photos?.length) {
      sectionBar("Step 3: Photos");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      photos.forEach((p: string, i: number) => {
        doc.text(`${i + 1}. ${p}`, m + 2, y);
        y += 5;
      });
      y += 3;
    }

    // Filming Notes
    if (filmingNotes?.length) {
      if (y > 240) { doc.addPage(); y = 15; }
      sectionBar("Filming Notes");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      filmingNotes.forEach((n: string, i: number) => {
        const lines = doc.splitTextToSize(`${i + 1}. ${n}`, w - m * 2 - 4);
        doc.text(lines, m + 2, y);
        y += lines.length * 4 + 2;
      });
    }

    // Footer
    doc.setTextColor(150);
    doc.setFontSize(7);
    const footerParts: string[] = [];
    if (branding) {
      if (branding.companyName !== "Script To Cast") footerParts.push(branding.companyName);
      if (branding.contactEmail) footerParts.push(branding.contactEmail);
      if (branding.contactPhone) footerParts.push(branding.contactPhone);
      if (branding.contactWebsite) footerParts.push(branding.contactWebsite);
    }
    const footerLine1 = footerParts.length > 0
      ? footerParts.join("  |  ")
      : "Generated by Script To Cast — scripttocast.com";
    doc.text(footerLine1, m, 286);

    if (branding?.footerText) {
      doc.text(branding.footerText, m, 290);
    } else if (footerParts.length > 0) {
      doc.text("Generated by Script To Cast — scripttocast.com", m, 290);
    }

    const buffer = new Uint8Array(doc.output("arraybuffer"));
    return new NextResponse(buffer as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Self-Tape_${roleName.replace(/\s+/g, "_")}.pdf"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
