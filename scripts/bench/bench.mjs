/**
 * Benchmark the private tool against real breakdowns, on this machine only.
 *
 *   npm run bench:inspect -- --data ~/scripttocast-bench        # how each reference was read
 *   npm run bench:run     -- --data ~/scripttocast-bench --label base
 *   npm run bench:score   -- --data ~/scripttocast-bench --label base
 *
 * The data is client scripts and the breakdowns written from them, provided
 * to develop this tool. It is confidential, so three rules hold throughout:
 *
 *   - The data folder must be outside this repository. Nothing in it can be
 *     committed by accident, and nothing here writes into the repository.
 *   - Every request goes to this machine: the tool on localhost, Ollama on
 *     127.0.0.1. The judge is the local model, never a hosted one.
 *   - Results are written under the data folder, beside what they came from.
 *
 * Options:
 *   --split tune|holdout|all   which projects (default tune; holdout is for the end)
 *   --roles N                  roles described per project beyond the leads (default 3)
 *   --limit N                  first N projects only
 *   --server URL               the running tool (default http://127.0.0.1:3000)
 *
 *   --judge local|claude       who compares descriptions (default local)
 *
 * The Claude judge is for material that is not confidential — old, released
 * projects. It is far better than an 8B model at spotting a wrong fact, and
 * it is sent only the two descriptions being compared, never the script. It
 * needs ANTHROPIC_API_KEY. The default stays local so a confidential set can
 * never reach it by accident.
 *
 * Environment: BENCH_JUDGE_MODEL (default: the recommended local model),
 * OLLAMA_BASE_URL (loopback only), ANTHROPIC_API_KEY (Claude judge only).
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ageRangeOf, genderOf, loadProjects, sameRole, splitOf, tierOf } from "./references.mjs";
import { measureDescription } from "../lib/breakdown-metrics.mjs";

const REPO = realpathSync(resolve(fileURLToPath(import.meta.url), "../../.."));
const RECOMMENDED = JSON.parse(readFileSync(join(REPO, "recommended-model.json"), "utf8")).model;

/** What the composite score is made of. Facts and coverage outweigh form. */
export const WEIGHTS = { cast: 0.3, factual: 0.25, coverage: 0.2, gender: 0.1, age: 0.1, tier: 0.05 };

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, split: "tune", roles: 3, limit: 0, server: "http://127.0.0.1:3000", label: "", judge: "local" };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const value = () => rest[++i];
    if (arg === "--data") options.data = value();
    else if (arg === "--split") options.split = value();
    else if (arg === "--roles") options.roles = Number(value());
    else if (arg === "--limit") options.limit = Number(value());
    else if (arg === "--server") options.server = value();
    else if (arg === "--label") options.label = value();
    else if (arg === "--judge") options.judge = value();
  }
  return options;
}

function assertLoopback(url, what) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(`${what} must be on this machine; got ${url}. Client scripts do not leave it.`);
  }
}

function assertOutsideRepo(dir) {
  const real = realpathSync(dir);
  if (real === REPO || real.startsWith(`${REPO}/`)) {
    throw new Error(
      `The data folder is inside the repository (${real}). Move it outside — client scripts ` +
        `must never be one "git add" away from being published.`,
    );
  }
  return real;
}

async function projectsFor(options) {
  if (!options.data) throw new Error("--data <folder of project folders> is required");
  const data = assertOutsideRepo(options.data);
  let projects = (await loadProjects(data)).filter(
    (p) => options.split === "all" || splitOf(p.name) === options.split,
  );
  if (options.limit) projects = projects.slice(0, options.limit);
  return { data, projects };
}

// ---------------------------------------------------------------------------

async function inspect(options) {
  const { projects } = await projectsFor({ ...options, split: "all" });
  let problems = 0;
  for (const p of projects) {
    const issue = !p.script ? "NO SCRIPT PDF" : !p.reference ? "NO BREAKDOWN" : !p.roles.length ? "NO ROLES PARSED" : "";
    if (issue) problems++;
    console.log(`\n${p.name}  [${splitOf(p.name)}]  ${issue}`);
    for (const r of p.roles) {
      const age = r.age.length ? `${r.age[0]}-${r.age[1]}` : "no age";
      console.log(
        `  ${r.name.padEnd(28)} ${(r.gender || "no gender").padEnd(10)} ${age.padEnd(8)} ` +
          `${(r.roleType || "no type").padEnd(14)} ${r.description.split(/\s+/).length} words`,
      );
    }
  }
  const tune = projects.filter((p) => splitOf(p.name) === "tune").length;
  console.log(
    `\n${projects.length} projects (${tune} tune, ${projects.length - tune} holdout), ` +
      `${projects.reduce((n, p) => n + p.roles.length, 0)} reference roles, ${problems} with problems.`,
  );
  console.log("Check the names, genders and ages above against the breakdowns before trusting a score.");
}

// ---------------------------------------------------------------------------

/** Leads always; then a fixed handful of others, so every experiment sees the same roles. */
function sampleRoles(project, others) {
  const leads = project.roles.filter((r) => tierOf(r.roleType) === "LEAD");
  const rest = project.roles.filter((r) => tierOf(r.roleType) !== "LEAD").slice(0, others);
  return [...leads, ...rest].map((r) => r.name);
}

async function analyse(server, scriptPath, onlyRoles) {
  const form = new FormData();
  form.append("files", new File([readFileSync(scriptPath)], basename(scriptPath), { type: "application/pdf" }));
  form.append("mode", "film_tv");
  form.append("onlyRoles", onlyRoles.join(","));
  const res = await fetch(`${server}/api/analyze-local`, { method: "POST", body: form });
  const text = await res.text();
  let result = null;
  let error = res.ok ? null : `HTTP ${res.status}`;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.result) result = event.result;
      else if (event.error) error = event.error;
      else if (!event.progress && event.roles) result = event;
    } catch {
      // A partial line; ignore.
    }
  }
  return { result, error };
}

async function run(options) {
  assertLoopback(options.server, "The tool");
  const { data, projects } = await projectsFor(options);
  const label = options.label || new Date().toISOString().replace(/[:.]/g, "-");
  const out = join(data, "results", label);
  mkdirSync(out, { recursive: true });
  console.log(`Running ${projects.length} ${options.split} projects → ${out}`);

  for (const [i, p] of projects.entries()) {
    if (!p.script || !p.roles.length) {
      console.log(`  skip ${p.name}: ${!p.script ? "no script" : "no reference roles"}`);
      continue;
    }
    const onlyRoles = sampleRoles(p, options.roles);
    const started = Date.now();
    process.stdout.write(`  [${i + 1}/${projects.length}] ${p.name} (${onlyRoles.length} roles) … `);
    const { result, error } = await analyse(options.server, p.script, onlyRoles);
    const elapsedMs = Date.now() - started;
    writeFileSync(join(out, `${p.name}.json`), JSON.stringify({ project: p.name, onlyRoles, elapsedMs, error, result }, null, 2));
    console.log(error ? `FAILED: ${error}` : `${Math.round(elapsedMs / 1000)}s`);
  }
}

// ---------------------------------------------------------------------------

const JUDGE_SYSTEM = `You compare two casting descriptions of the same character.

The first was written by a casting director and is correct. The second was
written by software from the same script. Answer two things about the second:

contradictions: statements in the second that conflict with the first — a
different job, relationship, age, situation or role in the story. Leave out
anything the first simply does not mention. Each item one short sentence.

coverage: from 0 to 1, how much of what matters in the first — who they are,
what they do, who they are to others, what the part needs — the second also
conveys, in any words.`;

const JUDGE_SCHEMA = {
  type: "object",
  required: ["contradictions", "coverage"],
  properties: {
    contradictions: { type: "array", items: { type: "string" } },
    coverage: { type: "number" },
  },
};

let anthropic = null;

async function judgeWithClaude(reference, candidate) {
  if (!anthropic) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    anthropic = new Anthropic();
  }
  const response = await anthropic.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: JUDGE_SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: JUDGE_SCHEMA } },
    messages: [
      { role: "user", content: `FIRST (casting director):\n${reference}\n\nSECOND (software):\n${candidate}` },
    ],
  });
  if (response.stop_reason === "refusal") return { contradictions: [], coverage: 0, refused: true };
  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

async function judge(reference, candidate, how) {
  if (how === "claude") {
    const verdict = await judgeWithClaude(reference, candidate);
    return {
      contradictions: Array.isArray(verdict.contradictions) ? verdict.contradictions.filter(Boolean) : [],
      coverage: Math.max(0, Math.min(1, Number(verdict.coverage) || 0)),
    };
  }
  const base = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  assertLoopback(base, "Ollama");
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.BENCH_JUDGE_MODEL || RECOMMENDED,
      stream: false,
      format: JUDGE_SCHEMA,
      options: { temperature: 0, num_ctx: 8192 },
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: `FIRST (casting director):\n${reference}\n\nSECOND (software):\n${candidate}` },
      ],
    }),
  });
  const body = await res.json();
  const verdict = JSON.parse(body.message?.content ?? "{}");
  return {
    contradictions: Array.isArray(verdict.contradictions) ? verdict.contradictions.filter(Boolean) : [],
    coverage: Math.max(0, Math.min(1, Number(verdict.coverage) || 0)),
  };
}

function overlaps(a, b) {
  return a.length === 2 && b.length === 2 && a[0] <= b[1] && b[0] <= a[1];
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

async function score(options) {
  if (!["local", "claude"].includes(options.judge)) throw new Error("--judge is local or claude");
  const { data, projects } = await projectsFor(options);
  const label = options.label || latestLabel(data);
  if (options.judge === "claude") {
    console.log("Judge: Claude (claude-opus-5-5). Descriptions are sent to Anthropic; scripts are not.");
  }
  const dir = join(data, "results", label);
  if (!existsSync(dir)) throw new Error(`No results for "${label}". Run bench:run first.`);

  const perProject = [];
  const worst = [];
  for (const p of projects) {
    const file = join(dir, `${p.name}.json`);
    if (!existsSync(file)) continue;
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (!saved.result) {
      perProject.push({ project: p.name, failed: saved.error || "no result" });
      continue;
    }
    const found = saved.result.meta?.diagnostics?.castFound ?? saved.result.roles.map((r) => r.name);
    const cast = p.roles.filter((ref) => found.some((name) => sameRole(name, ref.name))).length / p.roles.length;

    const roles = [];
    for (const ours of saved.result.roles) {
      const ref = p.roles.find((r) => sameRole(r.name, ours.name));
      if (!ref) continue;
      const verdict = await judge(ref.description, ours.description, options.judge);
      const oursAge = ageRangeOf(ours.ageRange ?? "");
      const row = {
        role: ref.name,
        gender: ref.gender && ref.gender !== "any" ? Number(genderOf(ours.gender ?? "") === ref.gender) : null,
        age: ref.age.length ? Number(overlaps(ref.age, oursAge)) : null,
        tier: tierOf(ref.roleType) ? Number(tierOf(ours.roleType) === tierOf(ref.roleType)) : null,
        factual: verdict.contradictions.length ? 0 : 1,
        coverage: verdict.coverage,
        contradictions: verdict.contradictions,
        words: measureDescription(ours.description).proseWords,
        referenceWords: measureDescription(ref.description).proseWords ?? ref.description.split(/\s+/).length,
      };
      roles.push(row);
      if (row.contradictions.length || row.coverage < 0.4) worst.push({ project: p.name, ...row, ours: ours.description });
    }
    const part = (key) => mean(roles.map((r) => r[key]).filter((v) => v !== null));
    perProject.push({
      project: p.name,
      elapsedMs: saved.elapsedMs,
      cast,
      factual: part("factual"),
      coverage: part("coverage"),
      gender: part("gender"),
      age: part("age"),
      tier: part("tier"),
      roles: roles.length,
    });
  }

  const scored = perProject.filter((p) => !p.failed);
  const component = (key) => mean(scored.map((p) => p[key]).filter((v) => v !== null && v !== undefined)) ?? 0;
  const components = Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, component(k)]));
  const failures = perProject.length - scored.length;
  // A project that failed to run scores zero, so breaking the tool can never raise the number.
  const coverageOfRuns = perProject.length ? scored.length / perProject.length : 0;
  const total =
    100 * coverageOfRuns * Object.entries(WEIGHTS).reduce((s, [k, w]) => s + w * components[k], 0);

  console.log(`\n${label} · ${options.split} · ${scored.length} scored, ${failures} failed\n`);
  for (const p of perProject) {
    if (p.failed) console.log(`  ${p.project.padEnd(30)} FAILED: ${p.failed}`);
    else
      console.log(
        `  ${p.project.padEnd(30)} cast ${pct(p.cast)} facts ${pct(p.factual)} cover ${pct(p.coverage)} ` +
          `gender ${pct(p.gender)} age ${pct(p.age)} tier ${pct(p.tier)} · ${Math.round(p.elapsedMs / 1000)}s`,
      );
  }
  console.log(`\nComponents: ${Object.entries(components).map(([k, v]) => `${k} ${pct(v)}`).join(" · ")}`);
  console.log(`SCORE ${total.toFixed(1)} / 100`);

  if (worst.length) {
    console.log(`\nWeakest roles (what to learn from):`);
    for (const w of worst.slice(0, 12)) {
      console.log(`\n  ${w.project} / ${w.role}  coverage ${pct(w.coverage)}`);
      for (const c of w.contradictions) console.log(`    ✗ ${c}`);
      console.log(`    ours: ${w.ours.slice(0, 300)}`);
    }
  }

  const summary = { label, split: options.split, judge: options.judge, score: Number(total.toFixed(2)), components, failures, perProject, worst };
  writeFileSync(join(dir, `score-${options.split}.json`), JSON.stringify(summary, null, 2));
  const tsv = join(data, "results", "results.tsv");
  if (!existsSync(tsv)) appendFileSync(tsv, "when\tlabel\tsplit\tscore\tcast\tfactual\tcoverage\tgender\tage\ttier\tfailed\n");
  appendFileSync(
    tsv,
    `${new Date().toISOString()}\t${label}\t${options.split}\t${total.toFixed(2)}\t` +
      `${Object.keys(WEIGHTS).map((k) => components[k].toFixed(3)).join("\t")}\t${failures}\n`,
  );
}

function pct(v) {
  return v === null || v === undefined ? "  –" : `${Math.round(v * 100)}%`.padStart(4);
}

function latestLabel(data) {
  const dirs = readdirSync(join(data, "results"), { withFileTypes: true }).filter((d) => d.isDirectory());
  if (!dirs.length) throw new Error("No runs yet.");
  return dirs.map((d) => d.name).sort().at(-1);
}

// ---------------------------------------------------------------------------

const options = parseArgs(process.argv.slice(2));
const commands = { inspect, run, score };
if (!commands[options.command]) {
  console.error("usage: bench.mjs inspect|run|score --data <folder> [--label L] [--split tune|holdout|all]");
  process.exit(2);
}
commands[options.command](options).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
