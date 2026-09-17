import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import {
  ANALYSIS_JSON_SCHEMA,
  COMMERCIAL_TYPES,
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

// Claude accepts 600 PDF pages per request on large-context models, and 32MB
// per request overall. Base64 inflates by 4/3, so cap raw bytes well under that
// to leave room for the prompt.
const MAX_PDF_PAGES = 600;
const MAX_CHUNK_BYTES = 20 * 1024 * 1024;

interface PdfChunk {
  fileName: string;
  /** First page number of this chunk within the original document (1-indexed). */
  pageOffset: number;
  base64: string;
}

/**
 * Split a PDF into chunks that fit the API's page and size limits. Most scripts
 * come back as a single chunk; only very long or image-heavy PDFs split.
 */
async function splitPdf(
  source: PDFDocument,
  fileName: string,
  startPage: number,
  endPage: number,
): Promise<PdfChunk[]> {
  const pageCount = endPage - startPage;
  if (pageCount <= 0) return [];

  if (pageCount <= MAX_PDF_PAGES) {
    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(
      source,
      Array.from({ length: pageCount }, (_, i) => startPage + i),
    );
    pages.forEach((p) => doc.addPage(p));
    const bytes = await doc.save();

    if (bytes.length <= MAX_CHUNK_BYTES || pageCount === 1) {
      return [{
        fileName,
        pageOffset: startPage + 1,
        base64: Buffer.from(bytes).toString("base64"),
      }];
    }
  }

  // Too many pages or too many bytes — halve and recurse.
  const mid = startPage + Math.ceil(pageCount / 2);
  const [left, right] = await Promise.all([
    splitPdf(source, fileName, startPage, mid),
    splitPdf(source, fileName, mid, endPage),
  ]);
  return [...left, ...right];
}

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

      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        system,
        thinking: { type: "adaptive" },
        output_config: {
          format: { type: "json_schema", schema: ANALYSIS_JSON_SCHEMA },
        },
        messages: [{ role: "user", content }],
      });

      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") return null;

      try {
        return JSON.parse(textFrom(message)) as AnalysisResult;
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
