import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { splitPdf, type PdfChunk } from "@/lib/pdf";
import {
  ANALYSIS_JSON_SCHEMA,
  COMMERCIAL_TYPES,
  normalizeResult,
  type AnalysisResult,
  type BreakdownMode,
  type FormQuestion,
  type Project,
  type Role,
  type SelfTapeInstruction,
} from "@/lib/breakdown";
import { buildSystemPrompt } from "@/lib/prompts";

export const maxDuration = 300;

const MODEL = "claude-opus-5";

// A feature script plus a full cast of breakdowns is minutes of generation at
// the default "high" effort, which overruns the function's time limit. This is
// extraction and structured writing rather than hard reasoning, so low effort
// costs little in quality and buys back most of the wall-clock.
const EFFORT = "low" as const;
const MAX_TOKENS = 32000;

function textFrom(message: Anthropic.Message): string {
  // Adaptive thinking puts thinking blocks in content, so find the text block
  // rather than assuming content[0].
  const block = message.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
}

/** Merge per-chunk results into one breakdown, deduplicating roles by name. */
function mergeResults(results: AnalysisResult[]): AnalysisResult {
  const merged: AnalysisResult = {
    ...results[0],
    roles: [],
    selfTapeInstructions: [],
    formQuestions: [],
  };

  // Fill project fields a later chunk knows but the first one didn't.
  for (const result of results.slice(1)) {
    backfillProject(merged.project, result.project);
  }
  merged.project.contentAdvisories = union(results.map((r) => r.project?.contentAdvisories));
  merged.project.submissionNotes = union(results.map((r) => r.project?.submissionNotes));

  const roles = new Map<string, Role>();
  for (const result of results) {
    for (const role of result.roles ?? []) {
      const key = role.name?.toLowerCase().trim();
      if (!key) continue;

      const existing = roles.get(key);
      if (!existing) {
        roles.set(key, { ...role });
        continue;
      }

      existing.pageNumbers = [
        ...new Set([...(existing.pageNumbers ?? []), ...(role.pageNumbers ?? [])]),
      ].sort((a, b) => a - b);
      existing.characteristics = union([existing.characteristics, role.characteristics]);
      existing.contentAdvisories = union([existing.contentAdvisories, role.contentAdvisories]);
      existing.submissionNotes = union([existing.submissionNotes, role.submissionNotes]);
      existing.speaking = existing.speaking || role.speaking;

      // A chunk that saw more of the character usually writes more; prefer that,
      // and backfill any demographic field this chunk resolved and the other didn't.
      if ((role.description ?? "").length > (existing.description ?? "").length) {
        existing.description = role.description;
      }
      existing.ageRange ??= role.ageRange;
      existing.gender ??= role.gender;
      existing.ethnicity ??= role.ethnicity;
      existing.roleType ??= role.roleType;
    }
  }
  merged.roles = [...roles.values()];

  merged.selfTapeInstructions = dedupeByRole<SelfTapeInstruction>(
    results.flatMap((r) => r.selfTapeInstructions ?? []),
  );
  merged.formQuestions = dedupeByRole<FormQuestion>(
    results.flatMap((r) => r.formQuestions ?? []),
  );

  return merged;
}

/** Copy fields a later chunk resolved into the project the first chunk built. */
function backfillProject(target: Project, source: Project | undefined): void {
  if (!source) return;
  // Values are heterogeneous across keys, so write through an index signature.
  const writable = target as unknown as Record<string, unknown>;
  for (const key of Object.keys(target)) {
    const current = writable[key];
    if (current !== null && current !== "") continue;
    const incoming = (source as unknown as Record<string, unknown>)[key];
    if (incoming) writable[key] = incoming;
  }
}

function union(lists: (string[] | undefined)[]): string[] {
  return [...new Set(lists.flatMap((l) => l ?? []))];
}

function dedupeByRole<T extends { roleName: string }>(items: T[]): T[] {
  const byRole = new Map<string, T>();
  for (const item of items) {
    const key = item.roleName?.toLowerCase().trim();
    if (key && !byRole.has(key)) byRole.set(key, item);
  }
  return [...byRole.values()];
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (!files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const requestedMode = (formData.get("mode") as BreakdownMode) || "auto";
    const mode: BreakdownMode = ["film_tv", "commercial", "auto"].includes(requestedMode)
      ? requestedMode
      : "auto";

    const anthropic = new Anthropic();
    const pdfChunks: PdfChunk[] = [];
    const textParts: string[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());

      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        const pdfDoc = await PDFDocument.load(buffer);
        pdfChunks.push(
          ...(await splitPdf(pdfDoc, file.name, 0, pdfDoc.getPageCount())),
        );
      } else {
        textParts.push(`=== ${file.name} ===\n${buffer.toString("utf-8")}`);
      }
    }

    const system: Anthropic.TextBlockParam[] = [{
      type: "text",
      text: buildSystemPrompt(mode),
      cache_control: { type: "ephemeral" },
    }];

    async function analyzeChunk(chunk?: PdfChunk): Promise<AnalysisResult | null> {
      const content: Anthropic.ContentBlockParam[] = [];
      const notes: string[] = [];

      if (chunk) {
        content.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: chunk.base64 },
        });
        notes.push(`=== ${chunk.fileName} (PDF attached above) ===`);
        if (pdfChunks.length > 1) {
          notes.push(
            `This is one section of "${chunk.fileName}". Its first page is page ` +
            `${chunk.pageOffset} of the original document — report pageNumbers ` +
            `using those original numbers, starting at ${chunk.pageOffset}.`,
          );
        }
      }

      content.push({
        type: "text",
        text: `Analyze these casting documents and produce the breakdown.\n\n${
          [...notes, ...textParts].join("\n\n")
        }`,
      });

      const startedAt = Date.now();
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        // Adaptive thinking stays on — disabling it on this model degrades
        // output. Effort is the lever that actually buys back time, and this
        // is extraction plus structured writing, not a reasoning problem.
        thinking: { type: "adaptive" },
        output_config: {
          effort: EFFORT,
          format: { type: "json_schema", schema: ANALYSIS_JSON_SCHEMA },
        },
        messages: [{ role: "user", content }],
      });

      const message = await stream.finalMessage();
      const elapsedMs = Date.now() - startedAt;

      // The serverless function has a hard ceiling, so log what each call
      // actually costs in wall-clock and tokens. A timeout kills the function
      // before this runs; seeing it at all means the call finished.
      console.log("analyze: claude call finished", {
        elapsedSeconds: Math.round(elapsedMs / 1000),
        effort: EFFORT,
        stopReason: message.stop_reason,
        inputTokens: message.usage?.input_tokens,
        outputTokens: message.usage?.output_tokens,
        cacheReadTokens: message.usage?.cache_read_input_tokens,
      });

      if (message.stop_reason === "refusal") return null;
      if (message.stop_reason === "max_tokens") {
        console.error("analyze: hit max_tokens — output truncated", { MAX_TOKENS });
        return null;
      }

      try {
        return normalizeResult(JSON.parse(textFrom(message)) as AnalysisResult);
      } catch {
        // Schema-constrained output should always parse; a failure here means
        // the response was truncated.
        console.error("Failed to parse analysis response", {
          stopReason: message.stop_reason,
        });
        return null;
      }
    }

    const settled = pdfChunks.length
      ? await Promise.all(pdfChunks.map((chunk) => analyzeChunk(chunk)))
      : [await analyzeChunk()];

    const results = settled.filter((r): r is AnalysisResult => r !== null);
    if (!results.length) {
      return NextResponse.json(
        { error: "Analysis failed. Please try again." },
        { status: 500 },
      );
    }

    const result = results.length === 1 ? results[0] : mergeResults(results);

    // "auto" leaves the mode to the model; keep it honest against the type it chose.
    if (mode !== "auto") {
      result.mode = mode;
    } else if (COMMERCIAL_TYPES.has(result.project?.type)) {
      result.mode = "commercial";
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Analyze error:", error);
    const message = error instanceof Error ? error.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
