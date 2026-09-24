/**
 * Checks for choosing audition sides. No model, no server.
 *
 *   npm run check:sides
 *
 * Two halves. Hand-built scenes test each rule in isolation, where the right
 * answer is unambiguous. Then a real PDF goes end to end — extraction, scenes,
 * selection, and the marked-up sides document — the way the app runs it.
 */
import { registerHooks } from "node:module";

// The app's modules are TypeScript importing each other without extensions,
// and one path alias; teach resolution both, then load the real code.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        // Fall through to the specifier as written.
      }
    }
    try {
      return next(specifier, context);
    } catch (error) {
      // Package subpaths like next/server, which a bundler resolves to .js.
      if (!specifier.startsWith(".")) return next(`${specifier}.js`, context);
      throw error;
    }
  },
});

const { selectSides, sidesTierFor, matchSpeaker } = await import("../src/lib/sides.ts");
const { segmentScenes } = await import("../src/lib/local/screenplay.ts");
const { extractDocument } = await import("../src/lib/local/extract.ts");
const { makeBlockingPdf } = await import("./make-test-script.mjs");

let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/** A scene from a compact description: [speaker, lines] pairs and action. */
let nextIndex = 0;
function scene(heading, page, beats) {
  const lines = [{ page, kind: "scene", text: heading }];
  for (const beat of beats) {
    if (typeof beat === "string") {
      lines.push({ page, kind: "action", text: beat });
      continue;
    }
    const [speaker, count] = beat;
    lines.push({ page, kind: "cue", text: speaker, speaker });
    for (let i = 0; i < count; i++) lines.push({ page, kind: "dialogue", text: `line ${i}`, speaker });
  }
  return { index: nextIndex++, heading, startPage: page, endPage: page, lines };
}
const reindex = (scenes) => scenes.map((s, i) => ({ ...s, index: i }));

console.log("\nchoosing scenes");
{
  const scenes = reindex([
    scene("INT. KITCHEN - NIGHT", 5, [["ANNA", 6], ["BEN", 5], ["ANNA", 6]]),
    scene("EXT. STREET - DAY", 10, ["She runs.", "Cars swerve.", "Glass everywhere.", "She keeps running.", "A bus.", "She jumps.", ["ANNA", 3]]),
    scene("INT. PARTY - NIGHT", 20, [["ANNA", 3], ["BEN", 2], ["CARL", 2], ["DOT", 2], ["EVE", 2]]),
    scene("INT. OFFICE - DAY", 30, [["ANNA", 5], ["CARL", 5], ["ANNA", 4]]),
    scene("INT. KITCHEN - LATER", 31, [["ANNA", 5], ["BEN", 5]]),
    // Stronger than the office scene on lines alone, but it is Ben again.
    scene("INT. GARAGE - NIGHT", 35, [["ANNA", 5], ["BEN", 4], ["ANNA", 5]]),
    scene("INT. BEDROOM - NIGHT", 40, ["They undress.", ["ANNA", 6], ["BEN", 6]]),
    scene("INT. ROOF - DAWN", 96, [["ANNA", 8], ["BEN", 8]]),
  ]);
  const pick = selectSides(scenes, "Anna", "LEAD", 100);
  const headings = pick.chosen.map((c) => c.heading);
  check("a lead gets two scenes", pick.chosen.length === 2, headings.join(" | "));
  check(
    "the two-person dialogue scenes win over action and crowd scenes",
    headings.includes("INT. KITCHEN - NIGHT") && !headings.includes("EXT. STREET - DAY") && !headings.includes("INT. PARTY - NIGHT"),
    headings.join(" | "),
  );
  check(
    "the second scene contrasts with the first: a different partner or place",
    headings.includes("INT. OFFICE - DAY"),
    headings.join(" | "),
  );
  check(
    "a different scene partner is preferred over the same partner somewhere else",
    headings.includes("INT. OFFICE - DAY") && !headings.includes("INT. GARAGE - NIGHT"),
    headings.join(" | "),
  );
  check(
    "nudity is held out by default",
    !headings.includes("INT. BEDROOM - NIGHT") &&
      pick.candidates.find((c) => c.heading === "INT. BEDROOM - NIGHT")?.flags.some((f) => /intimacy/i.test(f)),
  );
  check(
    "the last pages are held out: that is where the ending is",
    !headings.includes("INT. ROOF - DAWN") &&
      pick.candidates.find((c) => c.heading === "INT. ROOF - DAWN")?.flags.some((f) => /ending/i.test(f)),
  );
  check(
    "held-out scenes are still offered as candidates to swap in",
    pick.candidates.some((c) => c.heading === "INT. ROOF - DAWN"),
  );
  check(
    "every choice says why",
    pick.chosen.every((c) => c.reasons.length > 0),
    JSON.stringify(pick.chosen.map((c) => c.reasons)),
  );
}

console.log("\nlength by size of role");
{
  const long = reindex([
    scene("INT. COURTROOM - DAY", 12, Array.from({ length: 70 }, (_, i) => [i % 2 ? "JUDGE" : "RAY", 3])),
  ]);
  const lead = selectSides(long, "Ray", "LEAD", 100);
  check("a long scene is trimmed to at most three pages", lead.chosen[0]?.lengthPages <= 3, `${lead.chosen[0]?.lengthPages}`);
  check("and says it was trimmed", lead.chosen[0]?.trimmed && lead.chosen[0].reasons.some((r) => /Trimmed/.test(r)));

  const day = selectSides(long, "Ray", "DAY PLAYER", 100);
  check("a day player reads about a page", day.chosen[0]?.lengthPages <= 1, `${day.chosen[0]?.lengthPages}`);

  const bit = reindex([scene("INT. DINER - NIGHT", 3, [["WAITRESS", 1], ["RAY", 4], ["WAITRESS", 1]])]);
  const small = selectSides(bit, "Waitress", "DAY PLAYER", 100);
  check("a part with only two lines still gets its scene", small.chosen.length === 1);
}

console.log("\nmatching the role to the script");
{
  const scenes = reindex([scene("INT. ROOM - DAY", 1, [["COBB", 3], ["ARTHUR", 3]])]);
  check("a full name matches the cue", matchSpeaker("Dom Cobb", scenes) === "COBB");
  check("case does not matter", matchSpeaker("arthur", scenes) === "ARTHUR");
  check("a role that never speaks matches nothing", matchSpeaker("Mal", scenes) === null);
  check("role types map to sizes", sidesTierFor("SERIES REGULAR") === "LEAD" && sidesTierFor("CO-STAR") === "DAY PLAYER" && sidesTierFor("GUEST STAR") === "SUPPORTING");
}

console.log("\na real PDF, end to end");
{
  const bytes = await makeBlockingPdf();
  const doc = await extractDocument(new File([bytes], "fixture.pdf", { type: "application/pdf" }));
  const scenes = segmentScenes(doc.pageLines);
  check("scenes are found", scenes.length === 12, `${scenes.length}`);
  check("lines keep their position on the page", scenes[0].lines.every((l) => typeof l.y === "number"));

  const renna = selectSides(scenes, "Renna", "LEAD", doc.pages.length);
  const pages = renna.chosen.reduce((sum, c) => sum + c.lengthPages, 0);
  check("the lead reads two scenes, not every page she is on", renna.chosen.length === 2, renna.chosen.map((c) => c.heading).join(" | "));
  check("within five pages", pages <= 5, `${pages}`);

  // The marked-up PDF, through the real route handler.
  const { POST } = await import("../src/app/api/generate-sides/route.ts");
  const form = new FormData();
  form.append("script", new File([bytes], "fixture.pdf", { type: "application/pdf" }));
  form.append("roleName", "Renna");
  form.append("selections", JSON.stringify(renna.chosen));
  const res = await POST(new Request("http://local/api/generate-sides", { method: "POST", body: form }));
  const out = new Uint8Array(await res.arrayBuffer());
  const marked = await extractDocument(new File([out], "sides.pdf", { type: "application/pdf" }));
  const text = marked.pages.join("\n");
  check("the sides PDF has only the chosen pages", marked.pages.length === renna.chosen.reduce((n, c) => n + c.pages.length, 0), `${marked.pages.length} pages`);
  check("each scene is marked START and END", (text.match(/START/g) ?? []).length === 2 && (text.match(/\bEND\b/g) ?? []).length >= 2);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
