/**
 * The private breakdown pipeline: the same job as the public path, on Ollama.
 *
 * The public path hands the house prompt and the document to Claude and gets
 * one nested breakdown back. For a long time this path did something else —
 * a cast list from formatting, then one tiny call per role against a curated
 * evidence packet — because an early 3B model and an 8192-token context window
 * could not hold a feature. That produced thin, wrong descriptions and missed
 * the job: read the script and write the breakdown.
 *
 * llama3.1:8b has a 128k window. This pipeline uses it. The system prompt is
 * buildSystemPrompt with nothing appended. The user message is the same line
 * the public path sends, plus the script text. Large scripts are chunked and
 * merged the way the public path chunks and merges. Nothing here talks to a
 * hosted API — the script never leaves the machine.
 */
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
} from "../breakdown";
import { countEmDashes, findMachineTells, findNarrativeVoice } from "../description-quality";
import type { Locale } from "../locale";
import { buildSystemPrompt } from "../prompts";
import { LocalAnalysisError } from "./errors";
import type { ExtractedDocument } from "./extract";
import { chatJson, promptCharBudgetFor, type OllamaConfig } from "./ollama";
import { parseScript } from "./screenplay";

/** Tokens held back for the model's answer on a full-breakdown call. */
const BREAKDOWN_OUTPUT_RESERVE = 3_500;
/** Ceiling on how many tokens the model may write for one chunk. */
const BREAKDOWN_MAX_OUTPUT = 3_500;
/**
 * Per-chunk wall clock. Past this the call is abandoned and the operator
 * (or a smaller chunk size) must take over — sitting quiet for fifteen
 * minutes on one Ollama call is how this path looked dead.
 */
const BREAKDOWN_TIMEOUT_MS = 480_000;
/**
 * Context per breakdown call. Above Ollama's silent-truncation default of
 * 8192; below a laptop-killing 65k load. llama3.1:8b supports 128k — the
 * script is split so each piece plus the house prompt fits here.
 */
const BREAKDOWN_NUM_CTX = 16_384;
/**
 * Script characters per chunk. Sized so an 8B finishes a chunk in well under
 * eight minutes on a laptop (prefill + ~3.5k tokens out). A feature becomes
 * more chunks; each chunk completes.
 */
const BREAKDOWN_CHUNK_CHARS = 14_000;

export interface LocalDiagnostics {
  pages: number;
  /** True when the upload parsed as a screenplay (used for layout diagnostics). */
  parsedAsScreenplay: boolean;
  charactersFound: number;
  rolesDescribed: number;
  rolesFailed: string[];
  rolesOmitted: number;
  modelCalls: number;
  narrativeVoiceFlagged: number;
  repeatedPhrases: string[];
  rolesCopiedPrompt: string[];
  unsupportedEthnicityDropped: number;
  unsupportedAgeDropped: number;
  rolesThin: string[];
  usedLayout: boolean;
  pagesFrom: string;
  evidenceFile: string | null;
  /** How many document chunks were sent to the model. */
  chunks: number;
  elapsedMs: number;
}

export interface LocalAnalysis {
  result: AnalysisResult;
  diagnostics: LocalDiagnostics;
}

type Logger = (message: string, data?: Record<string, unknown>) => void;

export interface LocalProgress {
  phase: "project" | "story" | "cast" | "roles" | "assembling";
  message: string;
  done?: number;
  total?: number;
}

type ProgressReporter = (progress: LocalProgress) => void;

interface TextChunk {
  text: string;
  firstPage: number;
  lastPage: number;
  fileName: string;
}

export async function analyzeLocally(
  documents: ExtractedDocument[],
  requestedMode: BreakdownMode,
  config: OllamaConfig,
  log: Logger = () => {},
  onProgress: ProgressReporter = () => {},
  locale: Locale = "us",
): Promise<LocalAnalysis> {
  const startedAt = Date.now();
  if (!documents.length) {
    throw new LocalAnalysisError("No documents were provided.", 400);
  }

  // Prefer a context window big enough for a feature. The caller's config may
  // still pin a smaller one via OLLAMA_NUM_CTX; preflight already capped it at
  // the model's own limit.
  const working = withBreakdownBudget(config);

  const primary = documents[0];
  const pages = documents.flatMap((doc) => doc.pages);
  const pageLines = documents.flatMap((doc) => doc.pageLines);
  const script = parseScript(pageLines);

  onProgress({ phase: "project", message: "Reading the script" });

  const mode: "film_tv" | "commercial" | "auto" =
    requestedMode === "film_tv" || requestedMode === "commercial" ? requestedMode : "auto";
  const system = buildSystemPrompt(mode, locale);
  const chunks = chunkDocuments(documents, charBudgetFor(working, system));

  if (!chunks.length) {
    throw new LocalAnalysisError("The document had no readable text.", 400);
  }

  onProgress({
    phase: "roles",
    message:
      chunks.length === 1
        ? "Writing the breakdown"
        : `Writing the breakdown (part 1 of ${chunks.length})`,
    done: 0,
    total: chunks.length,
  });

  const results: AnalysisResult[] = [];
  let modelCalls = 0;

  for (const [index, chunk] of chunks.entries()) {
    onProgress({
      phase: "roles",
      message:
        chunks.length === 1
          ? "Writing the breakdown"
          : `Writing the breakdown (part ${index + 1} of ${chunks.length})`,
      done: index,
      total: chunks.length,
    });

    const notes: string[] = [`=== ${chunk.fileName} ===`];
    if (chunks.length > 1) {
      notes.push(
        `This is one section of "${chunk.fileName}". Its first page is page ` +
          `${chunk.firstPage} of the original document — report pageNumbers ` +
          `using those original numbers, starting at ${chunk.firstPage}.`,
      );
    }

    const user =
      `Analyze these casting documents and produce the breakdown.\n\n` +
      `${notes.join("\n")}\n\n${chunk.text}`;

    try {
      const raw = await chatJson<AnalysisResult>(working, {
        system,
        user,
        schema: ANALYSIS_JSON_SCHEMA as unknown as Record<string, unknown>,
        label: chunks.length === 1 ? "breakdown" : `breakdown pages ${chunk.firstPage}-${chunk.lastPage}`,
        timeoutMs: BREAKDOWN_TIMEOUT_MS,
        maxOutputTokens: BREAKDOWN_MAX_OUTPUT,
      });
      modelCalls++;
      if (!raw || !Array.isArray(raw.roles) || !raw.project) {
        throw new LocalAnalysisError(
          `The local model returned a reply that was not a breakdown ` +
            `(pages ${chunk.firstPage}-${chunk.lastPage}). Try again, or check ` +
            `ollama run ${working.model} "hello".`,
          502,
        );
      }
      results.push(normalizeResult(raw));
    } catch (error) {
      log("local: breakdown chunk failed", {
        pages: `${chunk.firstPage}-${chunk.lastPage}`,
        error: String(error),
      });
      throw error;
    }

    onProgress({
      phase: "roles",
      message:
        chunks.length === 1
          ? "Wrote the breakdown"
          : `Wrote part ${index + 1} of ${chunks.length}`,
      done: index + 1,
      total: chunks.length,
    });
  }

  if (!results.length) {
    throw new LocalAnalysisError(
      `The local model returned no usable breakdown. Check that "${working.model}" ` +
        `is working: ollama run ${working.model} "hello".`,
      502,
    );
  }

  onProgress({ phase: "assembling", message: "Putting the breakdown together" });

  let result = results.length === 1 ? results[0] : mergeResults(results);

  if (mode !== "auto") {
    result.mode = mode;
  } else if (COMMERCIAL_TYPES.has(result.project?.type)) {
    result.mode = "commercial";
  }

  const flagged = (result.roles ?? [])
    .map((role) => ({
      name: role.name,
      narrativeVoice: findNarrativeVoice(role.description),
      machineTells: findMachineTells(role.description),
      excessEmDashes: Math.max(0, countEmDashes(role.description) - 1),
    }))
    .filter((entry) => entry.narrativeVoice.length || entry.machineTells.length || entry.excessEmDashes);

  if (flagged.length) {
    log("local: description quality flags", {
      flaggedRoles: flagged.length,
      totalRoles: result.roles?.length ?? 0,
      examples: flagged.slice(0, 5),
    });
  }

  const thin = (result.roles ?? [])
    .filter((role) => {
      const prose = (role.description ?? "").replace(/\.\.\.(LEAD|SUPPORTING|DAY PLAYER|CO-STAR|PRINCIPAL|FEATURED|BACKGROUND).*$/i, "");
      return prose.split(/\s+/).filter(Boolean).length < 12;
    })
    .map((role) => role.name);

  return {
    result,
    diagnostics: {
      pages: pages.length,
      parsedAsScreenplay: script.looksLikeScreenplay,
      charactersFound: result.roles?.length ?? 0,
      rolesDescribed: result.roles?.length ?? 0,
      rolesFailed: [],
      rolesOmitted: 0,
      modelCalls,
      narrativeVoiceFlagged: flagged.length,
      repeatedPhrases: [],
      rolesCopiedPrompt: [],
      unsupportedEthnicityDropped: 0,
      unsupportedAgeDropped: 0,
      rolesThin: thin,
      usedLayout: script.usedLayout,
      pagesFrom: primary.name,
      evidenceFile: null,
      chunks: chunks.length,
      elapsedMs: Date.now() - startedAt,
    },
  };
}

/**
 * Size the context window for a full-script call.
 *
 * The default in resolveConfig is still modest so a wrong model does not
 * allocate 128k of RAM it cannot fill. Once preflight has confirmed the model
 * can hold it, raise the request to leave room for the script and a cast's
 * worth of output.
 */
function withBreakdownBudget(config: OllamaConfig): OllamaConfig {
  // Cap at the breakdown window. Never ask for more than preflight allowed.
  const use = Math.min(config.numCtx, BREAKDOWN_NUM_CTX);
  return {
    ...config,
    numCtx: use,
    promptCharBudget: promptCharBudgetFor(use, BREAKDOWN_OUTPUT_RESERVE),
  };
}

function charBudgetFor(config: OllamaConfig, system: string): number {
  const SCAFFOLD = 600;
  const fromCtx = Math.max(4_000, config.promptCharBudget - system.length - SCAFFOLD);
  return Math.min(fromCtx, BREAKDOWN_CHUNK_CHARS);
}

function chunkDocuments(documents: ExtractedDocument[], chunkChars: number): TextChunk[] {
  const chunks: TextChunk[] = [];
  let pageOffset = 0;

  for (const doc of documents) {
    let current = "";
    let firstPage = pageOffset + 1;

    doc.pages.forEach((page, index) => {
      const pageNumber = pageOffset + index + 1;
      const piece = `=== page ${pageNumber} ===\n${page}`;
      if (current && current.length + piece.length + 2 > chunkChars) {
        chunks.push({
          text: current,
          firstPage,
          lastPage: pageNumber - 1,
          fileName: doc.name,
        });
        current = "";
        firstPage = pageNumber;
      }
      current += `${current ? "\n\n" : ""}${piece}`;
    });

    if (current.trim()) {
      chunks.push({
        text: current,
        firstPage,
        lastPage: pageOffset + doc.pages.length,
        fileName: doc.name,
      });
    }
    pageOffset += doc.pages.length;
  }

  return chunks;
}

/** Merge per-chunk results into one breakdown, deduplicating roles by name. */
function mergeResults(results: AnalysisResult[]): AnalysisResult {
  const merged: AnalysisResult = {
    ...results[0],
    roles: [],
    selfTapeInstructions: [],
    formQuestions: [],
  };

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

function backfillProject(target: Project, source: Project | undefined): void {
  if (!source) return;
  const writable = target as unknown as Record<string, unknown>;
  for (const key of Object.keys(target)) {
    const current = writable[key];
    if (current !== null && current !== "") continue;
    const incoming = (source as unknown as Record<string, unknown>)[key];
    if (incoming) writable[key] = incoming;
  }
}

function union(lists: (string[] | undefined)[]): string[] {
  return [...new Set(lists.flatMap((list) => list ?? []))];
}

function dedupeByRole<T extends { roleName: string }>(items: T[]): T[] {
  const byRole = new Map<string, T>();
  for (const item of items) {
    const key = item.roleName?.toLowerCase().trim();
    if (key && !byRole.has(key)) byRole.set(key, item);
  }
  return [...byRole.values()];
}
