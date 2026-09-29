/**
 * One structured Ollama call for v2 that also reports what the call cost.
 *
 * Same rules as ../local/ollama.ts chatJson: loopback only (assertLocalOllama),
 * node:http rather than fetch (no five-minute header timeout), streamed, JSON
 * schema constrained, temperature 0. The difference is that it returns Ollama's
 * own token counts, so a run can show the real prompt size per role instead of
 * an estimate. Nothing here can reach anything but the local Ollama.
 */
import { request as httpRequest } from "node:http";
import { assertLocalOllama, OllamaError, type OllamaConfig } from "../local/ollama";

export interface ChatStats {
  /** Tokens Ollama evaluated for the prompt on this call (cached prefix tokens are not re-counted). */
  promptEval: number;
  /** Tokens generated. */
  evalCount: number;
  ms: number;
}

export interface ChatOptions {
  system: string;
  user: string;
  schema: unknown;
  label: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  keepAlive?: string;
  /** Diagnostic only: prepended to the system prompt to defeat the prompt cache so promptEval is the full size. */
  cacheBust?: string;
}

function post(config: OllamaConfig, path: string, body: string, timeoutMs: number): Promise<{ status: number; text: string }> {
  assertLocalOllama(config.baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${config.baseUrl}${path}`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 500, text: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
      },
    );
    const timer = setTimeout(() => {
      const e = new Error(`timed out after ${timeoutMs}ms`);
      e.name = "TimeoutError";
      req.destroy(e);
      reject(e);
    }, timeoutMs);
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.end(body);
  });
}

export async function chatRole<T>(config: OllamaConfig, o: ChatOptions): Promise<{ data: T; stats: ChatStats }> {
  const started = Date.now();
  let res: { status: number; text: string };
  try {
    res = await post(
      config,
      "/api/chat",
      JSON.stringify({
        model: config.model,
        stream: true,
        format: o.schema,
        keep_alive: o.keepAlive ?? "10m",
        options: { temperature: 0, num_ctx: config.numCtx, num_predict: o.maxOutputTokens ?? 500 },
        messages: [
          { role: "system", content: `${o.cacheBust ?? ""}${o.system}` },
          { role: "user", content: o.user },
        ],
      }),
      o.timeoutMs ?? 600_000,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new OllamaError(
      `Cannot reach Ollama at ${config.baseUrl} while generating ${o.label} (${reason}). Nothing was sent anywhere.`,
      503,
      reason,
    );
  }
  if (res.status !== 200) {
    throw new OllamaError(`Ollama error ${res.status} while generating ${o.label}.`, 502, res.text.slice(0, 300));
  }
  let content = "";
  let doneReason: string | undefined;
  let promptEval = 0;
  let evalCount = 0;
  for (const line of res.text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const c = JSON.parse(line) as {
        message?: { content?: string };
        done_reason?: string;
        error?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      if (c.error) throw new OllamaError(`Ollama reported an error on ${o.label}: ${c.error}`, 502);
      content += c.message?.content ?? "";
      if (c.done_reason) doneReason = c.done_reason;
      if (typeof c.prompt_eval_count === "number") promptEval = c.prompt_eval_count;
      if (typeof c.eval_count === "number") evalCount = c.eval_count;
    } catch (error) {
      if (error instanceof OllamaError) throw error;
    }
  }
  if (doneReason === "length") {
    throw new OllamaError(`The local model ran out of output room on ${o.label}.`, 502, content.slice(0, 300));
  }
  try {
    return { data: JSON.parse(content) as T, stats: { promptEval, evalCount, ms: Date.now() - started } };
  } catch {
    throw new OllamaError(`The local model returned invalid JSON for ${o.label}.`, 502, content.slice(0, 300));
  }
}
