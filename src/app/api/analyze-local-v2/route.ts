import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { totalmem } from "os";
import type { BreakdownMode } from "@/lib/breakdown";
import { isVercelHosted } from "@/lib/runtime";
import { isLocale, type Locale } from "@/lib/locale";
import { LocalAnalysisError } from "@/lib/local/errors";
import { extractDocument, type ExtractedDocument } from "@/lib/local/extract";
import { pickBestModel, preflight, resolveConfig } from "@/lib/local/ollama";
import { analyzeLocallyV2 } from "@/lib/local-v2/pipeline";

export const maxDuration = 300;
export const runtime = "nodejs";

const HEARTBEAT_MS = 5000;

/**
 * Private analysis, v2. Ollama on this machine, and nothing else.
 *
 * Same contract as /api/analyze-local (multipart `files`, `mode`, `locale`,
 * optional `onlyRoles`; NDJSON progress then one result), so the same bench
 * runner can point at either. v1 is untouched.
 *
 * There is no Anthropic SDK import here or anywhere it reaches, and there must
 * never be one, not even as a fallback when Ollama is down. When local
 * analysis cannot run, this fails with an error the user can act on.
 *
 * Model: OLLAMA_V2_MODEL if set, else the usual pick (OLLAMA_MODEL pins it,
 * default llama3.1:8b). Window: OLLAMA_NUM_CTX, capped at 16k by v2.
 * Nothing is persisted; the upload lives in memory for this request only.
 *
 * Scans: a PDF with no text layer (or a garbled one) is OCR'd locally with
 * poppler + tesseract, watermark cleaned per page. LOCAL_OCR=0 turns it off.
 * See PRIVATE-V2.md. The temp files used are deleted before the run continues.
 */
export async function POST(request: Request) {
  if (isVercelHosted()) {
    return NextResponse.json(
      { error: "The private local-model path only runs on your Mac. This hosted site cannot reach Ollama on your laptop." },
      { status: 403 },
    );
  }

  try {
    const formData = await request.formData();
    const files = formData.getAll("files").filter((f): f is File => f instanceof File);
    if (!files.length) return NextResponse.json({ error: "No files provided" }, { status: 400 });

    const requestedLocale = formData.get("locale");
    const locale: Locale = isLocale(requestedLocale) ? requestedLocale : "us";
    const onlyRoles = String(formData.get("onlyRoles") ?? "").split(",").map((n) => n.trim()).filter(Boolean);
    const requested = formData.get("mode");
    const mode: BreakdownMode = requested === "film_tv" || requested === "commercial" ? requested : "auto";

    const base = resolveConfig();
    const forced = process.env.OLLAMA_V2_MODEL?.trim();
    const model = forced || (await pickBestModel(base, totalmem())).model;
    const config = await preflight({ ...resolveConfig(model), model });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          } catch {
            // Client hung up.
          }
        };
        let latest: unknown = { phase: "project", message: "Starting" };
        const heartbeat = setInterval(() => send({ progress: latest }), HEARTBEAT_MS);
        try {
          // Reading happens inside the stream because a scanned script is OCR'd
          // locally, which takes about 30 seconds, and the page needs to say so.
          const documents: ExtractedDocument[] = [];
          const ocrNotes: unknown[] = [];
          for (const file of files) {
            const doc = await extractDocument(file, {
              ocr: "auto",
              onOcr: ({ stage, done, total }) => {
                latest = {
                  phase: "project",
                  message:
                    stage === "start"
                      ? "This looks like a scan. Reading the pages on this Mac, which takes about 30 seconds"
                      : `Reading scanned pages (${done} of ${total})`,
                  done,
                  total,
                };
                send({ progress: latest });
              },
            });
            documents.push(doc);
            if (doc.ocr) {
              // Counts and timings only. Never the text.
              const { perPage: _perPage, ...summary } = doc.ocr;
              ocrNotes.push(summary);
            }
          }
          const scriptSha = createHash("sha256").update(documents.flatMap((d) => d.pages).join("\n")).digest("hex");
          if (ocrNotes.length) console.log("analyze_local_v2: ocr", ocrNotes);
          latest = { phase: "project", message: "Reading the title page" };
          const { result, diagnostics } = await analyzeLocallyV2(
            documents,
            mode,
            config,
            (message, data) => console.log(message, data ?? {}),
            (progress) => {
              latest = progress;
              send({ progress });
            },
            locale,
            { onlyRoles },
          );
          console.log("analyze_local_v2: done", {
            script_sha256: scriptSha,
            provider: "ollama",
            third_party_ai: false,
            ...diagnostics,
            droppedCues: diagnostics.droppedCues.length,
            merged: diagnostics.merged.length,
          });
          send({
            result: {
              ...result,
              meta: {
                version: "v2",
                provider: "ollama",
                model: config.model,
                numCtx: diagnostics.numCtx,
                third_party_ai: false,
                script_sha256: scriptSha,
                warning: config.warning,
                ocr: ocrNotes.length ? ocrNotes : undefined,
                diagnostics,
              },
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Local analysis failed";
          if (error instanceof LocalAnalysisError) console.error("analyze_local_v2:", error.message, error.detail ?? "");
          else console.error("analyze_local_v2: failed mid-run", error);
          send({ error: message });
        } finally {
          clearInterval(heartbeat);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
    });
  } catch (error) {
    if (error instanceof LocalAnalysisError) {
      if (error.detail) console.error("analyze_local_v2:", error.message, error.detail);
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status });
    }
    console.error("analyze_local_v2: unexpected failure", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Local analysis failed" }, { status: 500 });
  }
}
