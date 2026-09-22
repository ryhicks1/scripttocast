/**
 * Score a breakdown against the real Breakdown Services corpus.
 *
 * This turns "is the private version good enough to offer?" into numbers, and
 * lets the two paths be compared on identical input.
 *
 *   # analyse a script locally and score it (needs `npm run dev` + Ollama)
 *   node scripts/eval-local.mjs script.pdf --out local.json
 *
 *   # the same script through the public Claude path, for comparison
 *   node scripts/eval-local.mjs script.pdf --endpoint /api/analyze --out claude.json
 *
 *   # compare saved results side by side, no analysis
 *   node scripts/eval-local.mjs local.json claude.json
 *
 * The reference column is scripts/corpus/reference-metrics.json — aggregate
 * statistics from 310 real role entries. See scripts/corpus/parse-corpus.mjs.
 *
 * What this measures is house-style conformance: does a description open with
 * the demographic line, run to the right length, carry a role type, and avoid
 * narrative-summary voice. It cannot tell you whether a description is *true*
 * to the script — only reading it against the script does that.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { measureDescription, summarise } from "./lib/breakdown-metrics.mjs";

const reference = JSON.parse(
  readFileSync(new URL("./corpus/reference-metrics.json", import.meta.url), "utf8"),
);

function parseArgs(argv) {
  const inputs = [];
  const options = { endpoint: "/api/analyze-local", server: "http://localhost:3000", mode: "auto" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--endpoint") options.endpoint = argv[++i];
    else if (arg === "--server") options.server = argv[++i];
    else if (arg === "--mode") options.mode = argv[++i];
    else if (arg === "--out") options.out = argv[++i];
    else inputs.push(arg);
  }
  return { inputs, options };
}

async function analyseFile(path, options) {
  if (!options.endpoint.includes("analyze-local")) {
    // Worth saying out loud: the public path is the one that leaves the machine.
    console.warn(
      `! ${options.endpoint} sends this document to the Anthropic API. ` +
        `Only /api/analyze-local keeps it local.\n`,
    );
  }
  const form = new FormData();
  const bytes = readFileSync(path);
  form.append("files", new File([bytes], basename(path), { type: "application/pdf" }));
  form.append("mode", options.mode);

  const started = Date.now();
  const res = await fetch(`${options.server}${options.endpoint}`, { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${res.status}: ${body.error ?? "analysis failed"}${body.detail ? ` (${body.detail})` : ""}`);
  }
  body.__elapsedSeconds = Math.round((Date.now() - started) / 1000);
  return body;
}

function profileOf(result) {
  const roles = result.roles ?? [];
  if (!roles.length) throw new Error("no roles in this result");
  return summarise(roles.map((role) => measureDescription(role.description)));
}

/**
 * Gates worth failing over.
 *
 * Most are anchored to the corpus rather than to a number someone liked.
 * Two are not:
 *  - roleTypeStatedRate has a fixed floor, because we append the tier in code,
 *    while a quarter of real entries simply omit it.
 *  - ethnicityStatedRate is reported but never gated. Real breakdowns state an
 *    ethnic background 97% of the time, mostly as "all ethnicities"; the local
 *    prompt is told never to guess one. Scoring against the corpus here would
 *    reward inventing them.
 */
function gatesFor(ref) {
  return [
    {
      key: "emptyRate",
      label: "descriptions with content",
      value: (p) => p.emptyRate,
      ok: (v) => v <= 0.05,
      expect: "≤ 0.05",
      format: (v) => v.toFixed(3),
    },
    {
      key: "demographicHeadRate",
      label: "opens with gender + age",
      value: (p) => p.demographicHeadRate,
      ok: (v) => v >= ref.demographicHeadRate - 0.2,
      expect: `≥ ${(ref.demographicHeadRate - 0.2).toFixed(2)}`,
      format: (v) => v.toFixed(3),
    },
    {
      key: "roleTypeStatedRate",
      label: "carries a role type",
      value: (p) => p.roleTypeStatedRate,
      ok: (v) => v >= 0.9,
      expect: "≥ 0.90",
      format: (v) => v.toFixed(3),
      note:
        "a floor on our own assembly, not a corpus figure — we always append a tier, " +
        "while a quarter of real entries state none",
    },
    {
      key: "narrativeVoiceRate",
      label: "narrative-summary voice",
      value: (p) => p.narrativeVoiceRate,
      ok: (v) => v <= Math.max(0.15, ref.narrativeVoiceRate * 2),
      expect: `≤ ${Math.max(0.15, ref.narrativeVoiceRate * 2).toFixed(2)}`,
      format: (v) => v.toFixed(3),
    },
    {
      key: "sentences.median",
      label: "median sentences",
      value: (p) => p.sentences.median,
      ok: (v) => Math.abs(v - ref.sentences.median) <= 2,
      expect: `${ref.sentences.median} ± 2`,
      format: (v) => String(v),
    },
    {
      key: "words.median",
      label: "median words",
      value: (p) => p.words.median,
      ok: (v) => v >= ref.words.median * 0.5 && v <= ref.words.median * 1.5,
      expect: `${Math.round(ref.words.median * 0.5)}–${Math.round(ref.words.median * 1.5)}`,
      format: (v) => String(v),
    },
  ];
}

const { inputs, options } = parseArgs(process.argv.slice(2));
if (!inputs.length) {
  console.error("usage: node scripts/eval-local.mjs <script.pdf | result.json> [more.json] [--endpoint …] [--out …]");
  process.exit(1);
}

const candidates = [];
for (const input of inputs) {
  const result = input.toLowerCase().endsWith(".json")
    ? JSON.parse(readFileSync(input, "utf8"))
    : await analyseFile(input, options);
  if (options.out && !input.toLowerCase().endsWith(".json")) {
    writeFileSync(options.out, `${JSON.stringify(result, null, 2)}\n`);
  }
  candidates.push({
    label: basename(input),
    result,
    profile: profileOf(result),
  });
}

const ref = reference.profile;
const gates = gatesFor(ref);
const width = Math.max(24, ...gates.map((g) => g.label.length + 2));
const column = (text) => String(text).padStart(14);

console.log(`\nreference: ${ref.count} role entries from real breakdowns (${reference.generatedAt})`);
for (const candidate of candidates) {
  const meta = candidate.result.meta;
  const elapsed = candidate.result.__elapsedSeconds;
  console.log(
    `candidate: ${candidate.label} — ${candidate.profile.count} roles` +
      (meta?.model ? `, ${meta.provider}/${meta.model}` : "") +
      (elapsed ? `, ${elapsed}s` : ""),
  );
}

console.log(`\n${"metric".padEnd(width)}${column("corpus")}${candidates.map((c) => column(c.label.slice(0, 13))).join("")}   gate`);
let failures = 0;
for (const gate of gates) {
  const refValue = gate.key === "emptyRate" ? 0 : gate.value(ref);
  let row = gate.label.padEnd(width) + column(gate.format(refValue));
  for (const candidate of candidates) {
    const value = gate.value(candidate.profile);
    const pass = gate.ok(value);
    if (!pass) failures++;
    row += column(`${gate.format(value)}${pass ? " ok" : " ✗"}`);
  }
  console.log(`${row}   ${gate.expect}`);
}

for (const gate of gates.filter((g) => g.note)) {
  console.log(`\n  ${gate.label}: ${gate.note}.`);
}

console.log(`\n${"reported, not gated".padEnd(width)}${column("corpus")}${candidates.map((c) => column(c.label.slice(0, 13))).join("")}`);
for (const [label, key] of [
  ["states ethnicity", "ethnicityStatedRate"],
  ["states gender", "genderStatedRate"],
  ["states age", "ageStatedRate"],
  ["median prose words", null],
]) {
  const pick = (p) => (key ? p[key].toFixed(3) : String(p.proseWords.median));
  console.log(label.padEnd(width) + column(pick(ref)) + candidates.map((c) => column(pick(c.profile))).join(""));
}

for (const candidate of candidates) {
  const tiers = Object.entries(candidate.profile.roleTypes)
    .sort((a, b) => b[1] - a[1])
    .map(([tier, n]) => `${tier} ${n}`)
    .join(", ");
  console.log(`\n${candidate.label} role types: ${tiers}`);
}

console.log(failures ? `\n${failures} gate(s) failed` : "\nall gates passed");
process.exit(failures ? 1 : 0);
