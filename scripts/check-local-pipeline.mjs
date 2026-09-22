/**
 * End-to-end check for the private path, with no model involved.
 *
 * It starts a stub Ollama, starts the real dev server against it, and posts
 * real PDFs to /api/analyze-local. That exercises the route, PDF extraction,
 * the screenplay parser and the assembly exactly as they run on your Mac.
 *
 * What it does NOT check: the quality of what a real model writes. Only
 * `ollama serve` with a real model does that. Run:
 *
 *   node scripts/check-local-pipeline.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { RECOMMENDED, startStubOllama } from "./stub-ollama.mjs";
import { makeScannedPdf, makeScreenplayPdf } from "./make-test-script.mjs";
import { roleTypeLabel } from "../src/lib/local/screenplay.ts";

const PORT = Number(process.env.CHECK_PORT || 3111);
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
function check(name, condition, extra = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function portFree() {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(PORT, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

/**
 * Refuse to run against someone else's server on this port — and give the
 * previous scenario's socket time to finish closing, which takes longer than
 * the process takes to die.
 */
async function assertPortFree() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await portFree()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`port ${PORT} is already in use — stop it, or set CHECK_PORT`);
}

async function startDevServer(env) {
  await assertPortFree();
  // Its own process group: `next dev` spawns a child, and signalling only the
  // npx wrapper leaves the real server holding the port — which silently makes
  // the next scenario run against the previous scenario's environment.
  const child = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      // GET is not exported by the route, so this compiles it and answers 405
      // without running an analysis.
      const res = await fetch(`${BASE}/api/analyze-local`, { method: "GET" });
      if (res.status) return { child, log };
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.log(log.join(""));
  throw new Error("dev server did not start");
}

async function stopDevServer(server) {
  try {
    process.kill(-server.child.pid, "SIGKILL");
  } catch {
    server.child.kill("SIGKILL");
  }
  // Wait for the port to actually free up before the next scenario binds it.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/api/analyze-local`, { method: "GET" });
      await new Promise((r) => setTimeout(r, 300));
    } catch {
      return;
    }
  }
  throw new Error("dev server did not stop");
}

async function installModel(model) {
  const res = await fetch(`${BASE}/api/local-model`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function analyze(bytes, fileName, mode = "auto", locale) {
  const form = new FormData();
  form.append("files", new File([bytes], fileName, { type: "application/pdf" }));
  form.append("mode", mode);
  if (locale) form.append("locale", locale);
  const res = await fetch(`${BASE}/api/analyze-local`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  // The private path answers with newline-delimited JSON: progress lines, then
  // one result. Anything else is a plain JSON error body.
  let parsed = {};
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      events.push(event);
      if (event.result) parsed = event.result;
      else if (event.error) parsed = { error: event.error };
      else if (!event.progress) parsed = event;
    } catch {
      // ignore partial lines
    }
  }
  return { status: res.status, body: parsed, raw: text, events };
}

// Tier vocabulary, checked directly. DAY PLAYER needs a character with under
// 1.5% of a script's cues, which a six-scene fixture cannot produce — asserting
// it end to end would only ever prove the fixture is short.
console.log("\ntier vocabulary by market");
check("US keeps DAY PLAYER", roleTypeLabel("DAY PLAYER", "us") === "DAY PLAYER");
check(
  "Australia has no DAY PLAYER — small speaking roles are SUPPORTING",
  roleTypeLabel("DAY PLAYER", "au") === "SUPPORTING",
  roleTypeLabel("DAY PLAYER", "au"),
);
check("LEAD and SUPPORTING are the same in both", 
  roleTypeLabel("LEAD", "au") === "LEAD" && roleTypeLabel("SUPPORTING", "au") === "SUPPORTING");

const screenplay = await makeScreenplayPdf();
const scanned = await makeScannedPdf();

// --- 1. A well-behaved model -------------------------------------------------
const stub = await startStubOllama({ scenario: "ok" });
let server = await startDevServer({
  OLLAMA_BASE_URL: stub.url,

  VERCEL: "",
  LOCAL_DEBUG_EVIDENCE: "1",
});

try {
  console.log("\nscreenplay, model answering normally");
  const { status, body, events } = await analyze(screenplay, "the-long-way-down.pdf");
  check("200 OK", status === 200, `got ${status} ${JSON.stringify(body).slice(0, 200)}`);
  check("project name came from the model", body.project?.name === "THE LONG WAY DOWN", body.project?.name);
  check("mode auto-detected as film_tv", body.mode === "film_tv", body.mode);
  check("roles found", (body.roles?.length ?? 0) >= 4, `got ${body.roles?.length}`);
  check(
    "cast came from the script's own formatting",
    body.meta?.diagnostics?.parsedAsScreenplay === true,
  );

  const names = (body.roles ?? []).map((r) => r.name);
  check("lead character present", names.includes("Mara"), names.join(", "));
  check("day player present", names.includes("Nurse Pell"), names.join(", "));
  check("no junk roles from caps action lines", names.every((n) => n.length < 20), names.join(", "));

  const mara = (body.roles ?? []).find((r) => r.name === "Mara");
  check("page numbers are real", (mara?.pageNumbers?.length ?? 0) >= 3, JSON.stringify(mara?.pageNumbers));
  check("tier assigned", mara?.roleType === "LEAD", mara?.roleType);
  check(
    "description uses the canonical format",
    /^Woman, 30 to 40 years old\. .+\.\.\.LEAD$/.test(mara?.description ?? ""),
    mara?.description,
  );
  check(
    "narrative-summary sentence was dropped",
    !/in the story/i.test(mara?.description ?? ""),
    mara?.description,
  );
  check(
    "book-voice sentence was dropped",
    !/carries herself|an air of/i.test(mara?.description ?? ""),
    mara?.description,
  );
  const page = await fetch(`${BASE}/private`).then((r) => r.text());
  check(
    "the page names the model before you run anything",
    page.includes(RECOMMENDED),
    "a wrong model is invisible in the output, so it has to be on the page",
  );
  check(
    "runs the recommended model, not merely the biggest one that fits",
    body.meta?.model === RECOMMENDED,
    `${body.meta?.model} — an 11B that fits must still lose to the recommendation, ` +
      `or moving to a better same-size model would change nothing`,
  );
  const evidenceFile = body.meta?.diagnostics?.evidenceFile ?? "";
  check(
    "the market picker reaches the analysis",
    stub.calls.some((c) => c.user.startsWith("Character: ")),
    "locale is sent with every analysis; US is the default",
  );
  const wrongModel = await installModel("something-else:latest");
  check(
    "only the recommended model can be installed from the page",
    wrongModel.status === 400,
    `got ${wrongModel.status} — Ollama pulls any name it is given`,
  );

  const roleProgress = events.filter((e) => e.progress?.phase === "roles");
  check(
    "reports real progress, not a scripted animation",
    roleProgress.length >= body.roles.length &&
      roleProgress.at(-1).progress.done === roleProgress.at(-1).progress.total,
    `${roleProgress.length} role updates for ${body.roles?.length} roles`,
  );
  check(
    "progress counts every role",
    roleProgress.some((e) => e.progress.total === body.roles.length),
    JSON.stringify(roleProgress.at(-1)?.progress),
  );
  check(
    "the page says which build it is",
    /v\d+\.\d+\.\d+/.test(page),
    "a page that has not been updated looks exactly like one that has",
  );
  check(
    "the page promises what the code actually enforces",
    page.includes("your script never leaves it") &&
      page.includes("will not run at all if the AI is anywhere but here") &&
      page.includes("no copy is ever saved to your hard drive"),
    "this is a claim a studio would rely on, so it has to match the loopback guard",
  );
  check(
    "evidence dump, when asked for, lands outside the project folder",
    Boolean(evidenceFile) &&
      !evidenceFile.startsWith(process.cwd()) &&
      existsSync(evidenceFile) &&
      readFileSync(evidenceFile, "utf8").includes("===== Mara"),
    `${evidenceFile} — writing into a watched folder restarts the dev server mid-run`,
  );

  check(
    "PDF margins were used to tell dialogue from action",
    body.meta?.diagnostics?.usedLayout === true,
    "without this, action lines leak into the evidence as dialogue",
  );

  const descriptionPrompts = stub.calls.filter((c) => c.user.startsWith("Character: "));
  check(
    "evidence includes where the character turns up",
    descriptionPrompts.some((c) => c.user.includes("Where they turn up:")),
    "scene headings are what tell a small model the character's world",
  );
  check(
    "evidence includes what others say about them",
    descriptionPrompts.some((c) => c.user.includes("What other characters say about them:")),
    "this is where a script states a job or a relationship",
  );
  check(
    "action lines stay out of what the character says",
    descriptionPrompts.every((c) => {
      const said = c.user.split("What they say:")[1] ?? "";
      return !/kills the engine|watches her go|wipes his hands|crosses a bridge/i.test(said);
    }),
    "action following a speech used to be captured as part of it",
  );
  check(
    "the house prompt carries the local style rules",
    descriptionPrompts.every((c) => /WRITE IN FRAGMENTS/.test(c.system) && /PHYSICALITY/.test(c.system)),
    "rules that only reach the lean prompt never reach a model anyone uses",
  );
  check(
    "the house prompt is used on a model big enough for it",
    body.meta?.diagnostics?.descriptionPrompt === "house",
    body.meta?.diagnostics?.descriptionPrompt,
  );
  const otis = (body.roles ?? []).find((r) => r.name === "Otis")?.description ?? "";
  check(
    "a description copied from the prompt is regenerated, not printed",
    (body.meta?.diagnostics?.rolesCopiedPrompt ?? []).includes("Otis") &&
      !/write in this order|ROLE DESCRIPTION/i.test(otis) &&
      otis.split(/\s+/).length > 6,
    `${JSON.stringify(body.meta?.diagnostics?.rolesCopiedPrompt)} -> ${otis}`,
  );
  const devlin = (body.roles ?? []).find((r) => r.name === "Devlin");
  check(
    "hair colour is not accepted as an ethnicity",
    !(body.roles ?? []).some((r) => /blonde|redhead|brunette/i.test(r.ethnicity ?? "")),
    (body.roles ?? []).map((r) => r.ethnicity).filter(Boolean).join(", "),
  );
  check(
    "an ethnicity the script never states is dropped",
    devlin?.ethnicity === null && (body.meta?.diagnostics?.unsupportedEthnicityDropped ?? 0) >= 1,
    `ethnicity=${devlin?.ethnicity}, dropped=${body.meta?.diagnostics?.unsupportedEthnicityDropped}`,
  );
  check(
    "model was never handed the sentence ceiling",
    descriptionPrompts.every((c) => !/at most \d+ sentence/i.test(c.user)),
    "a number in the prompt becomes a target",
  );
  check("self-tape instructions per role", body.selfTapeInstructions?.length === body.roles?.length);
  check("form questions per role", body.formQuestions?.length === body.roles?.length);
  check("logline written", Boolean(body.project?.logline), body.project?.logline);

  const chats = stub.calls;
  check("no single call sent the whole script", chats.every((c) => c.user.length < 12_000),
    `largest ${Math.max(...chats.map((c) => c.user.length))} chars`);
  check("num_ctx set explicitly on every call", chats.every((c) => c.options?.num_ctx > 2048),
    JSON.stringify(chats[0]?.options));
  check("responses constrained by a JSON schema", chats.every((c) => typeof c.format === "object"));

  console.log("\nscanned PDF with no text layer");
  const scan = await analyze(scanned, "scanned-script.pdf");
  check("rejected with 400", scan.status === 400, `got ${scan.status}`);
  check("error names the cause and a fix", /no text layer/i.test(scan.body.error ?? "") && /OCR/i.test(scan.body.error ?? ""),
    scan.body.error);
} finally {
  await stopDevServer(server);
  await stub.close();
}

// --- 2. A model that ignores the schema and returns {} -----------------------
const emptyStub = await startStubOllama({ scenario: "empty" });
server = await startDevServer({
  OLLAMA_BASE_URL: emptyStub.url,

  VERCEL: "",
});

try {
  console.log("\nmodel returning {} for everything");
  const { status, body } = await analyze(screenplay, "the-long-way-down.pdf");
  check("still 200", status === 200, `got ${status}`);
  check(
    "roles survive a useless model",
    (body.roles?.length ?? 0) >= 4,
    `got ${body.roles?.length} — this is the regression that returned 0 roles`,
  );
  check("title falls back to the file name", /long way down/i.test(body.project?.name ?? ""), body.project?.name);
  check("page numbers still real", (body.roles?.[0]?.pageNumbers?.length ?? 0) > 0);
} finally {
  await stopDevServer(server);
  await emptyStub.close();
}

// --- 1a. Australian market ----------------------------------------------------
const auStub = await startStubOllama({ scenario: "ok" });
server = await startDevServer({
  OLLAMA_BASE_URL: auStub.url,

  VERCEL: "",
});

try {
  console.log("\nAustralian market selected");
  const { body } = await analyze(screenplay, "the-long-way-down.pdf", "auto", "au");
  check(
    "no DAY PLAYER in Australian breakdowns",
    !(body.roles ?? []).some((r) => r.roleType === "DAY PLAYER"),
    (body.roles ?? []).map((r) => r.roleType).join(", "),
  );
  check(
    "and no US-only vocabulary either",
    !(body.roles ?? []).some((r) => /DAY PLAYER|CO-STAR|GUEST STAR/.test(r.roleType ?? "")),
    (body.roles ?? []).map((r) => r.roleType).join(", "),
  );
} finally {
  await stopDevServer(server);
  await auStub.close();
}

// --- 1b. Evidence dump is off unless asked for ---------------------------------
const quietStub = await startStubOllama({ scenario: "ok" });
server = await startDevServer({
  OLLAMA_BASE_URL: quietStub.url,

  VERCEL: "",
});

try {
  console.log("\ndefault run (no debug flag)");
  const { body } = await analyze(screenplay, "the-long-way-down.pdf");
  check(
    "writes no script text to disk by default",
    body.meta?.diagnostics?.evidenceFile === null,
    `${body.meta?.diagnostics?.evidenceFile} — the default has to match what the page promises`,
  );
} finally {
  await stopDevServer(server);
  await quietStub.close();
}

// --- 2a. A run long enough to be dropped by a browser -------------------------
const slowStub = await startStubOllama({ scenario: "slow" });
server = await startDevServer({
  OLLAMA_BASE_URL: slowStub.url,

  VERCEL: "",
});

try {
  console.log("\nslow run (minutes on a real model)");
  const { status, body, events } = await analyze(screenplay, "the-long-way-down.pdf");
  check("completes", status === 200 && (body.roles?.length ?? 0) > 0, `got ${status}`);
  check(
    "sends progress while it works, so the browser does not give up",
    events.filter((e) => e.progress).length > 3,
    `${events.filter((e) => e.progress).length} progress events — a silent request is dropped as dead`,
  );
  check(
    "the result still arrives at the end of the stream",
    (body.roles?.length ?? 0) > 0,
  );
} finally {
  await stopDevServer(server);
  await slowStub.close();
}

// --- 2b. A model too small for the job ----------------------------------------
const smallStub = await startStubOllama({ scenario: "small-model" });
server = await startDevServer({
  OLLAMA_BASE_URL: smallStub.url,

  VERCEL: "",
});

try {
  console.log("\nundersized local model");
  const { status, body } = await analyze(screenplay, "the-long-way-down.pdf");
  check("still analyses", status === 200, `got ${status}`);
  check(
    "says so on the page, not just in a log",
    /3.2B/.test(body.meta?.warning ?? "") && /llama3.1:8b/.test(body.meta?.warning ?? ""),
    body.meta?.warning,
  );
  check(
    "says how to get a better one",
    /ollama pull/.test(body.meta?.warning ?? ""),
    body.meta?.warning,
  );
} finally {
  await stopDevServer(server);
  await smallStub.close();
}

// --- 3. Ollama not running ---------------------------------------------------
server = await startDevServer({
  OLLAMA_BASE_URL: "http://127.0.0.1:11999",

  VERCEL: "",
});

try {
  console.log("\nOllama not running");
  const { status, body } = await analyze(screenplay, "the-long-way-down.pdf");
  check("fails loudly", status === 503, `got ${status}`);
  check("error says how to start it", /ollama serve/i.test(body.error ?? ""), body.error);
} finally {
  await stopDevServer(server);
}

// --- 4. Hosted deployment must not analyse ----------------------------------
server = await startDevServer({ OLLAMA_BASE_URL: "http://127.0.0.1:11999", VERCEL: "1" });

try {
  console.log("\nhosted on Vercel");
  const { status, body } = await analyze(screenplay, "the-long-way-down.pdf");
  check("403, no analysis attempted", status === 403, `got ${status}`);
  check("explains why", /only runs on your Mac/i.test(body.error ?? ""), body.error);

  const hostedInstall = await installModel(RECOMMENDED);
  check(
    "no model installs on the hosted site",
    hostedInstall.status === 403,
    `got ${hostedInstall.status}`,
  );

  const guide = await fetch(`${BASE}/private`).then((r) => r.text());
  check(
    "a returning user is offered their tool before the setup steps",
    guide.includes("Already set up?") &&
      guide.indexOf("Already set up?") < guide.indexOf("Setting this up for the first time"),
    "most visits after the first are someone looking for their tool, not installing it",
  );
  check(
    "with a link straight to the local tool",
    guide.includes("http://localhost:3000/private") && guide.includes("CLICK HERE"),
    "a returning user should not have to read anything to get back to work",
  );
} finally {
  await stopDevServer(server);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
