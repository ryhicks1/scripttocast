/**
 * Minimal Ollama client for the private path.
 *
 * Everything here talks to a model running on this machine. There is no
 * third-party fallback anywhere in this file, or anywhere it is called from:
 * when the local model is unavailable the request fails, loudly. Falling back
 * to a hosted API would send a confidential script off the machine, which is
 * the one thing the private path exists to prevent.
 */

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
export const DEFAULT_MODEL = "llama3.2";

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

function envNumber(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

/** Read config from the environment. Does not contact Ollama. */
export function resolveConfig(): OllamaConfig {
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;
  assertLocalOllama(baseUrl);
  const numCtx = envNumber("OLLAMA_NUM_CTX") ?? DEFAULT_NUM_CTX;
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    model: process.env.OLLAMA_MODEL || DEFAULT_MODEL,
    numCtx,
    promptCharBudget: promptCharBudgetFor(numCtx),
  };
}

async function ollamaFetch(
  config: OllamaConfig,
  path: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 60_000, ...rest } = init;
  try {
    return await fetch(`${config.baseUrl}${path}`, {
      ...rest,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new OllamaError(
      timedOut
        ? `Ollama did not respond within ${Math.round(timeoutMs / 1000)}s at ${config.baseUrl}. ` +
            `A large model on a small machine can exceed this — try a smaller model, e.g. OLLAMA_MODEL=llama3.2.`
        : `Cannot reach Ollama at ${config.baseUrl}. Start it with: ollama serve`,
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

  const modelCtx = await modelContextLength(config);
  // Never ask for more context than the model has.
  const numCtx = modelCtx ? Math.min(config.numCtx, modelCtx) : config.numCtx;

  if (numCtx < MIN_NUM_CTX) {
    throw new OllamaError(
      `"${config.model}" offers only ${numCtx} tokens of context, and this needs at least ` +
        `${MIN_NUM_CTX}. Use a model with a larger context window (llama3.2 has 128k), ` +
        `or raise OLLAMA_NUM_CTX if you lowered it.`,
      502,
    );
  }

  return { ...config, numCtx, promptCharBudget: promptCharBudgetFor(numCtx) };
}

/** The model's own context length, from /api/show. Null when unreported. */
async function modelContextLength(config: OllamaConfig): Promise<number | null> {
  const res = await ollamaFetch(config, "/api/show", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model }),
    timeoutMs: 15_000,
  });
  if (!res.ok) return null;

  const body = (await res.json().catch(() => null)) as
    | { model_info?: Record<string, unknown> }
    | null;
  const info = body?.model_info ?? {};
  // The key is architecture-prefixed: "llama.context_length", "qwen2.context_length"...
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith(".context_length") && typeof value === "number" && value > 0) {
      return value;
    }
  }
  return null;
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
}

/**
 * One structured call. Returns parsed JSON or throws — it never returns a
 * partially-understood object, because a silently empty breakdown is worse
 * than an error the user can act on.
 */
export async function chatJson<T>(
  config: OllamaConfig,
  { system, user, schema, label, timeoutMs = 180_000, maxOutputTokens = 1024 }: ChatJsonOptions,
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
      stream: false,
      format: schema,
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

  const data = (await res.json().catch(() => null)) as
    | { message?: { content?: string }; done_reason?: string }
    | null;
  const content = data?.message?.content ?? "";

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
