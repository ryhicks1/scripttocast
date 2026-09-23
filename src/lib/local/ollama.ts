/**
 * Minimal Ollama client for the private path.
 *
 * Everything here talks to a model running on this machine. There is no
 * third-party fallback anywhere in this file, or anywhere it is called from:
 * when the local model is unavailable the request fails, loudly. Falling back
 * to a hosted API would send a confidential script off the machine, which is
 * the one thing the private path exists to prevent.
 */

import { request as httpRequest } from "node:http";
import recommended from "../../../recommended-model.json";
import { LocalAnalysisError } from "./errors";

/** Raised for every Ollama failure we can explain to the user. */
export class OllamaError extends LocalAnalysisError {
  constructor(message: string, status = 502, detail?: string) {
    super(message, status, detail);
    this.name = "OllamaError";
  }
}

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  /** Context window, in tokens, actually requested per call. */
  numCtx: number;
  /** Prompt budget in characters, derived from numCtx. */
  promptCharBudget: number;
  /** Set when the running model is too small to do this job well. */
  warning?: string;
  /** Parameter count in billions, when Ollama reports it. */
  parameters?: number | null;
  /**
   * The model's own context ceiling, as Ollama reports it.
   *
   * Preflight used to clamp numCtx against this and then discard the number,
   * so a later caller sizing its own window — the whole-script pass does
   * exactly that — had nothing to clamp against and could ask for more context
   * than the model has.
   */
  modelContextLimit?: number | null;
}

/**
 * Ollama must stay on loopback. A remote OLLAMA_BASE_URL would ship the script
 * to another host, which defeats the whole path.
 */
export function assertLocalOllama(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OllamaError(`Invalid OLLAMA_BASE_URL: ${url}`, 500);
  }
  const host = parsed.hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]" && host !== "::1") {
    throw new OllamaError(
      "analyze-local only allows Ollama on 127.0.0.1/localhost. " +
        `OLLAMA_BASE_URL is set to ${url}, which would send the script off this machine.`,
      500,
    );
  }
}

export const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
/**
 * The recommended local model, from recommended-model.json.
 *
 * It lives in a JSON file rather than here because the launcher script reads it
 * too. That is the whole update path for someone running this on their own Mac:
 * they double-click the launcher, it pulls the latest code, sees the
 * recommendation has changed, and downloads the new model. A model name
 * hardcoded in TypeScript could never reach them.
 *
 * The cost of a larger model is memory and time, not money — nothing here bills
 * per token. A smaller one still works; the descriptions just come out thinner.
 */
export const DEFAULT_MODEL = recommended.model;

/**
 * Context window to ask for when the model's own limit is unknown or larger.
 *
 * This is the single most important number on this path. Ollama's default
 * num_ctx is small (2048 on most builds); anything longer is silently
 * truncated before the model ever sees it. Sending a feature script in one
 * prompt therefore produced a model that had seen neither the instructions
 * nor most of the script, and returned an empty breakdown that parsed fine.
 * Every prompt below is built to fit inside this budget instead.
 */
export const DEFAULT_NUM_CTX = 8192;

/**
 * Below this the pipeline cannot work: a character's lines plus the
 * instructions do not fit, and Ollama would truncate them without saying so.
 * Better to refuse than to produce a breakdown written from a fragment.
 */
export const MIN_NUM_CTX = 4096;

/** Rough chars-per-token for English prose. Deliberately conservative. */
const CHARS_PER_TOKEN = 3.2;
/** Tokens held back from the context window for the model's own answer. */
const OUTPUT_RESERVE_TOKENS = 1200;

export function promptCharBudgetFor(numCtx: number): number {
  return Math.max(1500, Math.floor((numCtx - OUTPUT_RESERVE_TOKENS) * CHARS_PER_TOKEN));
}

/**
 * A context window sized to hold this exact prompt, rounded up to 4k.
 *
 * The private path reads the whole script in one prefill and then writes one
 * role at a time against it. That only works if num_ctx actually holds the
 * script: Ollama truncates silently, so a window one token short does not
 * error, it just returns a breakdown written from a fragment — which is how
 * this path shipped descriptions of a film the model had mostly not read.
 *
 * It reserves OUTPUT_RESERVE_TOKENS — the same constant promptCharBudgetFor
 * subtracts — and that is not an incidental detail. The two must agree, or the
 * budget derived from this window is smaller than the prompt it was sized for
 * and every call is rejected before it is sent. Sizing with a 700-token
 * reserve against a budget computed with 1200 is what made a script that fit
 * comfortably in memory fail on all twenty-four roles, by 845 characters.
 *
 * With one constant the relationship holds by construction:
 * promptCharBudgetFor(contextFor(n)) >= n for every n. The check suite asserts
 * it across a range of sizes.
 *
 * Capped by the caller against the model's own reported limit. If it does not
 * fit, the caller refuses rather than sending it.
 */
export function contextFor(promptChars: number): number {
  const needed = Math.ceil(promptChars / CHARS_PER_TOKEN) + OUTPUT_RESERVE_TOKENS;
  return Math.max(MIN_NUM_CTX, Math.ceil(needed / 4096) * 4096);
}

/**
 * KV cache cost of a context window, in bytes, for a llama3.1-8B-shaped model.
 *
 * 32 layers, 8 key/value heads, 128 dimensions, keys and values, two bytes
 * each: 128 KiB per token. Ollama allocates it up front, so this is the number
 * that decides whether a script fits on someone's laptop or swaps it to death.
 * Reported rather than enforced — the machine's free memory is not knowable
 * from here, and a user with 64GB should not be held to an Air's budget.
 */
export function kvCacheBytes(numCtx: number): number {
  return numCtx * 128 * 1024;
}

function envNumber(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

/** Model names Ollama accepts: "llama3.1:8b", "hf.co/user/model:Q4_K_M". */
const MODEL_NAME = /^[\w.\-/]+(:[\w.\-]+)?$/;

/**
 * Read config from the environment. Does not contact Ollama.
 *
 * `requested` comes from the model picker on the page and wins over the
 * environment, so choosing a model does not mean editing .env.local. It is
 * checked against the installed list in preflight, which is what actually makes
 * it safe — an unknown name fails there with a message saying how to pull it.
 */
export function resolveConfig(requested?: string | null): OllamaConfig {
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;
  assertLocalOllama(baseUrl);
  const numCtx = envNumber("OLLAMA_NUM_CTX") ?? DEFAULT_NUM_CTX;
  const picked = requested && MODEL_NAME.test(requested) ? requested : null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    model: picked || process.env.OLLAMA_MODEL || DEFAULT_MODEL,
    numCtx,
    promptCharBudget: promptCharBudgetFor(numCtx),
  };
}

/**
 * Models installed on this machine. Returns an empty list rather than throwing:
 * the page still renders when Ollama is not running, and the analysis itself
 * fails loudly with instructions.
 */
export async function listInstalledModels(
  config: OllamaConfig,
): Promise<{ name: string; parameters: number | null }[]> {
  try {
    const res = await ollamaFetch(config, "/api/tags", { method: "GET", timeoutMs: 5_000 });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => null)) as
      | { models?: { name?: string; details?: Record<string, unknown> }[] }
      | null;
    return (body?.models ?? [])
      .filter((m) => m.name)
      .map((m) => ({ name: m.name as string, parameters: parameterBillions(m.details) }));
  } catch {
    return [];
  }
}

/**
 * Fraction of system memory a model may occupy.
 *
 * A quantised model is roughly 0.6GB per billion parameters, and it has to
 * share the machine with the browser, the dev server and macOS. At 45% a 16GB
 * Mac lands on an 8B model and declines a 14B, which is the right call: a model
 * that swaps takes minutes per role and the run never finishes.
 */
const MEMORY_BUDGET = 0.45;
const GB_PER_BILLION_PARAMS = 0.6;

/**
 * Choose the best installed model for this machine.
 *
 * Chosen rather than configured, because configuring it meant editing a hidden
 * file from a terminal, and a stale OLLAMA_MODEL in that file pinned a 3B model
 * through several rounds of work while every diagnostic said the prompt was at
 * fault. The largest model that fits is almost always the right answer here,
 * and when it is wrong the environment variable still wins.
 */
export async function pickBestModel(
  config: OllamaConfig,
  totalMemoryBytes: number,
): Promise<{ model: string; reason: string }> {
  const pinned = process.env.OLLAMA_MODEL;
  const installed = await listInstalledModels(config);
  if (!installed.length) {
    return { model: pinned || DEFAULT_MODEL, reason: "Ollama is not running" };
  }

  const budgetGb = (totalMemoryBytes / 1024 ** 3) * MEMORY_BUDGET;
  const fits = (parameters: number | null) =>
    parameters === null || parameters * GB_PER_BILLION_PARAMS <= budgetGb;

  const matches = (name: string, wanted: string) =>
    name === wanted || name.replace(/:latest$/, "") === wanted.replace(/:latest$/, "");

  // A model named outright still wins, as long as it is actually installed.
  if (pinned) {
    const match = installed.find((m) => matches(m.name, pinned));
    if (match) return { model: match.name, reason: "set by OLLAMA_MODEL" };
  }

  // The recommendation beats size.
  //
  // Preferring the largest installed model quietly defeats the update path:
  // move the recommendation to a better model of the same size or smaller, the
  // launcher downloads it, and then this picks the old larger one anyway. The
  // update succeeds and changes nothing, which is the worst of both.
  const wanted = installed.find((m) => matches(m.name, DEFAULT_MODEL) && fits(m.parameters));
  if (wanted) return { model: wanted.name, reason: "the recommended model" };

  const best = installed
    .filter((m) => fits(m.parameters))
    .sort((a, b) => (b.parameters ?? 0) - (a.parameters ?? 0))[0];

  if (!best) {
    return {
      model: installed[0].name,
      reason: "every installed model is large for this machine",
    };
  }

  return {
    model: best.name,
    reason:
      installed.length > 1
        ? `largest of your ${installed.length} installed models that fits in memory`
        : "the only model installed",
  };
}

/**
 * One HTTP request to Ollama, over node:http rather than fetch.
 *
 * Node's fetch abandons any request whose response headers take longer than
 * five minutes (undici's headersTimeout), and nothing passed to fetch can lift
 * it. Ollama sends no headers until the first token of its answer — streamed
 * or not — and the first role of a feature spends longer than five minutes
 * reading the whole script before it can produce one. So every first role
 * failed at five minutes with UND_ERR_HEADERS_TIMEOUT, reported as Ollama
 * being unreachable while it was busy doing exactly what it was asked.
 *
 * node:http has no such limit. The only ceiling here is the one the caller
 * sets, which is what the caller's timeout always claimed to be.
 */
function loopbackRequest(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers as Record<string, string> | undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          clearTimeout(timer);
          resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 500 }));
        });
        res.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      },
    );
    const timer = setTimeout(() => {
      const error = new Error(`timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      req.destroy(error);
      reject(error);
    }, timeoutMs);
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    if (init.body) req.write(init.body as string);
    req.end();
  });
}

/** The underlying network error — "fetch failed" alone says nothing. */
function causeOf(error: unknown): string {
  const direct = (error as { code?: string })?.code;
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  return direct || cause?.code || cause?.message || "";
}

async function ollamaFetch(
  config: OllamaConfig,
  path: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 60_000, ...rest } = init;
  try {
    return await loopbackRequest(`${config.baseUrl}${path}`, rest, timeoutMs);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new OllamaError(
      timedOut
        ? `Ollama did not respond within ${Math.round(timeoutMs / 1000)}s at ${config.baseUrl}. ` +
            `A large model on a busy machine can exceed this — close other apps and try again.`
        : `Cannot reach Ollama at ${config.baseUrl} (${causeOf(error) || reason}). ` +
            `If Ollama is running, it may have stopped mid-request — check its window for ` +
            `an out-of-memory message. Otherwise start it with: ollama serve`,
      503,
      reason,
    );
  }
}

/**
 * Check Ollama is up and the model is pulled, and report the model's real
 * context length so we can size prompts to it rather than guessing.
 */
export async function preflight(config: OllamaConfig): Promise<OllamaConfig> {
  const tags = await ollamaFetch(config, "/api/tags", { method: "GET", timeoutMs: 10_000 });
  if (!tags.ok) {
    throw new OllamaError(
      `Ollama answered ${tags.status} at ${config.baseUrl}/api/tags.`,
      502,
      (await tags.text().catch(() => "")).slice(0, 300),
    );
  }

  const body = (await tags.json().catch(() => null)) as { models?: { name?: string }[] } | null;
  const installed = (body?.models ?? []).map((m) => m.name ?? "");
  const wanted = config.model;
  const present = installed.some(
    (name) => name === wanted || name.replace(/:latest$/, "") === wanted.replace(/:latest$/, ""),
  );
  if (installed.length && !present) {
    throw new OllamaError(
      `Ollama is running but the model "${wanted}" is not installed. Run: ollama pull ${wanted}`,
      502,
      `installed: ${installed.join(", ")}`,
    );
  }

  const { contextLength: modelCtx, parameters } = await modelDetails(config);
  // Never ask for more context than the model has.
  const numCtx = modelCtx ? Math.min(config.numCtx, modelCtx) : config.numCtx;

  if (numCtx < MIN_NUM_CTX) {
    throw new OllamaError(
      `"${config.model}" offers only ${numCtx} tokens of context, and this needs at least ` +
        `${MIN_NUM_CTX}. Use a model with a larger context window (llama3.1:8b has 128k), ` +
        `or raise OLLAMA_NUM_CTX if you lowered it.`,
      502,
    );
  }

  const runningRecommended =
    config.model === DEFAULT_MODEL ||
    config.model.replace(/:latest$/, "") === DEFAULT_MODEL.replace(/:latest$/, "");

  const warning = !runningRecommended
    ? `Running ${config.model}. This version is built for ${DEFAULT_MODEL}, which is not ` +
      `installed — close this, double-click "Start ScriptToCast" and say yes when it ` +
      `offers the download. Until then the descriptions are not what they should be.`
    : parameters !== null && parameters < MIN_USEFUL_PARAMETERS_B
      ? `Running ${config.model}, which has ${parameters}B parameters. This path needs ` +
        `about ${MIN_USEFUL_PARAMETERS_B}B to write usable descriptions — below that they come ` +
        `back thin or generic however the prompt is written. Install ${DEFAULT_MODEL} from ` +
        `the button on this page, or run "ollama pull ${DEFAULT_MODEL}" yourself.`
      : undefined;

  if (warning) console.warn(`analyze_local: ${warning}`);

  return {
    ...config,
    numCtx,
    promptCharBudget: promptCharBudgetFor(numCtx),
    warning,
    parameters,
    modelContextLimit: modelCtx ?? null,
  };
}

/**
 * Smallest model that writes usable casting copy, from the same JSON.
 *
 * Below this the format survives but the substance does not: descriptions come
 * back as adjectives, or as whatever the prompt last said. Worth saying out
 * loud, because OLLAMA_MODEL can be set in .env.local and quietly override the
 * default — which happened here, and cost three rounds of tuning prompts
 * against a model that had supposedly been replaced.
 */
const MIN_USEFUL_PARAMETERS_B = recommended.minParametersB;

/** Parameter count in billions, from /api/show ("3.2B", "8.0B"). */
function parameterBillions(details: Record<string, unknown> | undefined): number | null {
  const raw = details?.parameter_size;
  if (typeof raw !== "string") return null;
  const match = /([\d.]+)\s*([BM])/i.exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return match[2].toUpperCase() === "M" ? value / 1000 : value;
}

/** The model's own context length, from /api/show. Null when unreported. */
async function modelDetails(
  config: OllamaConfig,
): Promise<{ contextLength: number | null; parameters: number | null }> {
  const res = await ollamaFetch(config, "/api/show", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model }),
    timeoutMs: 15_000,
  });
  if (!res.ok) return { contextLength: null, parameters: null };

  const body = (await res.json().catch(() => null)) as
    | { model_info?: Record<string, unknown>; details?: Record<string, unknown> }
    | null;

  let contextLength: number | null = null;
  // The key is architecture-prefixed: "llama.context_length", "qwen2.context_length"...
  for (const [key, value] of Object.entries(body?.model_info ?? {})) {
    if (key.endsWith(".context_length") && typeof value === "number" && value > 0) {
      contextLength = value;
      break;
    }
  }

  return { contextLength, parameters: parameterBillions(body?.details) };
}

export interface ChatJsonOptions {
  system: string;
  user: string;
  /** JSON Schema constraining the reply. Ollama grammar-constrains generation to it. */
  schema: Record<string, unknown>;
  /** Label used in errors and logs, e.g. "project" or "role: CHUBBS". */
  label: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  /**
   * How long Ollama keeps the model — and its prompt cache — resident after
   * the call. The whole-script design depends on this: the script is read once
   * and every later role reuses that work. Default it to nothing and the cache
   * can be evicted between roles, which turns one prefill into forty.
   */
  keepAlive?: string;
}

/**
 * One structured call. Returns parsed JSON or throws — it never returns a
 * partially-understood object, because a silently empty breakdown is worse
 * than an error the user can act on.
 */
export async function chatJson<T>(
  config: OllamaConfig,
  {
    system,
    user,
    schema,
    label,
    timeoutMs = 180_000,
    maxOutputTokens = 1024,
    keepAlive = "30m",
  }: ChatJsonOptions,
): Promise<T> {
  const promptChars = system.length + user.length;
  if (promptChars > config.promptCharBudget) {
    // Callers size their own prompts; this is a backstop against a regression
    // that would put us back to silently truncated input.
    throw new OllamaError(
      `Internal error: prompt for ${label} is ${promptChars} chars, over the ` +
        `${config.promptCharBudget}-char budget for a ${config.numCtx}-token context.`,
      500,
    );
  }

  const res = await ollamaFetch(config, "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    timeoutMs,
    body: JSON.stringify({
      model: config.model,
      // Streamed, and not for the progress. Node's fetch gives up if response
      // headers take longer than five minutes, and with stream:false Ollama
      // sends none until the whole answer exists. The first role of a feature
      // spends longer than that reading the script, so the call died at the
      // five-minute mark whatever timeout was set here — and was reported as
      // "Cannot reach Ollama". Streaming sends headers at once.
      stream: true,
      format: schema,
      keep_alive: keepAlive,
      options: {
        temperature: 0,
        num_ctx: config.numCtx,
        num_predict: maxOutputTokens,
      },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 404) {
      throw new OllamaError(
        `Ollama does not have the model "${config.model}". Run: ollama pull ${config.model}`,
        502,
        detail,
      );
    }
    if (/memory|out of memory|insufficient|system memory/i.test(detail)) {
      // The failure a larger default model makes likely, and the one whose
      // raw message ("model requires more system memory") tells a user
      // nothing about what to do next.
      throw new OllamaError(
        `"${config.model}" needs more free memory than this Mac has right now. ` +
          `Close some other apps and try again.`,
        502,
        detail,
      );
    }
    if (res.status === 400 && /format/i.test(detail)) {
      throw new OllamaError(
        "This Ollama build rejected a JSON-schema response format. " +
          "Structured output needs Ollama 0.5 or newer — please update Ollama.",
        502,
        detail,
      );
    }
    throw new OllamaError(`Ollama error ${res.status} while generating ${label}.`, 502, detail);
  }

  // Newline-delimited chunks, each carrying a piece of the answer; the last
  // carries done_reason. A single unstreamed object parses the same way.
  let content = "";
  let doneReason: string | undefined;
  const raw = await res.text().catch(() => "");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const chunk = JSON.parse(line) as {
        message?: { content?: string };
        done_reason?: string;
        error?: string;
      };
      if (chunk.error) throw new OllamaError(`Ollama reported an error on ${label}: ${chunk.error}`, 502);
      content += chunk.message?.content ?? "";
      if (chunk.done_reason) doneReason = chunk.done_reason;
    } catch (error) {
      if (error instanceof OllamaError) throw error;
      // A partial line; ignore it.
    }
  }
  const data = { done_reason: doneReason };

  if (data?.done_reason === "length") {
    throw new OllamaError(
      `The local model ran out of output room on ${label}. ` +
        `Raise OLLAMA_NUM_CTX (currently ${config.numCtx}) or use a larger model.`,
      502,
      content.slice(0, 300),
    );
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new OllamaError(
      `The local model returned invalid JSON for ${label}.`,
      502,
      content.slice(0, 300),
    );
  }
}
