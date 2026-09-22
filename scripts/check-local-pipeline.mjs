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
import { startStubOllama } from "./stub-ollama.mjs";
import { makeScannedPdf, makeScreenplayPdf } from "./make-test-script.mjs";

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

async function analyze(bytes, fileName, mode = "auto") {
  const form = new FormData();
  form.append("files", new File([bytes], fileName, { type: "application/pdf" }));
  form.append("mode", mode);
  const res = await fetch(`${BASE}/api/analyze-local`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const screenplay = await makeScreenplayPdf();
const scanned = await makeScannedPdf();

// --- 1. A well-behaved model -------------------------------------------------
const stub = await startStubOllama({ scenario: "ok" });
let server = await startDevServer({
  OLLAMA_BASE_URL: stub.url,
  OLLAMA_MODEL: "stub-model",
  VERCEL: "",
});

try {
  console.log("\nscreenplay, model answering normally");
  const { status, body } = await analyze(screenplay, "the-long-way-down.pdf");
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
  check(
    "evidence is written to local-evidence.txt",
    existsSync("local-evidence.txt") &&
      readFileSync("local-evidence.txt", "utf8").includes("===== Mara"),
    "this is how a bad run gets diagnosed without guessing",
  );
  check(
    "PDF margins were used to tell dialogue from action",
    body.meta?.diagnostics?.usedLayout === true,
    "without this, action lines leak into the evidence as dialogue",
  );

  const descriptionPrompts = stub.calls.filter((c) =>
    c.system.includes("casting breakdown"),
  );
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
    "a description copied from the prompt is discarded",
    (body.meta?.diagnostics?.rolesCopiedPrompt ?? []).includes("Otis") &&
      !/write in this order/i.test(
        (body.roles ?? []).find((r) => r.name === "Otis")?.description ?? "",
      ),
    JSON.stringify(body.meta?.diagnostics?.rolesCopiedPrompt),
  );
  const devlin = (body.roles ?? []).find((r) => r.name === "Devlin");
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
  OLLAMA_MODEL: "stub-model",
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

// --- 3. Ollama not running ---------------------------------------------------
server = await startDevServer({
  OLLAMA_BASE_URL: "http://127.0.0.1:11999",
  OLLAMA_MODEL: "stub-model",
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
} finally {
  await stopDevServer(server);
}

rmSync("local-evidence.txt", { force: true });

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
