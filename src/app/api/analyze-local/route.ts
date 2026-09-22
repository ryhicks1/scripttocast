import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { totalmem } from "os";
import type { BreakdownMode } from "@/lib/breakdown";
import { isVercelHosted } from "@/lib/runtime";
import { LocalAnalysisError } from "@/lib/local/errors";
import { extractDocument, type ExtractedDocument } from "@/lib/local/extract";
import { analyzeLocally } from "@/lib/local/pipeline";
import { pickBestModel, preflight, resolveConfig } from "@/lib/local/ollama";

export const maxDuration = 300;

/** How often to repeat the last progress line when a phase runs long. */
const HEARTBEAT_MS = 5000;
export const runtime = "nodejs";

/**
 * Private analysis. Ollama on this machine, and nothing else.
 *
 * There is no import of the Anthropic SDK in this file or anything it reaches,
 * and there must never be one — not even as a fallback when Ollama is down.
 * A silent fallback would send a confidential script to a third party, which is
 * the single property this path is sold on. When local analysis cannot run,
 * this route fails with an error the user can act on.
 *
 * Nothing is persisted. The uploaded document exists as a Buffer for the life
 * of this request and is never written to disk or to a bucket.
 */
export async function POST(request: Request) {
  if (isVercelHosted()) {
    return NextResponse.json(
      {
        error:
          "The private local-model path only runs on your Mac. This hosted site cannot reach Ollama on your laptop. Clone the repo, run npm run dev, and open http://localhost:3000/private.",
      },
      { status: 403 },
    );
  }

  try {
    const formData = await request.formData();
    const files = formData.getAll("files").filter((f): f is File => f instanceof File);
    if (!files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const requested = formData.get("mode");
    const mode: BreakdownMode =
      requested === "film_tv" || requested === "commercial" ? requested : "auto";

    // Fail before reading documents if Ollama is not there: the user should be
    // told to start it, not left waiting on an extraction that leads nowhere.
    // Pick the best installed model for this machine rather than making the
    // user name one in a config file.
    const { model } = await pickBestModel(resolveConfig(), totalmem());
    const config = await preflight({ ...resolveConfig(), model });

    const documents: ExtractedDocument[] = [];
    for (const file of files) documents.push(await extractDocument(file));

    const scriptSha = createHash("sha256")
      .update(documents.flatMap((d) => d.pages).join("\n"))
      .digest("hex");

    // Stream progress as newline-delimited JSON, then the result.
    //
    // A feature script is forty roles and forty model calls — minutes of work.
    // Two things go wrong if nothing is sent back in that time: a browser drops
    // a request that quiet, and the person watching has no way to tell a slow
    // run from a dead one.
    //
    // Each line is its own JSON object: {"progress":{...}} while working, then
    // one {"result":{...}} or {"error":"..."} at the end. Everything that can
    // fail with a status code — preflight, extraction — has already run above,
    // so anything failing from here is reported inside the stream instead.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          } catch {
            // Client hung up; the analysis below finishes and is discarded.
          }
        };

        // Phases before the per-role loop can run for half a minute on their
        // own, so the last progress line is repeated rather than leaving a gap
        // long enough for the connection to look dead.
        let latest: unknown = { phase: "project", message: "Starting" };
        const heartbeat = setInterval(() => send({ progress: latest }), HEARTBEAT_MS);

        try {
          const { result, diagnostics } = await analyzeLocally(
            documents,
            mode,
            config,
            (message, data) => console.log(message, data ?? {}),
            (progress) => {
              latest = progress;
              send({ progress });
            },
          );

          // The hash identifies a run in the logs without recording the script.
          console.log("analyze_local: done", {
            script_sha256: scriptSha,
            provider: "ollama",
            model: config.model,
            num_ctx: config.numCtx,
            third_party_ai: false,
            ...diagnostics,
          });

          send({
            result: {
              ...result,
              meta: {
                provider: "ollama",
                model: config.model,
                numCtx: config.numCtx,
                third_party_ai: false,
                script_sha256: scriptSha,
                warning: config.warning,
                diagnostics,
              },
            },
          });
        } catch (error) {
          const message =
            error instanceof LocalAnalysisError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Local analysis failed";
          console.error("analyze_local: failed mid-run", error);
          send({ error: message });
        } finally {
          clearInterval(heartbeat);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        // Tell any proxy in the way not to buffer the heartbeat.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof LocalAnalysisError) {
      if (error.detail) console.error("analyze_local:", error.message, error.detail);
      return NextResponse.json(
        { error: error.message, detail: error.detail },
        { status: error.status },
      );
    }
    console.error("analyze_local: unexpected failure", error);
    const message = error instanceof Error ? error.message : "Local analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
