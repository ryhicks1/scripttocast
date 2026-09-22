/**
 * The private breakdown pipeline: several small local calls, assembled here.
 *
 * Why not one call, the way the public path works: the public path hands a
 * whole PDF and a ~100-line prompt to claude-opus-5 and gets one nested object
 * back. Locally the model is llama3.2 — 3B parameters, and served by Ollama
 * with a context window measured in single-digit thousands of tokens. A feature
 * script is ~30,000 tokens. Sending it whole did not overflow loudly; Ollama
 * truncated the prompt and the model answered from a fragment, producing valid
 * JSON with no project name and no roles. That is the bug this replaces.
 *
 * So: nothing here ever sends the script in one piece. The cast list and page
 * numbers come from the screenplay's own formatting rather than the model. The
 * model is asked only for things a 3B model can do — read a title page, write a
 * few sentences about one character from that character's lines — and each call
 * is sized to fit the context window with room to answer.
 *
 * It calls Ollama and nothing else. There is no fallback to a hosted API here,
 * and there must not be one: the point of this path is that the script never
 * leaves the machine.
 */
import {
  normalizeResult,
  PROJECT_TYPES,
  type AnalysisResult,
  type BreakdownMode,
  type FormQuestion,
  type Project,
  type ResolvedMode,
  type Role,
  type SelfTapeInstruction,
} from "../breakdown";
import { findNarrativeVoice } from "../description-quality";
import { defaultFormQuestions, defaultSelfTape } from "./defaults";
import { LocalAnalysisError } from "./errors";
import type { ExtractedDocument } from "./extract";
import { chatJson, type OllamaConfig } from "./ollama";
import {
  CAST_LIST_SYSTEM,
  castListUser,
  DESCRIPTION_SYSTEM,
  descriptionUser,
  PROJECT_SYSTEM,
  projectUser,
  STORY_SYSTEM,
  storyUser,
} from "./prompts";
import {
  assignTiers,
  displayName,
  excerptsFor,
  parseScript,
  SENTENCE_CEILING,
  type ParsedCharacter,
  type ParsedScript,
  type Tier,
} from "./screenplay";

/** Roles described per run. Each one is its own model call. */
const DEFAULT_MAX_ROLES = 40;

/** Commercial descriptions are tighter than film/TV ones — three sentences. */
const COMMERCIAL_SENTENCE_CEILING = 3;

const PROJECT_SCHEMA = {
  type: "object",
  required: ["title", "productionType", "director", "writer", "castingDirector", "location"],
  properties: {
    title: { type: "string" },
    productionType: { type: "string", enum: [...PROJECT_TYPES] },
    director: { type: "string" },
    writer: { type: "string" },
    castingDirector: { type: "string" },
    location: { type: "string" },
  },
} as const;

const STORY_SCHEMA = {
  type: "object",
  required: ["logline", "synopsis"],
  properties: { logline: { type: "string" }, synopsis: { type: "string" } },
} as const;

const DESCRIPTION_SCHEMA = {
  type: "object",
  required: ["gender", "ageRange", "ethnicity", "description", "traits"],
  properties: {
    gender: { type: "string" },
    ageRange: { type: "string" },
    ethnicity: { type: "string" },
    description: { type: "string" },
    traits: { type: "array", items: { type: "string" } },
  },
} as const;

const CAST_LIST_SCHEMA = {
  type: "object",
  required: ["roles"],
  properties: { roles: { type: "array", items: { type: "string" } } },
} as const;

interface ProjectReply {
  title: string;
  productionType: string;
  director: string;
  writer: string;
  castingDirector: string;
  location: string;
}

interface StoryReply {
  logline: string;
  synopsis: string;
}

interface DescriptionReply {
  gender: string;
  ageRange: string;
  ethnicity: string;
  description: string;
  traits: string[];
}

export interface LocalDiagnostics {
  pages: number;
  /** True when cast and page numbers came from screenplay formatting. */
  parsedAsScreenplay: boolean;
  charactersFound: number;
  rolesDescribed: number;
  /** Roles whose description call failed. They are still returned, undescribed. */
  rolesFailed: string[];
  /** Roles found but not described, because the run hit OLLAMA_MAX_ROLES. */
  rolesOmitted: number;
  /** Model calls made, for a sense of what a run costs locally. */
  modelCalls: number;
  /** Descriptions that still tripped the narrative-voice check after trimming. */
  narrativeVoiceFlagged: number;
  elapsedMs: number;
}

export interface LocalAnalysis {
  result: AnalysisResult;
  diagnostics: LocalDiagnostics;
}

type Logger = (message: string, data?: Record<string, unknown>) => void;

export async function analyzeLocally(
  documents: ExtractedDocument[],
  requestedMode: BreakdownMode,
  config: OllamaConfig,
  log: Logger = () => {},
): Promise<LocalAnalysis> {
  const startedAt = Date.now();
  let modelCalls = 0;

  const pages = documents.flatMap((doc) => doc.pages);
  if (!pages.length) throw new LocalAnalysisError("No readable pages in the upload.", 400);

  const script = parseScript(pages);
  const mode: ResolvedMode =
    requestedMode === "film_tv" || requestedMode === "commercial"
      ? requestedMode
      : script.looksLikeScreenplay
        ? "film_tv"
        : "commercial";

  log("local: parsed document", {
    pages: pages.length,
    characters: script.characters.length,
    sceneHeadings: script.sceneHeadings.length,
    parsedAsScreenplay: script.looksLikeScreenplay,
    mode,
  });

  // --- Pass 1: project facts, from the opening pages only. ------------------
  const head = headText(pages, budgetFor(config, PROJECT_SYSTEM, 6000));
  const project = emptyProject();
  try {
    const reply = await chatJson<ProjectReply>(config, {
      system: PROJECT_SYSTEM,
      user: projectUser(documents[0]?.name ?? "script", head),
      schema: PROJECT_SCHEMA,
      label: "project details",
      maxOutputTokens: 400,
    });
    modelCalls++;
    project.name = clean(reply.title) || fallbackTitle(documents[0]?.name);
    project.type = PROJECT_TYPES.includes(reply.productionType as (typeof PROJECT_TYPES)[number])
      ? reply.productionType
      : mode === "commercial"
        ? "commercial"
        : "feature_film";
    project.director = clean(reply.director) || null;
    project.writer = clean(reply.writer) || null;
    project.castingDirector = clean(reply.castingDirector) || null;
    project.location = clean(reply.location) || null;
  } catch (error) {
    // A failure here is recoverable — the title can come from the file name —
    // but it is a strong signal the model or Ollama is misconfigured, so it is
    // rethrown rather than papered over. Every later call would fail the same way.
    log("local: project pass failed", { error: String(error) });
    throw error;
  }

  // --- Pass 2: logline and synopsis, from scene headings only. --------------
  if (script.sceneHeadings.length >= 5) {
    const headings = fitLines(
      script.sceneHeadings.map((h) => `p${h.page} ${h.text}`),
      budgetFor(config, STORY_SYSTEM, 5000),
      140,
    );
    try {
      const reply = await chatJson<StoryReply>(config, {
        system: STORY_SYSTEM,
        user: storyUser(project.name, headings),
        schema: STORY_SCHEMA,
        label: "logline and synopsis",
        maxOutputTokens: 500,
      });
      modelCalls++;
      project.logline = clean(reply.logline) || null;
      project.synopsis = clean(reply.synopsis) || null;
    } catch (error) {
      // Not worth failing the run over: the breakdown is still usable without it.
      log("local: story pass failed", { error: String(error) });
    }
  }

  // --- Roles: from the script's formatting, or from the model if it has none.
  const maxRoles = Number(process.env.OLLAMA_MAX_ROLES) || DEFAULT_MAX_ROLES;
  let allCharacters: ParsedCharacter[];
  if (script.looksLikeScreenplay) {
    allCharacters = script.characters;
  } else {
    const found = await modelCastList(script, config, log);
    modelCalls += found.calls;
    allCharacters = found.characters;
  }
  const totalFound = allCharacters.length;
  const characters = allCharacters.slice(0, maxRoles);
  if (totalFound > characters.length) {
    log("local: more roles found than described", { found: totalFound, described: characters.length });
  }

  if (!characters.length) {
    throw new LocalAnalysisError(
      "No roles could be found in this document. If it is a screenplay, it may be " +
        "a scan without a text layer; if it is a casting brief, it may be too short " +
        "for the local model to read. Nothing was sent anywhere — this ran entirely " +
        "on this machine.",
      422,
    );
  }

  const isScreenplay = script.looksLikeScreenplay;
  const tiers = assignTiers(characters);

  // --- Pass 3: one description per role, from that role's own lines. --------
  const roles: Role[] = [];
  const failed: string[] = [];
  let flagged = 0;

  for (const [index, character] of characters.entries()) {
    // Tiers come from how often a character speaks, which only exists when the
    // document was a screenplay. A casting brief gives no such signal, so the
    // role takes its mode's ordinary tier rather than being ranked on nothing.
    const tier: Tier = tiers.get(character.name) ?? "DAY PLAYER";
    const roleType = isScreenplay ? tier : mode === "commercial" ? "PRINCIPAL" : "SUPPORTING";
    const ceiling = isScreenplay
      ? SENTENCE_CEILING[tier]
      : mode === "commercial"
        ? COMMERCIAL_SENTENCE_CEILING
        : SENTENCE_CEILING.SUPPORTING;
    const name = displayName(character.name);
    const excerpts = excerptsFor(script, character, budgetFor(config, DESCRIPTION_SYSTEM, 2400));

    let reply: DescriptionReply | null = null;
    try {
      reply = await chatJson<DescriptionReply>(config, {
        system: DESCRIPTION_SYSTEM,
        user: descriptionUser(name, ceiling, excerpts),
        schema: DESCRIPTION_SCHEMA,
        label: `role: ${name}`,
        maxOutputTokens: 400,
      });
      modelCalls++;
    } catch (error) {
      failed.push(name);
      log("local: role description failed", { role: name, error: String(error) });
    }

    log("local: role done", { index: index + 1, of: characters.length, role: name });

    const body = reply ? tighten(clean(reply.description), ceiling, log, name) : "";
    if (body && findNarrativeVoice(body).length) flagged++;

    roles.push({
      name,
      description: composeDescription({
        gender: clean(reply?.gender),
        ageRange: clean(reply?.ageRange),
        ethnicity: clean(reply?.ethnicity),
        body,
        roleType,
      }),
      ageRange: clean(reply?.ageRange) || null,
      gender: clean(reply?.gender) || null,
      ethnicity: clean(reply?.ethnicity) || null,
      roleType,
      // Without cue lines there is nothing to infer from, and a cast list on a
      // brief is a list of speaking roles far more often than not.
      speaking: isScreenplay ? character.cues > 0 : true,
      characteristics: (reply?.traits ?? []).map(clean).filter(Boolean).slice(0, 8),
      contentAdvisories: [],
      submissionNotes: [],
      pageNumbers: character.pages,
    });
  }

  if (failed.length === roles.length) {
    throw new LocalAnalysisError(
      `The local model failed on every role (${failed.length} of ${failed.length}). ` +
        `Check that "${config.model}" is working: ollama run ${config.model} "hello".`,
      502,
    );
  }

  const selfTapeInstructions: SelfTapeInstruction[] = roles.map((role) => defaultSelfTape(role.name));
  const formQuestions: FormQuestion[] = roles.map((role) =>
    defaultFormQuestions(role.name, mode, role.contentAdvisories),
  );

  const result = normalizeResult({
    mode,
    project,
    roles,
    selfTapeInstructions,
    formQuestions,
  });

  return {
    result,
    diagnostics: {
      pages: pages.length,
      parsedAsScreenplay: script.looksLikeScreenplay,
      charactersFound: totalFound,
      rolesDescribed: roles.length - failed.length,
      rolesFailed: failed,
      rolesOmitted: Math.max(0, totalFound - roles.length),
      modelCalls,
      narrativeVoiceFlagged: flagged,
      elapsedMs: Date.now() - startedAt,
    },
  };
}

/**
 * Cast list for documents with no screenplay formatting — a casting brief, a
 * commercial board. Chunked so no call exceeds the context window, and names
 * are unioned across chunks.
 */
async function modelCastList(
  script: ParsedScript,
  config: OllamaConfig,
  log: Logger,
): Promise<{ characters: ParsedCharacter[]; calls: number }> {
  const chunkChars = budgetFor(config, CAST_LIST_SYSTEM, 4000);
  const chunks = chunkPages(script.pages, chunkChars);
  const seen = new Map<string, ParsedCharacter>();
  let calls = 0;

  for (const chunk of chunks) {
    try {
      const reply = await chatJson<{ roles: string[] }>(config, {
        system: CAST_LIST_SYSTEM,
        user: castListUser(chunk.text),
        schema: CAST_LIST_SCHEMA,
        label: `cast list (pages ${chunk.firstPage}-${chunk.lastPage})`,
        maxOutputTokens: 400,
      });
      calls++;
      for (const raw of reply.roles ?? []) {
        const name = clean(raw).slice(0, 60);
        if (!name) continue;
        const key = name.toUpperCase();
        const existing = seen.get(key);
        if (existing) {
          if (!existing.pages.includes(chunk.firstPage)) existing.pages.push(chunk.firstPage);
          continue;
        }
        seen.set(key, {
          name: key,
          pages: [chunk.firstPage],
          cues: 0,
          // Without dialogue we have no size signal; everything lands as one tier.
          dialogueChars: 0,
          blocks: [{ page: chunk.firstPage, text: chunk.text.slice(0, 1200) }],
        });
      }
    } catch (error) {
      log("local: cast list chunk failed", { pages: chunk.firstPage, error: String(error) });
    }
  }

  return { characters: [...seen.values()], calls };
}

interface PageChunk {
  text: string;
  firstPage: number;
  lastPage: number;
}

function chunkPages(pages: string[], chunkChars: number): PageChunk[] {
  const chunks: PageChunk[] = [];
  let current = "";
  let firstPage = 1;

  pages.forEach((page, index) => {
    const pageNumber = index + 1;
    if (current && current.length + page.length > chunkChars) {
      chunks.push({ text: current, firstPage, lastPage: pageNumber - 1 });
      current = "";
      firstPage = pageNumber;
    }
    current += `${current ? "\n\n" : ""}${page.slice(0, chunkChars)}`;
  });

  if (current.trim()) chunks.push({ text: current, firstPage, lastPage: pages.length });
  return chunks;
}

/**
 * How much document text one call may carry: what is left of the context window
 * once the system prompt and the call's own scaffolding are paid for.
 *
 * Sized here rather than guessed, because the failure it prevents is invisible:
 * Ollama silently drops whatever does not fit, and the model answers from the
 * remainder. `preflight` guarantees a floor of MIN_NUM_CTX, so this stays
 * positive.
 */
function budgetFor(config: OllamaConfig, system: string, cap: number): number {
  const SCAFFOLD_CHARS = 400;
  return Math.max(600, Math.min(config.promptCharBudget - system.length - SCAFFOLD_CHARS, cap));
}

/** The opening of the document, where the title and credits live. */
function headText(pages: string[], budget: number): string {
  let out = "";
  for (const page of pages) {
    if (out.length >= budget) break;
    out += `${out ? "\n\n" : ""}${page}`;
  }
  return out.slice(0, budget);
}

/** As many lines as fit the budget, evenly sampled so the end is represented. */
function fitLines(lines: string[], budget: number, maxLines: number): string[] {
  const step = Math.max(1, Math.ceil(lines.length / maxLines));
  const sampled = lines.filter((_, index) => index % step === 0);
  const out: string[] = [];
  let used = 0;
  for (const line of sampled) {
    if (used + line.length + 1 > budget) break;
    out.push(line);
    used += line.length + 1;
  }
  return out;
}

/**
 * Enforce the sentence ceiling, and drop sentences written in narrative-summary
 * voice — "in the story", "his journey", "we learn".
 *
 * The public prompt bans these constructions in prose and a frontier model
 * complies. A 3B model does not, reliably, so the rule is applied here instead
 * of asked for. At least one sentence always survives: a thin description beats
 * an empty one, and the count of what still trips the check is reported in
 * diagnostics rather than hidden.
 */
export function tighten(
  description: string,
  maxSentences: number,
  log: Logger = () => {},
  roleName = "",
): string {
  if (!description) return "";
  const sentences = description
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const kept: string[] = [];
  const dropped: string[] = [];
  for (const sentence of sentences) {
    if (kept.length >= maxSentences) break;
    if (findNarrativeVoice(sentence).length && kept.length) {
      dropped.push(sentence);
      continue;
    }
    kept.push(sentence);
  }
  if (!kept.length && sentences.length) kept.push(sentences[0]);
  if (dropped.length) log("local: dropped narrative-voice sentences", { roleName, dropped });

  return kept.join(" ");
}

/**
 * The canonical breakdown line, assembled here rather than asked for:
 *
 *   [GENDER], [AGE RANGE], [ETHNIC BACKGROUND]. [DESCRIPTION]...[ROLE TYPE]
 *
 * Built from separate fields, the format is exact every time. Asked for from a
 * 3B model, it is exact about half the time.
 */
export function composeDescription({
  gender,
  ageRange,
  ethnicity,
  body,
  roleType,
}: {
  gender: string;
  ageRange: string;
  ethnicity: string;
  body: string;
  roleType: string;
}): string {
  const lead = [gender, ageRange, ethnicity].filter(Boolean).join(", ");
  const head = lead ? `${lead}.` : "";
  const prose = body.trim();
  const core = [head, prose].filter(Boolean).join(" ").trim();
  if (!core) return roleType;
  return `${core.replace(/[.\s]+$/, "")}...${roleType}`;
}

function clean(value: string | undefined | null): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function fallbackTitle(fileName: string | undefined): string {
  if (!fileName) return "Untitled";
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Untitled";
}

function emptyProject(): Project {
  return {
    name: "Untitled",
    brand: "",
    type: "feature_film",
    logline: null,
    synopsis: null,
    location: null,
    deadline: null,
    director: null,
    writer: null,
    producers: null,
    castingDirector: null,
    union: null,
    rate: null,
    auditionDates: null,
    callbackDates: null,
    shootDates: null,
    productionDates: null,
    contentAdvisories: [],
    submissionNotes: [],
  };
}
