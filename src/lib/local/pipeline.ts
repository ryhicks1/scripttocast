/**
 * The private breakdown pipeline: several small local calls, assembled here.
 *
 * Why not one call, the way the public path works: the public path hands a
 * whole PDF and a ~100-line prompt to claude-opus-5 and gets one nested object
 * back. Locally the model is llama3.1:8b by default, served by Ollama
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
import { appendFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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
import type { Locale } from "../locale";
import { defaultFormQuestions, defaultSelfTape } from "./defaults";
import { buildSystemPrompt } from "../prompts";
import { LocalAnalysisError } from "./errors";
import type { ExtractedDocument } from "./extract";
import {
  chatJson,
  contextFor,
  kvCacheBytes,
  promptCharBudgetFor,
  type OllamaConfig,
} from "./ollama";
import { findBookVoice, findEssayVoice, findRepeatedPhrases, stripEssayClauses } from "./style";
import {
  CAST_LIST_SYSTEM,
  castListUser,
  descriptionUser,
  PROJECT_SYSTEM,
  projectUser,
  STORY_SYSTEM,
  storyUser,
} from "./prompts";
import {
  assignTiers,
  displayName,
  buildEvidence,
  parseScript,
  roleTypeLabel,
  DESCRIPTION_BUDGET,
  type ParsedCharacter,
  type ParsedScript,
  type Tier,
} from "./screenplay";

/**
 * Debug dump of the script excerpts handed to the model. Off unless asked for.
 *
 * It was on by default for a while, which quietly weakened the one property
 * this path is sold on: with it on, a file of script text sits in the temp
 * folder after every run. The product's promise is that a confidential script
 * stays in memory on this machine, so the default has to match the promise,
 * and anyone diagnosing a bad run can turn it on for that run.
 *
 * Outside the project folder either way: `next dev` watches that directory, and
 * appending to a file in it forty times during one request restarts the server
 * and drops the connection the browser is waiting on.
 */
const EVIDENCE_FILE = join(tmpdir(), "scripttocast-evidence.txt");
const EVIDENCE_ENABLED = Boolean(process.env.LOCAL_DEBUG_EVIDENCE);

/**
 * Roles described per run. Each one is its own model call.
 *
 * Was 40, which a Dune script hit exactly — a larger ensemble would have lost
 * the difference silently, and a breakdown missing roles is worse than a slow
 * one. At roughly ten seconds a role this is twenty minutes at the ceiling,
 * which the progress display now makes bearable. Anything still cut is
 * reported on the page rather than only in diagnostics.
 */
const DEFAULT_MAX_ROLES = 120;

/**
 * Upper bound on the per-role ask: the length hint, the list of openings
 * already spent on other roles, and a retry correction if one is needed. The
 * script dwarfs it, so being generous here costs nothing and being wrong about
 * it rejects every call.
 */
const MAX_ROLE_USER_CHARS = 4_000;

/** Below this a description is treated as empty: asked again, then reported. */
const MIN_DESCRIPTION_WORDS = 5;

/**
 * How many roles must come back described before the run is trusted to
 * continue. Two, because the first also absorbs the cold prefill and the
 * second is the first to run from the cache — a failure in either is a
 * failure of the whole design, not of one character.
 */
const FAIL_FAST_ROLES = 2;

/**
 * Below this, the first call is too quick for the cache comparison to mean
 * anything — a short script, or a machine fast enough not to care.
 */
const CACHE_CHECK_MIN_MS = 60_000;

/**
 * Ceiling for one role call, generous enough to include a cold prefill.
 *
 * Only the first call should ever need most of it. If every role is taking
 * this long, the prompt cache is not being reused and something has made the
 * system prompt vary between calls — which the check suite asserts against.
 */
const ROLE_TIMEOUT_MS = 1_800_000;

/**
 * The longest script this path will read in one pass.
 *
 * llama3.1:8b offers 128k. This stops short of it because Ollama allocates the
 * key/value cache up front — at 128 KiB per token, 96k tokens is about twelve
 * gigabytes on top of the weights, and past that a laptop starts swapping and
 * the run stops being worth waiting for.
 */
const MAX_ROLE_CTX = 98_304;

/** Commercial descriptions are tighter than film/TV ones. */
const COMMERCIAL_BUDGET = 420;

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
  /** Descriptions that still trip a style check after trimming. */
  narrativeVoiceFlagged: number;
  /** Phrases reused across roles — the tell that the model ran out of evidence. */
  repeatedPhrases: string[];
  /** Roles that first answered with prompt text and had to be regenerated. */
  rolesCopiedPrompt: string[];
  /** Ethnicity claims dropped because the script did not state them. */
  unsupportedEthnicityDropped: number;
  /** Age claims dropped because the script gave nothing to base them on. */
  unsupportedAgeDropped: number;
  /** Descriptions left with almost nothing — the sign that evidence was thin. */
  rolesThin: string[];
  /** True when PDF margins were used to tell dialogue from action. */
  usedLayout: boolean;
  /** The document page numbers refer to — the file sides are cut from. */
  pagesFrom: string;
  /** Where the evidence dump was written, or null when it is off (the default). */
  evidenceFile: string | null;
  elapsedMs: number;
}

export interface LocalAnalysis {
  result: AnalysisResult;
  diagnostics: LocalDiagnostics;
}

type Logger = (message: string, data?: Record<string, unknown>) => void;

/**
 * Real progress, reported as the work happens.
 *
 * The page used to animate a scripted list of steps that reached 95% in ninety
 * seconds and then sat there — for most of the run, on a feature script, the
 * only honest thing on screen was that it had not crashed. Describing roles is
 * where nearly all the time goes and it is countable, so it is counted.
 */
export interface LocalProgress {
  phase: "project" | "story" | "cast" | "roles" | "assembling";
  message: string;
  /** Roles finished and roles to do, during the phase that takes the time. */
  done?: number;
  total?: number;
}

type ProgressReporter = (progress: LocalProgress) => void;

export async function analyzeLocally(
  documents: ExtractedDocument[],
  requestedMode: BreakdownMode,
  config: OllamaConfig,
  log: Logger = () => {},
  onProgress: ProgressReporter = () => {},
  locale: Locale = "us",
): Promise<LocalAnalysis> {
  const startedAt = Date.now();
  let modelCalls = 0;

  if (EVIDENCE_ENABLED) {
    try {
      writeFileSync(EVIDENCE_FILE, `evidence handed to ${config.model}, ${new Date().toISOString()}\n`, "utf8");
    } catch {
      // Not fatal — see recordEvidence.
    }
  }

  // Page numbers belong to ONE document: the first PDF, which is the file
  // "Generate Sides" cuts from.
  //
  // Concatenating every upload numbered them continuously, so a three-page
  // self-tape brief uploaded ahead of a script shifted every page in it by
  // three — and the sides came out three pages off, with nothing on screen to
  // say so. Secondary documents still inform the project details; they just do
  // not move the numbering.
  const primary =
    documents.find((doc) => doc.kind === "pdf") ?? documents[0];
  const pages = documents.flatMap((doc) => doc.pages);
  if (!pages.length) throw new LocalAnalysisError("No readable pages in the upload.", 400);

  const script = parseScript(primary.pageLines);
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
  onProgress({ phase: "project", message: "Reading the title page" });
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
    onProgress({ phase: "story", message: "Writing the logline and synopsis" });
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
  const omitted = Math.max(0, totalFound - Math.min(totalFound, maxRoles));
  onProgress({
    phase: "cast",
    message: `Found ${totalFound} character${totalFound === 1 ? "" : "s"} in the script`,
  });
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

  // --- The model reads the script. All of it. Once. ------------------------
  //
  // Three designs have now been tried here. A packet of extracted lines per
  // role produced descriptions written from six lines of blocking. Splitting
  // the script into fourteen-thousand-character chunks and asking for a whole
  // breakdown from each produced a run that could not finish: twelve chunks
  // each re-emitting the project, logline, synopsis, self-tape instructions
  // and form questions is forty thousand output tokens, and output is the slow
  // half of local inference. Reading is the cheap half.
  //
  // So the script goes in the system message, whole, and stays byte-identical
  // across every call. llama.cpp reuses the cached attention state for the
  // longest matching prefix, so the script is read on the first role and
  // reused on all the rest; keep_alive holds that cache between calls. Each
  // role then costs only what it writes — a couple of hundred tokens instead
  // of thirty-five hundred.
  //
  // The style addendum is gone. It told an 8B model to write fragments and
  // stop early, and that is why leads came back four words long while the
  // house prompt it was appended to allows a lead about a hundred and ten.
  const scriptText = documents
    .map((doc) => `=== ${doc.name} ===\n${doc.pages.join("\n")}`)
    .join("\n\n");
  // Split deliberately. The guard below asks whether the model copied its
  // instructions, and it must never be handed the script to check against:
  // a description IS supposed to reuse the script's words, and with a quarter
  // of a million characters of English prose as the haystack even innocent
  // phrasing collides on a six-word run by chance. Handing it the whole system
  // prompt flagged all twenty-four roles as copied, retried them, flagged them
  // again and discarded every one — a breakdown of empty cards.
  const descriptionInstructions =
    `${buildSystemPrompt(mode, locale)}\n\n` +
    `────────────────────────────────────────\n` +
    `You are writing ONE role's entry at a time. The full script is above. ` +
    `Read it and answer about the character named in the request, using ` +
    `everything the script shows of them across all of its pages.\n\n` +
    `Return only that character's fields: gender, ageRange, ethnicity, ` +
    `description and traits. No project, no roles array, no self-tape, no form ` +
    `questions. Write only the [ROLE DESCRIPTION] part — gender, age and ` +
    `ethnicity are printed for you from their own fields, so do not repeat ` +
    `them in the prose and do not write the trailing role type.`;
  // Script first, instructions after it. The other order put the house prompt's
  // field definitions fifty thousand tokens before the point of generation,
  // with nothing but screenplay in between — and under a JSON grammar at
  // temperature zero, an 8B model that has lost track of what each field is
  // for emits the smallest object the grammar allows: every string empty.
  // That is a breakdown of cards reading "LEAD". Long-context models answer
  // best with the document first and the question last, next to the answer.
  //
  // Still byte-identical on every call, so the prefix cache holds. The script
  // being first actually helps it: it is the longest stable run in the prompt.
  const descriptionSystem =
    `THE SCRIPT:\n${scriptText}\n\n` +
    `════════════════════ END OF SCRIPT ════════════════════\n\n` +
    descriptionInstructions;

  // Size the window to the script, and refuse rather than truncate. Ollama
  // drops anything past num_ctx without saying so, and a breakdown written
  // from a silently halved script is the failure that looks most like success.
  // Size from the LONGEST user message this loop can produce, not a guess at a
  // typical one. The ask grows: eight already-used openings are appended to
  // discourage repetition, and a retry adds a correction on top. Sizing for
  // 1200 characters of it was the second half of the 845-character overrun.
  const roleCtx = contextFor(descriptionSystem.length + MAX_ROLE_USER_CHARS);
  const ceiling = Math.min(MAX_ROLE_CTX, config.modelContextLimit || MAX_ROLE_CTX);
  if (roleCtx > ceiling) {
    throw new LocalAnalysisError(
      `This script needs about ${Math.ceil(roleCtx / 1024)}k tokens of context to be read ` +
        `in one pass, and the ceiling here is ${Math.ceil(ceiling / 1024)}k ` +
        `(${config.modelContextLimit ? `"${config.model}" reports ${Math.ceil(config.modelContextLimit / 1024)}k` : "set by memory, not the model"}). ` +
        `This path will not split it into pieces small enough to distort the result. ` +
        `Split the PDF and run the parts separately.`,
      413,
    );
  }
  const roleConfig: OllamaConfig = {
    ...config,
    numCtx: roleCtx,
    promptCharBudget: promptCharBudgetFor(roleCtx),
  };
  log("local: whole-script context", {
    scriptChars: scriptText.length,
    numCtx: roleCtx,
    kvCacheGiB: Number((kvCacheBytes(roleCtx) / 1024 ** 3).toFixed(1)),
  });

  // --- Pass 3: one description per role, from that role's own lines. --------
  const roles: Role[] = [];
  const failed: string[] = [];
  // Kept so a run that fails everywhere can say WHY. It used to report only
  // that every role failed and suggest checking that Ollama worked, which is
  // the one thing that was never wrong.
  let firstFailure: unknown = null;
  // Roles whose FIRST answer had no description, and the first such reply
  // verbatim — the one thing every previous empty run lacked was what the
  // model actually said.
  const emptyFirst: string[] = [];
  // Wall-clock per model call, in order. The first includes loading the model
  // at this context size and reading the whole script; every later one should
  // cost only what it writes. The ratio between them is the whole design
  // working or not, and it is measurable two roles in.
  const callTimes: number[] = [];
  let firstEmptyReply = "";
  const emptyBecause = { failed: [] as string[], modelEmpty: [] as string[], discarded: [] as string[] };
  // What the copied-prompt guard checks against: the instructions and the
  // fixed part of the ask. Never the script — a description is supposed to
  // reuse the script's words.
  const guardText = (name: string) => `${descriptionInstructions}\n${descriptionUser(name, "")}`;
  const leaked: string[] = [];
  // Openings spent so far, fed into each subsequent prompt.
  const usedOpenings: string[] = [];
  const thin: string[] = [];
  const castNames = characters.map((c) => displayName(c.name));
  let flagged = 0;
  let unsupportedEthnicity = 0;
  let unsupportedAge = 0;

  for (const [index, character] of characters.entries()) {
    onProgress({
      phase: "roles",
      message: `Describing ${displayName(character.name)}`,
      done: index,
      total: characters.length,
    });
    // Tiers come from how often a character speaks, which only exists when the
    // document was a screenplay. A casting brief gives no such signal, so the
    // role takes its mode's ordinary tier rather than being ranked on nothing.
    const tier: Tier = tiers.get(character.name) ?? "DAY PLAYER";
    const roleType = isScreenplay
      ? roleTypeLabel(tier, locale)
      : mode === "commercial"
        ? "PRINCIPAL"
        : "SUPPORTING";
    const budget = isScreenplay
      ? DESCRIPTION_BUDGET[tier]
      : mode === "commercial"
        ? COMMERCIAL_BUDGET
        : DESCRIPTION_BUDGET.SUPPORTING;
    // Length, described rather than numbered. The budget is enforced in code
    // afterwards; a model handed a number writes to it whatever it has to say.
    // How long, in the terms that actually get length out of an 8B model.
    //
    // This said "a few fragments" and "a line or two", on every call, as the
    // last instruction before the answer — which makes it the most influential
    // line in the prompt, whatever the house prompt a hundred lines earlier
    // allows. It survived the deletion of the fragments addendum because it
    // lived here instead, and it is why leads kept coming back four words
    // long. The numbers are the corpus medians: 84 words for a lead, 61 for a
    // supporting role, 44 for a day player.
    const lengthHint =
      budget <= 400
        ? "Two or three sentences, around forty words."
        : budget >= 650
          ? "Four to six sentences, around eighty to a hundred words."
          : "Three or four sentences, around sixty words.";
    const name = displayName(character.name);
    const evidence = buildEvidence(script, character, 2400);

    // Off unless LOCAL_DEBUG_EVIDENCE is set — see EVIDENCE_FILE above. The
    // comment that stood here claimed the opposite ("always written, to the
    // project folder"), which is the privacy promise this path is sold on read
    // backwards.
    //
    // Every bad description in this project has been the model faithfully
    // reporting bad evidence, so reading the evidence back is the fastest way
    // to diagnose a run — but it does not have to cost a run to do it:
    // `npm run evidence:local -- script.pdf` prints the same blocks from the
    // same code with no model involved.
    recordEvidence(name, roleType, evidence.text);

    // The evidence packet is no longer sent — the model has the whole script.
    // It is still built, because it is the only thing that can CHECK a claim:
    // the gates below refuse an age or an ethnicity the script never stated,
    // and those gates need the script's own words about this person. The
    // parser went from being the model's eyes to being its proofreader.
    // The correction rides in the USER message, never the system one.
    // Appending it to the system prompt — which is what this did — changes the
    // cached prefix, so that one retry re-reads the entire script from scratch
    // instead of reusing the attention state every other role shares. The
    // check suite asserts every role call sends one identical system prompt
    // for exactly this reason, and it caught this the first time it ran.
    const askFor = async (correction = "") => {
      const callStarted = Date.now();
      try {
        return await askOnce(correction);
      } finally {
        callTimes.push(Date.now() - callStarted);
      }
    };
    const askOnce = async (correction: string) =>
      chatJson<DescriptionReply>(roleConfig, {
        system: descriptionSystem,
        user: `${descriptionUser(name, lengthHint, usedOpenings)}${correction}`,
        schema: DESCRIPTION_SCHEMA,
        label: `role: ${name}`,
        maxOutputTokens: 400,
        // The first role pays to read the whole script; the rest reuse that
        // work. Three minutes — the default — is not enough to prefill a
        // feature on a laptop, and when the first call times out nothing is
        // cached, so every role after it re-reads the script and times out
        // too. That is what "failed on every role" was.
        timeoutMs: ROLE_TIMEOUT_MS,
      });

    let reply: DescriptionReply | null = null;
    try {
      reply = await askFor();
      modelCalls++;

      // The house prompt's worked examples are vivid, and a model short of
      // evidence hands one back as the character. Retry saying so outright
      // rather than discarding the role.
      // An empty description is asked for once more, with the reason stated.
      // It costs one short call — the script is already cached — and the
      // alternative is a card that reads "LEAD" and nothing else.
      if (wordCount(clean(reply.description)) < MIN_DESCRIPTION_WORDS) {
        log("local: empty description, asking again", { role: name, reply });
        emptyFirst.push(name);
        if (!firstEmptyReply) firstEmptyReply = JSON.stringify(reply).slice(0, 400);
        reply = await askFor(
          `\n\nYour previous answer left the description empty. The description is ` +
            `the one field that matters: write it now, about ${name}, from the script above.`,
        );
        modelCalls++;
      }

      if (sharesWording(clean(reply.description), guardText(name))) {
        log("local: description copied the prompt, retrying", { role: name });
        leaked.push(name);
        reply = await askFor(
          `\n\nYour previous answer copied wording from the instructions above. ` +
            `Those are other people. Describe ONLY ${name}, as the script shows them, ` +
            `using words that appear nowhere in the instructions.`,
        );
        modelCalls++;
      }
    } catch (error) {
      failed.push(name);
      if (!firstFailure) firstFailure = error;
      log("local: role description failed", { role: name, error: String(error) });
    }

    // Is the script being read once, or once per role? Two roles in, the
    // numbers say. A cached call writes a couple of hundred tokens against
    // attention state that already exists; an uncached one re-reads the whole
    // screenplay first and takes as long as the cold call did. If that is what
    // is happening, the run would take an hour — so stop now and say so,
    // instead of letting the person find out an hour from now.
    const warm = callTimes.slice(1);
    if (
      index === 1 &&
      warm.length &&
      callTimes[0] > CACHE_CHECK_MIN_MS &&
      median(warm) > callTimes[0] * 0.6
    ) {
      const total = Math.round(((callTimes[0] * characters.length) / 60_000) * 10) / 10;
      throw new LocalAnalysisError(
        `Stopped after two roles: the script is being re-read for every role instead of ` +
          `read once and reused. The first role took ${seconds(callTimes[0])} (that one ` +
          `includes reading the whole script) and the next took ${seconds(median(warm))}; ` +
          `it should take a small fraction of the first. At this rate ${characters.length} ` +
          `roles would take about ${total} minutes. Usually this is Ollama unloading the ` +
          `model between calls, or running more than one request slot — start it with ` +
          `OLLAMA_NUM_PARALLEL=1 ollama serve and try again.`,
        503,
      );
    }
    const remaining = characters.length - (index + 1);
    const eta =
      warm.length && remaining > 0
        ? ` — about ${Math.max(1, Math.round((median(warm) * remaining * 1.1) / 60_000))} min left`
        : "";

    log("local: role done", { index: index + 1, of: characters.length, role: name, callTimes });
    onProgress({
      phase: "roles",
      message: `Described ${name}${eta}`,
      done: index + 1,
      total: characters.length,
    });

    let body = reply
      ? stripBlocking(
          tightenDescription(stripEssayClauses(clean(reply.description)), budget, log, name),
        )
      : "";

    // Last resort: a retry that copied the prompt too is discarded outright.
    // Text lifted from instructions is a fabrication about a real person.
    if (body && sharesWording(body, guardText(name))) {
      log("local: description still copied the prompt, discarded", { role: name, body });
      body = "";
    }

    // Ethnicity only where the script says so. The model claimed a lead was
    // Japanese because he shares scenes with a Japanese character; a wrong
    // ethnic background on a breakdown is worse than a blank one.
    // Gender comes back blank a lot now that the model is told to state only
    // what the evidence supports — and a breakdown without it is much less
    // useful, since real ones state it 93% of the time. The script's own
    // pronouns are evidence, so read them rather than dropping the field.
    const gender = normalizeGender(clean(reply?.gender) || genderFromPronouns(evidence.identity));
    const ethnicity = statedIn(evidence.identity, clean(reply?.ethnicity));

    // Age, only where the script gives something to base it on.
    //
    // A Dune run put Paul's father at 20 to 30. Nothing in the evidence said
    // so; the model filled the field because the field was there. A wrong age
    // range is worse than a blank one — it is the first thing an agent filters
    // on, so it decides who is never submitted.
    const claimedAge = normalizeAgeRange(clean(reply?.ageRange));
    const ageRange = hasAgeEvidence(evidence.identity) ? claimedAge : "";
    if (claimedAge && !ageRange) {
      log("local: dropped unsupported age", { role: name, claimed: claimedAge });
      unsupportedAge++;
    }
    if (reply?.ethnicity && !ethnicity) {
      log("local: dropped unsupported ethnicity", { role: name, claimed: reply.ethnicity });
      unsupportedEthnicity++;
    }

    // Why a card has no prose, so a run full of them can say which it was.
    if (!body) {
      if (!reply) emptyBecause.failed.push(name);
      else if (wordCount(clean(reply.description)) < MIN_DESCRIPTION_WORDS) {
        emptyBecause.modelEmpty.push(name);
        if (!firstEmptyReply) firstEmptyReply = JSON.stringify(reply).slice(0, 400);
      } else emptyBecause.discarded.push(name);
    }

    // Fail fast. The first role pays for reading the script — a few minutes —
    // and everything after it is cheap. If the first roles come back empty
    // even after being asked twice, the next thirty-eight will too, and the
    // old behaviour was to grind through all of them for an hour and then
    // print a breakdown of blank cards. Stop here and say why, in minutes.
    if (index < FAIL_FAST_ROLES && !body) {
      throw new LocalAnalysisError(
        `Stopped after ${index + 1} role${index ? "s" : ""} rather than spend the next hour ` +
          `producing empty cards: ${name} came back with no description. ` +
          emptyReason(emptyBecause, firstFailure, firstEmptyReply) +
          ` Nothing was sent anywhere; this ran entirely on this machine.`,
        502,
        firstEmptyReply || (firstFailure ? String(firstFailure) : ""),
      );
    }

    body = withoutOtherCharacters(body, name, castNames);
    body = stripDemographicEcho(body, { gender, ageRange, ethnicity });
    // Under about eight words there is nothing an agent can act on. Worth
    // counting: a run full of these means the evidence is the problem, not the
    // wording, and local-evidence.txt is where to look.
    if (body.split(/\s+/).filter(Boolean).length < 8) thin.push(name);

    const opening = openingOf(body);
    if (opening) {
      // Keep the list short: a long ban list crowds out the evidence, and the
      // openings that matter are the ones just used.
      usedOpenings.push(opening);
      if (usedOpenings.length > 8) usedOpenings.shift();
    }
    if (
      body &&
      (findNarrativeVoice(body).length || findBookVoice(body).length || findEssayVoice(body).length)
    ) {
      flagged++;
    }


    roles.push({
      name,
      description: composeDescription({
        gender,
        ageRange,
        ethnicity,
        body,
        roleType,
      }),
      ageRange: ageRange || null,
      gender: gender || null,
      ethnicity: ethnicity || null,
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

  const blank =
    emptyBecause.failed.length + emptyBecause.modelEmpty.length + emptyBecause.discarded.length;
  if (blank && blank >= Math.ceil(roles.length / 4) && failed.length !== roles.length) {
    throw new LocalAnalysisError(
      `${blank} of ${roles.length} roles came back with no description, so this is not ` +
        `returned as a finished breakdown. ` +
        emptyReason(emptyBecause, firstFailure, firstEmptyReply),
      502,
      firstEmptyReply || (firstFailure ? String(firstFailure) : ""),
    );
  }

  if (failed.length === roles.length) {
    // Report the cause, not the symptom. This used to say only that every role
    // failed and suggest checking that Ollama ran — which sent people to test
    // the one component that was working, while the real error (a timeout, a
    // context that would not allocate) sat in the terminal log unread.
    const cause = firstFailure ? String(firstFailure) : "";
    throw new LocalAnalysisError(
      `The local model failed on every role (${failed.length} of ${failed.length}).` +
        (cause ? ` The first failure was: ${cause}` : "") +
        ` The script needed ${Math.ceil(roleCtx / 1024)}k tokens of context ` +
        `(~${(kvCacheBytes(roleCtx) / 1024 ** 3).toFixed(1)} GiB of memory reserved by Ollama). ` +
        `If that is more than this machine has free, Ollama cannot allocate it and every ` +
        `call fails the same way — set OLLAMA_KV_CACHE_TYPE=q8_0 to halve it, or split the PDF.`,
      502,
      cause,
    );
  }

  onProgress({ phase: "assembling", message: "Putting the breakdown together" });

  const repeatedPhrases = findRepeatedPhrases(roles.map((role) => role.description)).slice(0, 8);
  if (repeatedPhrases.length) {
    log("local: stock phrases reused across roles", { repeatedPhrases });
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
      rolesOmitted: omitted,
      modelCalls,
      narrativeVoiceFlagged: flagged,
      repeatedPhrases,
      rolesCopiedPrompt: leaked,
      unsupportedEthnicityDropped: unsupportedEthnicity,
      unsupportedAgeDropped: unsupportedAge,
      rolesThin: thin,
      usedLayout: script.usedLayout,
      pagesFrom: primary.name,
      evidenceFile: EVIDENCE_ENABLED ? EVIDENCE_FILE : null,
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

/**
 * Drop sentences that narrate the moment instead of the person.
 *
 * An introduction often does both: "Lady Jessica, 35, sits a table and looks
 * out at the valley." The age and the title are the role. Sitting and looking
 * are the scene, and a small model copies them straight onto the card.
 */
const BLOCKING_SENTENCE =
  /\b(sits|wakes up|wakes|stares|staring|looking out|looks out|walks|crosses|shrugs|lunges|picks up)\b/i;

function stripBlocking(description: string): string {
  if (!description) return "";
  const sentences = description
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const kept = sentences.filter((sentence) => !BLOCKING_SENTENCE.test(sentence));
  return (kept.length ? kept : sentences.slice(0, 1)).join(" ");
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
 * Enforce the sentence ceiling and drop sentences written in plot-summary or
 * book voice.
 *
 * The ceiling is a cap, not an instruction: the model is never told the number
 * (see prompts.ts). A 3B model handed "at most 5 sentences" writes exactly
 * five, padding to reach it, which is how a LEAD came back as five sentences of
 * atmosphere. It is asked for two or three instead, and this trims the rest.
 *
 * At least one sentence always survives. A thin description beats an empty one,
 * and a role whose every sentence trips a filter is worth seeing rather than
 * blanking.
 */
export function tightenDescription(
  description: string,
  maxSentences: number,
  log: Logger = () => {},
  roleName = "",
): string {
  if (!description) return "";

  const sentences = description
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const flagged = (sentence: string) => [
    ...findNarrativeVoice(sentence),
    ...findBookVoice(sentence),
  ];

  const kept: string[] = [];
  const dropped: { sentence: string; why: string[] }[] = [];
  for (const sentence of sentences) {
    const hits = flagged(sentence);
    if (hits.length) dropped.push({ sentence, why: hits });
    else kept.push(sentence);
  }

  // Everything tripped a filter — keep the opening line rather than nothing.
  const surviving = kept.length ? kept : sentences.slice(0, 1);
  if (dropped.length) log("local: dropped sentences", { roleName, dropped });

  return surviving.slice(0, maxSentences).join(" ");
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

/**
 * Append one role's evidence to the debug dump.
 *
 * This is the one place the script's own words touch disk. It is the user's own
 * temp folder, never a server or a bucket, and it is overwritten at the start of
 * every run — but it is still the script, so it is worth deleting when you are
 * done. The path is reported in diagnostics so it can be found.
 */
function recordEvidence(name: string, roleType: string, evidence: string): void {
  if (!EVIDENCE_ENABLED) return;
  try {
    appendFileSync(
      EVIDENCE_FILE,
      `\n===== ${name} (${roleType}) =====\n${evidence}\n`,
      "utf8",
    );
  } catch {
    // A read-only checkout is not a reason to fail an analysis.
  }
}

/**
 * Does the evidence actually state this? Used for ethnicity, where a wrong
 * answer is worse than none: the claim has to appear in the script's own words
 * about this character, not be inferred from anything around them.
 */
/**
 * Age as the trade writes it: "35 to 40 years old", "30s", "mid 50s to early
 * 60s". A model asked for an age range returns "35-40", "35", or "young", and
 * the last of those is not an age range at all — a breakdown that says "young"
 * under AGE tells an agent nothing, so it is dropped rather than printed.
 */
function normalizeAgeRange(raw: string): string {
  if (!raw) return "";
  const value = raw.trim();
  // Decade forms and anything already written out are left alone.
  if (/\d0s\b/.test(value) || /years old/i.test(value) || /\bish\b/.test(value)) return value;

  const range = /^(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})$/.exec(value);
  if (range) return `${range[1]} to ${range[2]} years old`;

  const single = /^(\d{1,2})\+?$/.exec(value);
  if (single) return `${single[1]} years old`;

  // No digits at all: "young", "adult", "middle aged" — not an age range.
  if (!/\d/.test(value)) return "";
  return value;
}

/** "male" -> "Male". The corpus uses both Man/Woman and Male/Female. */
function normalizeGender(raw: string): string {
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Drop a demographic opener from the prose that the composed line already says.
 *
 * The canonical line is assembled from the separate fields, so a model that
 * also opens its prose with "A 35-year-old man" or "Japanese man" produces
 * "male, 35-40. A 35-year-old man..." and "Japanese. Japanese man...". Both
 * appeared in a real run. The prompt now asks it not to; this is the backstop,
 * because the prompt asking has never been enough on its own.
 */
function stripDemographicEcho(
  body: string,
  head: { gender: string; ageRange: string; ethnicity: string },
): string {
  if (!body) return body;

  const ethnicityWord = head.ethnicity.split(/[\s,/]+/)[0]?.toLowerCase() ?? "";
  const ethnicityPart = ethnicityWord.length > 3 ? `(?:${ethnicityWord}\\s+)?` : "";
  const pattern = new RegExp(
    `^(?:a|an|the)?\\s*` +
      `(?:\\d{1,2}\\s*(?:-|–|to)\\s*\\d{1,2}[-\\s]*)?` +
      `(?:\\d{1,2}[-\\s]?year[-\\s]?old\\s*)?` +
      ethnicityPart +
      `(?:man|woman|male|female|guy|girl|person|individual)\\b[,.\\s]*`,
    "i",
  );

  const stripped = body.replace(pattern, "").trim();
  // Only accept the strip if something substantive survives it.
  if (stripped.split(/\s+/).filter(Boolean).length < 4) return body;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/**
 * Does the evidence carry any age signal at all?
 *
 * Deliberately loose — a bare number, a decade, a life stage. The model is
 * allowed to turn "late forties" into "45 to 55 years old", which is the sort
 * of reading a casting director would also make. What it may not do is produce
 * an age range from a script that never indicated one.
 */
function hasAgeEvidence(identityEvidence: string): boolean {
  // "Old man" is an insult, not an age. Bare young/old used to unlock a range
  // the model then invented — a father came back 20 to 30.
  return /\b(\d{1,2}\s*(?:-|to)\s*\d{1,2}|,\s*\d{1,2}\b|\d{1,2}\s*,|\d{1,2}s\b|teen|twenties|thirties|forties|fifties|sixties|seventies|elderly|middle[- ]aged|infant|adolescent|senior|veteran of|retired|years?\s+old|year[- ]old)\b/i.test(
    identityEvidence,
  );
}

function genderFromPronouns(identityEvidence: string): string {
  const he = (identityEvidence.match(/\b(he|him|his)\b/gi) ?? []).length;
  const she = (identityEvidence.match(/\b(she|her|hers)\b/gi) ?? []).length;
  if (he >= 2 && he > she * 2) return "Man";
  if (she >= 2 && she > he * 2) return "Woman";
  return "";
}

function statedIn(identityEvidence: string, claim: string): string {
  if (!claim) return "";
  const haystack = identityEvidence.toLowerCase();
  const words = claim.toLowerCase().split(/[\s,/]+/).filter((w) => w.length > 3);
  if (!words.length) return "";
  return words.some((word) => haystack.includes(word)) ? claim : "";
}

const normalise = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/**
 * Phrases the prompt puts in quotation marks.
 *
 * Every leak so far has come from one. Worked examples became two characters'
 * whole descriptions; later, an illustration of physicality — two words long —
 * landed on three separate roles in the same breakdown. The six-word rule below
 * cannot catch a two-word phrase, and lowering it to two words would reject
 * ordinary English.
 *
 * Quotation marks are the signal: inside this prompt they always mark an
 * example of how to write, never a fact about anyone's character. So they are
 * pulled out and matched exactly. All-caps quotes are skipped — those are trade
 * vocabulary and submission notes, which a breakdown is supposed to contain.
 */
function quotedExamples(prompt: string): string[] {
  const quotes = prompt.match(/"[^"\n]{4,80}"/g) ?? [];
  return quotes
    .map((q) => q.slice(1, -1).trim())
    .filter((q) => q !== q.toUpperCase())
    .map((q) => normalise(q).join(" "))
    .filter((q) => q.split(" ").length >= 2);
}

/** Six consecutive words in common — enough to call it copied, not coincidence. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function seconds(ms: number): string {
  return ms >= 90_000 ? `${Math.round(ms / 6_000) / 10} minutes` : `${Math.round(ms / 1000)} seconds`;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Why cards came back blank, in words a person can act on. Three different
 * failures look identical on the page — a card reading "LEAD" — and each has
 * a different fix, so the message names which it was and shows the evidence.
 */
function emptyReason(
  because: { failed: string[]; modelEmpty: string[]; discarded: string[] },
  firstFailure: unknown,
  firstEmptyReply: string,
): string {
  const parts: string[] = [];
  if (because.failed.length) {
    parts.push(
      `${because.failed.length} call${because.failed.length === 1 ? "" : "s"} failed outright` +
        (firstFailure ? ` (first error: ${String(firstFailure).slice(0, 300)})` : "") +
        `.`,
    );
  }
  if (because.modelEmpty.length) {
    parts.push(
      `The model answered but left the description empty for ` +
        `${because.modelEmpty.slice(0, 5).join(", ")}` +
        `${because.modelEmpty.length > 5 ? ` and ${because.modelEmpty.length - 5} more` : ""}, ` +
        `even when asked a second time` +
        (firstEmptyReply ? `. Its actual reply was: ${firstEmptyReply}` : "") +
        `.`,
    );
  }
  if (because.discarded.length) {
    parts.push(
      `${because.discarded.length} description${because.discarded.length === 1 ? " was" : "s were"} ` +
        `discarded for copying the instructions.`,
    );
  }
  return parts.join(" ");
}

function sharesWording(candidate: string, source: string): boolean {
  const words = normalise(candidate);
  const haystack = ` ${normalise(source).join(" ")} `;
  const WINDOW = 6;
  for (let i = 0; i + WINDOW <= words.length; i++) {
    if (haystack.includes(` ${words.slice(i, i + WINDOW).join(" ")} `)) return true;
  }

  // Anything the prompt quoted, at any length.
  const candidateText = ` ${words.join(" ")} `;
  return quotedExamples(source).some((example) => candidateText.includes(` ${example} `));
}

/**
 * Drop sentences that recount a scene involving another character.
 *
 * "Cobb's wife" is exactly what a breakdown should say, and so is "works the
 * job with Cobb". "She is taken aback when Cobb traces the solution to a maze
 * she drew" is a scene.
 *
 * The first version of this dropped any sentence naming another character, and
 * on an ensemble script that deleted most of every description — a lead came
 * back as "Ariadne is a young woman". Naming someone is normal; recounting a
 * moment with them is the fault. So both signals are now required: another
 * character AND a temporal or event construction.
 */
const NARRATED_MOMENT = /\b(when|then|after|as|before|while|until|once)\b|\b\w+(s|ed|ing)\b(?=\s+(him|her|them|it)\b)/i;

function withoutOtherCharacters(body: string, self: string, cast: string[]): string {
  if (!body) return body;
  const others = cast.filter((name) => name && name !== self);
  if (!others.length) return body;

  const sentences = body.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept = sentences.filter((sentence) => {
    const namesAnother = others.some((other) => {
      const escaped = other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b(?!['’]s)`, "i").test(sentence);
    });
    return !(namesAnother && NARRATED_MOMENT.test(sentence));
  });
  return (kept.length ? kept : sentences.slice(0, 1)).join(" ");
}

/** The first few words of a description — what makes two roles read alike. */
function openingOf(body: string): string {
  if (!body) return "";
  const words = body.split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  return words.replace(/[.,;:]$/, "");
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
