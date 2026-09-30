/**
 * Model-free checks for local OCR, watermark handling and the word-spacing fix.
 *   npm run check:ocr
 * No model, no network, no real script. Synthetic pages and PDFs only. Tesseract
 * itself is not needed here (the real-scan run is separate).
 */
import { registerHooks } from "node:module";
registerHooks({
  resolve(s, c, n) {
    if (s.startsWith("@/")) return n(new URL(`../src/${s.slice(2)}.ts`, import.meta.url).href, c);
    if (s.startsWith(".") && !/\.[a-z]+$/.test(s)) { try { return n(`${s}.ts`, c); } catch {} }
    return n(s, c);
  },
});
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
const { extractDocument, ocrReason, isWordPerItemLayer, groupIntoRows } = await import("../src/lib/local/extract.ts");
const { wordStats, looksGarbled, setDictionaryForTests } = await import("../src/lib/local/wordcheck.ts");
const I = await import("../src/lib/local/ocr-image.ts");
const O = await import("../src/lib/local/ocr.ts");
const W = await import("../src/lib/local/watermark.ts");
const { makeScreenplayPdf, makeScannedPdf, makeBlockingPdf } = await import("./make-test-script.mjs");

let failed = 0;
const ok = (cond, what, extra = "") => { if (!cond) { failed++; console.error("FAIL", what, extra); } else console.log("ok  ", what); };
const pdfFile = (bytes, name = "t.pdf") => new File([bytes], name, { type: "application/pdf" });

// ---- word check and OCR trigger
const prose = "The bay was blocked and she told them so, politely, while the rest of the crew waited by the doors. ".repeat(6);
const noise = "xqzvt brnkw ghjkl mnbvc zxcvb qwrtp lkjhg fdsaq ".repeat(30);
ok(wordStats(prose).ratio > 0.9, "prose reads as real words", String(wordStats(prose).ratio));
ok(wordStats(noise).ratio < 0.2 && looksGarbled(wordStats(noise)), "noise reads as garbled");
ok(!looksGarbled(wordStats("HETTY  Hello there.")), "a short page is never called garbled (too few words)");
ok(ocrReason(0, null) === "no-text-layer" && ocrReason(199, null) === "no-text-layer", "trigger: under 200 chars means no text layer");
ok(ocrReason(5000, wordStats(prose)) === null, "trigger: a healthy text layer never triggers OCR");
ok(ocrReason(5000, wordStats(noise)) === "garbled-text-layer", "trigger: a garbled text layer triggers OCR in auto mode");
ok(ocrReason(5000, null) === null, "trigger: garbled check is skipped when not asked for (empty mode / v1)");
{
  const saved = setDictionaryForTests; // dictionary-less fallback still separates prose from noise
  setDictionaryForTests(null);
  ok(wordStats(prose).ratio > 0.8 && wordStats(noise).ratio < 0.3, "no system dictionary: shape test still separates prose from noise");
  setDictionaryForTests(undefined);
  void saved;
}

// ---- switches and v1 behaviour on a scan
const scan = await makeScannedPdf();
let msg = "";
try { await extractDocument(pdfFile(scan)); } catch (e) { msg = e.message; }
ok(/has no text layer/.test(msg), "default (v1): a scan still throws the same 'no text layer' error");
msg = "";
process.env.LOCAL_OCR = "0";
try { await extractDocument(pdfFile(scan), { ocr: "auto" }); } catch (e) { msg = e.message; }
if (!msg) msg = "(no error)";
ok(/has no text layer/.test(msg) && /LOCAL_OCR=0/.test(msg), "LOCAL_OCR=0 disables OCR for v2 and says so");
ok(!O.ocrEnabled(), "ocrEnabled false for LOCAL_OCR=0");
for (const off of ["false", "off", "no"]) { process.env.LOCAL_OCR = off; ok(!O.ocrEnabled(), `LOCAL_OCR=${off} disables`); }
process.env.LOCAL_OCR = "1"; ok(O.ocrEnabled(), "LOCAL_OCR=1 enables");
delete process.env.LOCAL_OCR; ok(O.ocrEnabled(), "OCR is on by default");

// ---- no regression on normal text PDFs
for (const [name, make] of [["screenplay", makeScreenplayPdf], ["blocking", makeBlockingPdf]]) {
  const bytes = await make();
  const a = await extractDocument(pdfFile(bytes));
  const b = await extractDocument(pdfFile(bytes), { ocr: "auto" });
  const c = await extractDocument(pdfFile(bytes), { ocr: "empty" });
  const same = JSON.stringify([a.pages, a.pageLines]) === JSON.stringify([b.pages, b.pageLines]) && JSON.stringify(a.pages) === JSON.stringify(c.pages);
  ok(same, `normal text PDF (${name}): identical text, indents and y with OCR modes on`);
  ok(!b.ocr && !b.watermarkItemsRemoved, `normal text PDF (${name}): no OCR, no watermark removal`);
}

// ---- spacing: word-per-item layer (what OCR writes) vs kerning splits
// pdf.js adds its own space items for ordinary fonts, so the glued case is
// tested on the items directly, the way an OCR tool's invisible text arrives.
{
  const item = (str, x, w = str.length * 6.6) => ({ str, x, y: 700, angle: 0, width: w, height: 11 });
  const words = "Tell them the bay was blocked and I said it politely".split(" ");
  let x = 100; const ocrItems = words.map((w) => { const it = item(w, x); x += w.length * 6.6 + 6.6; return it; });
  ok(groupIntoRows(ocrItems, false)[0].text === words.join(""), "spacing: without the fix (v1) word-per-item text is glued, as before");
  ok(groupIntoRows(ocrItems, true)[0].text === words.join(" "), "spacing: gap rule restores single spaces on a word-per-item layer", groupIntoRows(ocrItems, true)[0].text);
  x = 100; const kerned = ["Te", "ll", " ", "the", "m", " b", "ay"].map((s) => { const it = item(s, x); x += s.length * 6.6 + 0.3; return it; });
  ok(groupIntoRows(kerned, true)[0].text === "Tell them bay", "spacing: touching mid-word pieces and existing space items are not split or doubled", groupIntoRows(kerned, true)[0].text);
  ok(!/  /.test(groupIntoRows(ocrItems, true)[0].text), "spacing: never doubles a space");
  const indented = [item("A", 100), item("B", 300)];
  ok(groupIntoRows(indented, true)[0].x === 100, "spacing: the row's left edge is unchanged");
  const it = (str) => ({ str, x: 0, y: 0, angle: 0, width: 5, height: 10 });
  ok(!isWordPerItemLayer([Array.from({ length: 10 }, () => it("word"))]), "gate: under 50 items never counts as OCR-style");
  ok(!isWordPerItemLayer([Array.from({ length: 80 }, () => it("two words here"))]), "gate: items holding spaces are a normal layer");
  ok(!isWordPerItemLayer([Array.from({ length: 80 }, (_, i) => it(i % 2 ? " " : "wo"))]), "gate: a layer with its own space items is a normal layer");
  ok(isWordPerItemLayer([Array.from({ length: 80 }, () => it("word"))]), "gate: many single-word items is an OCR-style layer");
  const pdf = await makeScreenplayPdf();
  const a = await extractDocument(pdfFile(pdf)); const b = await extractDocument(pdfFile(pdf), { ocr: "auto" });
  ok(JSON.stringify(a.pageLines) === JSON.stringify(b.pageLines), "spacing: a normal PDF's lines are identical with the gate open");
}

// ---- text-layer watermark
async function watermarkedPdf(angle, text = "JANE Q. SAMPLE", pages = 6) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);
  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([612, 792]);
    page.drawText("INT. KITCHEN - DAY", { x: 108, y: 700, size: 12, font });
    page.drawText("MARA", { x: 266, y: 660, size: 12, font });
    page.drawText("MARA looks at the clock over the door and does not answer him at all.", { x: 108, y: 600, size: 12, font });
    page.drawText(`Tell them the bay was blocked, page ${p + 1}. It was, and I said so twice to the supervisor on the night shift. Nobody in the building disagreed with that.`, { x: 180, y: 640, size: 12, font });
    page.drawText(text, { x: 150, y: 250, size: 36, font, rotate: degrees(angle), opacity: 0.2 });
  }
  return Buffer.from(await pdf.save());
}
{
  const bytes = await watermarkedPdf(45);
  const off = await extractDocument(pdfFile(bytes));
  const on = await extractDocument(pdfFile(bytes), { ocr: "auto" });
  ok(off.pages[0].includes("SAMPLE"), "text watermark: present without cleaning (v1 unchanged)");
  ok(!on.pages.join("\n").includes("SAMPLE") && !on.pages.join("\n").includes("JANE") && on.watermarkItemsRemoved >= 6, "text watermark: repeated diagonal string removed on every page", String(on.watermarkItemsRemoved));
  ok(on.pages[0].includes("MARA") && on.pages[0].includes("bay was blocked"), "text watermark: script lines survive");
  const flat = await watermarkedPdf(0);
  const f = await extractDocument(pdfFile(flat), { ocr: "auto" });
  ok(f.pages[0].includes("SAMPLE") && !f.watermarkItemsRemoved, "text watermark: a repeated string at 0 degrees is script-like, kept");
  const few = await watermarkedPdf(45, "JANE Q. SAMPLE", 2);
  const g = await extractDocument(pdfFile(few), { ocr: "auto" });
  ok(g.pages[0].includes("SAMPLE"), "text watermark: two pages is not enough evidence, kept");
}

// ---- adaptive threshold on synthetic pages
// Type strokes are 5px tall, 30px wide, at x=40+44s, y=30+42r. Leak is measured
// well away from the strokes (their blurred edges are not stipple).
function measure(gray, sigma = 1.5) {
  const blurred = I.gaussianBlur(gray, sigma);
  const { first, others } = I.candidateThresholds(blurred);
  const bin = I.binarize(blurred, first);
  const distTo = (v, start, size, step, n) => {
    const k = Math.min(n - 1, Math.max(0, Math.round((v - start - size / 2) / step)));
    const lo = start + k * step, hi = lo + size;
    return v < lo ? lo - v : v > hi ? v - hi : 0;
  };
  let strokePx = 0, strokeInk = 0, farPx = 0, farInk = 0;
  for (let y = 0; y < bin.h; y++) for (let x = 0; x < bin.w; x++) {
    const dy = distTo(y, 30, 5, 42, 8), dx = distTo(x, 40, 30, 44, 12);
    const core = dy === 0 && dx === 0;
    if (core) { strokePx++; strokeInk += bin.bits[y * bin.w + x]; } else if (Math.max(dx, dy) > 12) { farPx++; farInk += bin.bits[y * bin.w + x]; }
  }
  return { first, others, keep: strokeInk / strokePx, leak: farInk / farPx, blurred };
}
{
  for (const [label, stipple, ink, density] of [["light stipple", 215, 10, 0.5], ["mid stipple", 180, 10, 0.5], ["dark stipple", 150, 25, 0.7], ["very dark stipple", 120, 20, 0.7], ["very light stipple", 235, 0, 0.8]]) {
    const m = measure(I.syntheticPage({ stipple, ink, density }));
    ok(m.keep > 0.75 && m.leak < 0.01, `adaptive threshold: ${label} (cut ${m.first}, type kept ${(m.keep * 100).toFixed(0)}%, stipple leaked ${(m.leak * 100).toFixed(2)}%)`);
  }
  // A single fixed cut cannot serve every watermark: 190 lets a dark stipple in, 110 loses the type on a page of faint ink.
  const dark = measure(I.syntheticPage({ stipple: 150, ink: 25, density: 0.7 }));
  const fixedBin = I.binarize(dark.blurred, 190);
  ok(I.inkFraction(fixedBin.bits) > I.inkFraction(I.binarize(dark.blurred, dark.first).bits) * 1.3, "adaptive threshold: a fixed cut of 190 would let a dark stipple in (the reason the cut is chosen per page)");
  const blank = I.gaussianBlur(I.syntheticPage({ stipple: 215, ink: 215, density: 0.5 }), 1.5);
  ok(I.inkFraction(I.binarize(blank, I.candidateThresholds(blank).first).bits) < 0.0005, "adaptive threshold: a stipple-only page has no ink (page skipped)");
  const alts = I.candidateThresholds(I.gaussianBlur(I.syntheticPage({ stipple: 180, ink: 10, density: 0.5 }), 1.5));
  ok(alts.others.length >= 2 && alts.others.every((v) => Math.abs(v - alts.first) >= 8), "adaptive threshold: retry cuts are distinct from the first guess");
}
{
  // Image plumbing.
  const g = { w: 3, h: 2, data: Uint8Array.from([0, 255, 255, 255, 255, 0]) };
  const b0 = I.binarize(g, 100, 0), b180 = I.binarize(g, 100, 180), b90 = I.binarize(g, 100, 90);
  ok(b0.bits[0] === 1 && b0.bits[5] === 1 && b180.bits[5] === 1 && b180.bits[0] === 1, "rotate 180 maps corners");
  ok(b90.w === 2 && b90.h === 3 && b90.bits[1] === 1, "rotate 90 swaps dimensions", String([...b90.bits]));
  const pbm = I.toPbm(b0).toString("latin1");
  ok(pbm.startsWith("P4\n3 2\n"), "PBM header");
  const pgm = Buffer.concat([Buffer.from("P5\n# c\n3 2\n255\n"), Buffer.from([1, 2, 3, 4, 5, 6])]);
  ok(I.parsePgm(pgm).data[5] === 6, "PGM parse with comment");
}

// ---- rows: TSV to lines, watermark rows, diagonal stipple runs
{
  const tsv = ["level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "5\t1\t1\t1\t1\t1\t300\t100\t50\t20\t90\tHello", "5\t1\t1\t1\t1\t2\t400\t100\t50\t20\t80\tthere"].join("\n");
  const rows = O.rowsFromTsv(tsv, 3300);
  ok(rows.length === 1 && rows[0].text === "Hello there" && Math.abs(rows[0].x - 72) < 0.1, "OCR words become one line with a left edge in points");
}
{
  const page = (p, extra = []) => [
    { text: "INT. HOUSE - DAY", x: 72, y: 700 - p * 3 },
    { text: "MARA", x: 216, y: 640, conf: 90 },
    { text: "CONTINUED", x: 72, y: 90, conf: 90 },
    ...extra,
  ];
  const wm = (p) => ({ text: "JANE SAMPLE", x: 40 + (p * 73) % 400, y: 200 + (p * 41) % 300, conf: 50 });
  const pages = Array.from({ length: 10 }, (_, p) => page(p, [wm(p)]));
  const drop = W.watermarkRows(pages, pages.map(() => 792));
  ok(pages.every((rows) => drop.has(rows[3])), "watermark rows: a name that wanders across the page on every page is dropped");
  ok(pages.every((rows) => !drop.has(rows[1]) && !drop.has(rows[0])), "watermark rows: a repeated cue in its column is kept");
  ok(pages.every((rows) => !drop.has(rows[2])), "watermark rows: CONTINUED (footer band, allowed repeat) is kept");
  const strays = Array.from({ length: 10 }, (_, p) => [{ text: "GEORGE-MICHAEL", x: p % 4 === 0 ? 60 : 216, y: 500 - p * 7, conf: 80 }, { text: "INT. HOUSE - DAY", x: 72, y: 700 - p * 11, conf: 90 }]);
  ok(W.watermarkRows(strays, strays.map(() => 792)).size === 0, "watermark rows: a cue that OCR pushed left on a few pages is still a cue, kept");
  const fixed = Array.from({ length: 10 }, (_, p) => page(p, [{ text: "DRAFT COPY NOT FOR RELEASE", x: 120, y: 400, conf: 60 }]));
  ok(W.watermarkRows(fixed, fixed.map(() => 792)).size === 10, "watermark rows: identical text at identical spot on every page is dropped");
  const few = Array.from({ length: 10 }, (_, p) => page(p, p < 2 ? [wm(p)] : []));
  ok(W.watermarkRows(few, few.map(() => 792)).size === 0, "watermark rows: a line on 2 of 10 pages is script, kept");
  // Diagonal run of weak junk on a single page.
  const diag = [[{ text: "xq", x: 100, y: 200, conf: 40 }, { text: "zvt", x: 200, y: 300, conf: 40 }, { text: "kk", x: 300, y: 400, conf: 40 },
    { text: "bq", x: 400, y: 500, conf: 40 }, { text: "jx", x: 500, y: 600, conf: 40 }, { text: "This is a real line of dialogue.", x: 180, y: 350, conf: 92 }]];
  const dd = W.watermarkRows(diag, [792]);
  ok(dd.size === 5 && !dd.has(diag[0][5]), "watermark rows: a diagonal run of weak fragments is dropped, real dialogue stays", String(dd.size));
}

// ---- cue snapping and headings
{
  const cue = (text) => ({ text, indent: 216 });
  const talk = (text) => ({ text, indent: 144 });
  const lines = [[]];
  const add = (name, n) => { for (let i = 0; i < n; i++) { lines[0].push(cue(name)); lines[0].push(talk("Hello there.")); } };
  add("ISAAC", 8); add("TSAAC", 3); add("HETTY", 1); add("SETTY", 6); add("THORFINN", 2); add("THORP TI", 1); add("SAMANTHA", 10); add("SAMANTEA", 4);
  add("JAY", 5); add("JAY (V.O.)", 1); add("MARA / ISAAC", 1);
  const cast = ["ISAAC", "HETTY", "THORFINN", "SAMANTHA", "JAY", "FICWER W"];
  const fixes = W.snapCues(lines, cast);
  const names = new Set(lines[0].filter((l) => l.indent === 216).map((l) => l.text));
  ok(!names.has("TSAAC") && !names.has("SETTY") && !names.has("SAMANTEA") && !names.has("THORP TI"), "cue snap: ISAAC/HETTY/THORFINN/SAMANTHA misreads snap to the cast list", [...names].join(","));
  ok(names.has("JAY (V.O.)"), "cue snap: a qualifier is kept");
  ok(names.has("MARA / ISAAC"), "cue snap: a dual cue with correct names is untouched");
  ok(fixes.some((f) => f.from === "SETTY" && f.to === "HETTY"), "cue snap: a misread repeated 6 times is still corrected against the cast list");
  const real = [[cue("KEVIN"), talk("hi"), cue("KEVIN"), talk("hi"), cue("KELVIN"), talk("hi"), cue("KEVIN"), talk("hi"), cue("KELVIN"), talk("hi"), cue("KELVIN"), talk("hi")]];
  ok(W.snapCues(real, []).length === 0, "cue snap: two real, similar names that both repeat are not merged");
  const dialogueOnly = [[{ text: "SETTY", indent: 30 }]];
  W.snapCues(dialogueOnly, ["HETTY"]);
  ok(dialogueOnly[0][0].text === "SETTY", "cue snap: text not at a cue indent is never touched");
}
{
  const l = (text) => ({ text, indent: 15 });
  const pages = [[l("4 THT. WOOSSTOME ESTATE - BEDROOM 61 - EVENING (D1) 4"), l("11 INT. HOUSE - DAY 11"), l("The door opens. Then it shuts, hard."), l("DA HEY - SOMETHING ELSE 5")]];
  const n = W.repairSceneHeadings(pages);
  ok(pages[0][0].text.startsWith("INT. WOOSSTOME") && pages[0][1].text === "INT. HOUSE - DAY 11".replace(/ 11$/, "") || pages[0][1].text.startsWith("INT. HOUSE"), "headings: a misread INT and margin scene numbers are repaired", pages[0][0].text + " | " + pages[0][1].text);
  ok(pages[0][2].text === "The door opens. Then it shuts, hard.", "headings: action lines are never touched");
  ok(!/^(INT|EXT)\./.test(pages[0][3].text), "headings: a numbered non-slugline is not turned into a heading");
  ok(n >= 1, "headings: count reported");
}

console.log(failed ? `\n${failed} failed` : "\nall OCR checks passed");
process.exit(failed ? 1 : 0);
