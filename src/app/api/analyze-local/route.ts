import { NextResponse } from "next/server";
import { createHash } from "crypto";
import type { BreakdownMode } from "@/lib/breakdown";
import { isVercelHosted } from "@/lib/runtime";
import { LocalAnalysisError } from "@/lib/local/errors";
import { extractDocument, type ExtractedDocument } from "@/lib/local/extract";
import { analyzeLocally } from "@/lib/local/pipeline";
import { preflight, resolveConfig } from "@/lib/local/ollama";

export const maxDuration = 300;
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
    const config = await preflight(resolveConfig());

    const documents: ExtractedDocument[] = [];
    for (const file of files) documents.push(await extractDocument(file));

    const scriptSha = createHash("sha256")
      .update(documents.flatMap((d) => d.pages).join("\n"))
      .digest("hex");

    const { result, diagnostics } = await analyzeLocally(
      documents,
      mode,
      config,
      (message, data) => console.log(message, data ?? {}),
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

    return NextResponse.json({
      ...result,
      meta: {
        provider: "ollama",
        model: config.model,
        numCtx: config.numCtx,
        third_party_ai: false,
        script_sha256: scriptSha,
        diagnostics,
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
