/**
 * Builds a synthetic screenplay PDF with a real text layer, and a scanned-style
 * PDF with none, so the private path can be tested without shipping a script
 * into the repo.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";

const SCENES = [
  {
    heading: "INT. AMBULANCE BAY - NIGHT",
    action:
      "MARA VOSS, late thirties, unhurried in a way that reads as either calm or contempt, backs a rig into a space it does not fit.",
    lines: [
      ["MARA", "Tell them the bay was blocked. Tell them I said it politely."],
      ["OTIS", "You want me to lie to a supervisor on a Tuesday."],
      ["MARA", "I want you to say the bay was blocked, which it was, by a supervisor."],
    ],
  },
  {
    heading: "INT. HOSPITAL CORRIDOR - CONTINUOUS",
    action:
      "DEVLIN PARK, forties, a man who irons things, walks with a clipboard held like a shield.",
    lines: [
      ["DEVLIN", "There is a process for this and you have never once used it."],
      ["MARA", "The process takes nine minutes. He had four."],
      ["DEVLIN", "That is not the point I am making and you know it."],
      ["MARA", "Then make a better one, Devlin."],
    ],
  },
  {
    heading: "EXT. PARKING STRUCTURE - LATER",
    action: "Rain. NURSE PELL, twenties, smokes under a sign forbidding it.",
    lines: [
      ["NURSE PELL", "You are going to get written up."],
      ["MARA", "I am going to get coffee."],
      ["NURSE PELL", "Those are the same sentence around here."],
    ],
  },
  {
    heading: "INT. DISPATCH - NIGHT",
    action: "Screens. Coffee rings. OTIS BRAND, sixty, eats a sandwich with total focus.",
    lines: [
      ["OTIS", "Twenty-two years and nobody has ever thanked me for a shortcut."],
      ["MARA", "I will thank you when it works."],
      ["OTIS", "It always works. That is what makes it a shortcut."],
      ["DEVLIN", "I would like that on the record."],
    ],
  },
  {
    heading: "EXT. HIGHWAY - PRE-DAWN",
    action: "The rig moves fast through empty lanes.",
    lines: [
      ["MARA", "Call it in when we cross the county line. Not before."],
      ["OTIS", "And if they ask where we are?"],
      ["MARA", "Tell them we are exactly where we said we would be."],
    ],
  },
];

/** Screenplay-ish layout. Indentation is decorative — the parser trims it. */
function pageLines(scene) {
  const out = [scene.heading, "", scene.action, ""];
  for (const [cue, line] of scene.lines) {
    out.push(`                    ${cue}`);
    out.push(`          ${line}`);
    out.push("");
  }
  return out;
}

export async function makeScreenplayPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);

  for (const scene of SCENES) {
    const page = pdf.addPage([612, 792]);
    let y = 720;
    for (const line of pageLines(scene)) {
      // pdf-lib throws on characters Courier cannot encode.
      const safe = line.replace(/[^\x20-\x7E]/g, "-");
      page.drawText(safe, { x: 72, y, size: 11, font });
      y -= 16;
    }
  }

  return Buffer.from(await pdf.save());
}

/** A PDF with no text layer at all — what a scanned script looks like. */
export async function makeScannedPdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  pdf.addPage([612, 792]);
  return Buffer.from(await pdf.save());
}
