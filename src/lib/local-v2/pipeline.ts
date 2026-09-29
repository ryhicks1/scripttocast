/**
 * The v2 private pipeline. Ollama on this machine, and nothing else.
 *
 * There is no Anthropic import here or in anything it reaches, and there must
 * never be one — not as a fallback either. Every model call goes through
 * chatJson (../local/ollama.ts), which refuses a non-loopback Ollama.
 *
 * How it differs from v1 (../local/pipeline.ts, which is untouched):
 *
 *  - Cast comes from cast.ts: speakers AND silent characters introduced in
 *    action, with title cards / voice cues / sound cues / scene-heading
 *    fragments filtered and variants merged.
 *  - One small call per role, on that role's own evidence (a few KB), instead
 *    of the whole script in every call. Context stays at OLLAMA_NUM_CTX
 *    (default 8192), so a 16 GB Mac holds the 8B model plus a ~1 GB KV cache,
 *    not the 4.5–6.5 GiB v1 reserves for a feature script.
 *  - The reply is grammar-constrained to a strict schema (gender enum, integer
 *    ageMin/ageMax, description, traits) and then validated. A bad reply is
 *    retried once with the reason stated; after that the role falls back to a
 *    deterministic entry. Age is never omitted: stated ages in the script win,
 *    then the model's range, then a role-noun default marked as estimated.
 *  - The canonical line "[GENDER], [AGE] years old[, ETHNICITY]. [BODY]...[TYPE]"
 *    is composed in code, exactly as the Claude path prints it.
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
import type { Locale } from "../locale";
import { defaultFormQuestions, defaultSelfTape } from "../local/defaults";
import { LocalAnalysisError } from "../local/errors";
import type { ExtractedDocument } from "../local/extract";
import { chatJson, type OllamaConfig } from "../local/ollama";
import { composeDescription, tightenDescription } from "../local/pipeline";
import { PROJECT_SYSTEM, projectUser, STORY_SYSTEM, storyUser } from "../local/prompts";
import { carriesLook, displayName, roleTypeLabel } from "../local/screenplay";
import { findBookVoice, findEssayVoice, stripEssayClauses } from "../local/style";
import { ageFromWords, extractCast, rankCast, type CastMember, type V2Tier } from "./cast";
import { estimateAge, stripAgeClaims, validateReply, type RoleReply } from "./helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface V2Progress {
  phase: "project" | "story" | "cast" | "roles" | "assembling";
  message: string;
  done?: number;
  total?: number;
}

type Logger = (message: string, data?: Record<string, unknown>) => void;

export interface V2Diagnostics {
  version: "v2";
  pages: number;
  parsedAsScreenplay: boolean;
  rolesFound: number;
  speakingRoles: number;
  nonSpeakingRoles: number;
  droppedCues: { name: string; reason: string }[];
  merged: { from: string; into: string }[];
  rolesDescribed: number;
  rolesRetried: string[];
  rolesFallback: string[];
  agesFromScript: string[];
  agesFromModel: number;
  agesEstimated: string[];
  modelCalls: number;
  numCtx: number;
  model: string;
  elapsedMs: number;
}

const ROLE_SCHEMA = {
  type: "object",
  required: ["gender", "ageMin", "ageMax", "ethnicity", "description", "traits"],
  additionalProperties: false,
  properties: {
    gender: { type: "string", enum: ["Male", "Female", "Non-binary"] },
    ageMin: { type: "integer", minimum: 1, maximum: 99 },
    ageMax: { type: "integer", minimum: 1, maximum: 99 },
    ethnicity: { type: "string" },
    description: { type: "string" },
    traits: { type: "array", items: { type: "string" }, maxItems: 6 },
  },
} as const;

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

/** Hard ceiling on the window v2 will ask for, whatever OLLAMA_NUM_CTX says. */
export const V2_MAX_NUM_CTX = 16_384;

const DESCRIPTION_CHARS: Record<V2Tier, number> = { LEAD: 640, SUPPORTING: 480, "DAY PLAYER": 320 };
const LENGTH_HINT: Record<V2Tier, string> = {
  LEAD: "Four or five sentences, about ninety words.",
  SUPPORTING: "Three or four sentences, about sixty words.",
  "DAY PLAYER": "One or two short sentences, about thirty words.",
};

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/** Identical on every role call, so Ollama's prompt cache holds it. */
const ROLE_SYSTEM = `You write one casting-breakdown entry for a character in a screenplay, in the plain trade style of Casting Networks and Breakdown Services.

You are given evidence taken from the script about ONE character: action lines that name them, and a few of their spoken lines. Use only that evidence and ordinary common sense about the job or rank they hold.

Fields:
- gender: Male, Female or Non-binary, as the script presents them.
- ageMin and ageMax: whole numbers, the playing-age range an agent would search on. Always give both, even when the script does not state an age: judge from any stated age, the job or rank, and how they are written. Keep the range within 10 years for a stated age and within 20 years otherwise.
- ethnicity: only when the script itself says it. Otherwise an empty string.
- description: who this person is for an actor deciding whether to submit. Their job or place in the story, temperament, how they carry themselves, how they treat other people, and what the part asks of the actor. Write the person, not the plot: do not retell scenes, do not quote dialogue, do not say what happens to them, and never mention the script, the film or the audience. Do not state gender or age in the description, they are printed separately. Do not attribute anything to this character that the evidence gives to someone else. Silent characters are still described from the action lines. When the evidence is thin, write one short sentence that stays with what the name and lines support, and never give the character a different job or gender than their name says.
- traits: up to six single words or short phrases a casting director could filter on.

Answer with the JSON object only.`;

interface Evidence {
  text: string;
  /** The words the script gives about this person, for checking claims. */
  identity: string;
}

const MAX_EVIDENCE_CHARS = 3000;

function buildRoleEvidence(member: CastMember): Evidence {
  const lines: string[] = [];
  // Sentences that say what the person is like come first, then blocking, all in page order.
  const scored = member.sentences.map((s, i) => ({
    ...s,
    i,
    score: (carriesLook(s.text) ? 2 : 0) + (i === 0 ? 2 : 0) + (s.text.length > 200 ? -1 : 0),
  }));
  const chosen: typeof scored = [];
  let chars = 0;
  for (const s of [...scored].sort((a, b) => b.score - a.score || a.page - b.page)) {
    if (chosen.length >= 12 || chars + s.text.length > 1900) continue;
    chosen.push(s);
    chars += s.text.length;
  }
  chosen.sort((a, b) => a.page - b.page || a.i - b.i);
  if (chosen.length) {
    lines.push(`Action lines that name ${displayNameOf(member)}:`);
    for (const s of chosen) lines.push(`(p${s.page}) ${s.text.slice(0, 360)}`);
  } else {
    lines.push(`No action line names ${displayNameOf(member)} beyond the cue.`);
  }

  if (member.dialogue.length) {
    const want = 5;
    const step = Math.max(1, Math.floor(member.dialogue.length / want));
    const picked: { page: number; text: string }[] = [];
    for (let i = 0; i < member.dialogue.length && picked.length < want; i += step) picked.push(member.dialogue[i]);
    lines.push("", `${displayNameOf(member)} says (${member.cues} speech${member.cues === 1 ? "" : "es"} in all):`);
    for (const d of picked) lines.push(`(p${d.page}) ${d.text.slice(0, 200)}`);
  } else {
    lines.push("", `${displayNameOf(member)} has no dialogue.`);
  }

  let text = lines.join("\n");
  if (text.length > MAX_EVIDENCE_CHARS) text = `${text.slice(0, MAX_EVIDENCE_CHARS)}…`;
  const identity = [...chosen.map((s) => s.text), ...member.dialogue.map((d) => d.text)].join("\n");
  return { text, identity };
}

function displayNameOf(member: CastMember): string {
  return member.name;
}

function roleUser(member: CastMember, tier: V2Tier, evidence: Evidence, correction = ""): string {
  const also = member.aliases.length ? ` (also written as ${member.aliases.join(", ")})` : "";
  return (
    `Character: ${member.name}${also}\n` +
    `Speaks in the script: ${member.speaking ? "yes" : "no, silent"}\n` +
    `Size of part: ${tier}\n` +
    `Description length: ${LENGTH_HINT[tier]}\n\n` +
    `EVIDENCE\n${evidence.text}\n\n` +
    `Write ${member.name}'s entry now.${correction}`
  );
}

// ---------------------------------------------------------------------------
// Validation, and the age rule
// ---------------------------------------------------------------------------

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** "Peter (nineteen)", "George (seventeen)", "a Stewardess (fifty-nine)" -> the number. */
export function statedAge(member: CastMember): number | null {
  const forms = [member.name, ...member.aliases].map((n) => n.replace(/\./g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const last = member.name.split(/\s+/).pop() ?? "";
  if (last.length >= 3 && !/\d/.test(last)) forms.push(last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const alt = forms.filter(Boolean).join("|");
  if (!alt) return null;
  const re = new RegExp(
    `(?:${alt})\\s*\\(\\s*(?:aged?\\s+)?(\\d{1,2}|[a-z]+(?:[- ][a-z]+)?)(?:\\s+years?\\s+old)?\\s*\\)`,
    "i",
  );
  for (const s of member.sentences) {
    const m = re.exec(s.text.replace(/\./g, "").replace(/’/g, "'"));
    if (!m) continue;
    const age = ageFromWords(m[1]);
    if (age && age >= 1 && age <= 99) return age;
  }
  return null;
}

function pronounGender(member: CastMember): "Male" | "Female" | null {
  const text = member.sentences.map((s) => s.text).join(" ");
  const he = (text.match(/\b(he|him|his|himself)\b/gi) ?? []).length;
  const she = (text.match(/\b(she|her|hers|herself)\b/gi) ?? []).length;
  if (he >= 3 && she === 0) return "Male";
  if (she >= 3 && he === 0) return "Female";
  return null;
}

/** Ethnicity only when the script's own words about them contain it. */
function ethnicityStated(claim: string, identity: string): string {
  if (!claim || /^(none|n\/a|unknown|not stated|unspecified|all ethnicities)$/i.test(claim)) return "";
  const words = claim.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  if (!words.length) return "";
  const hay = identity.toLowerCase();
  return words.every((w) => hay.includes(w.slice(0, Math.max(4, w.length - 2)))) ? claim : "";
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function analyzeLocallyV2(
  documents: ExtractedDocument[],
  requestedMode: BreakdownMode,
  config: OllamaConfig,
  log: Logger = () => {},
  onProgress: (p: V2Progress) => void = () => {},
  locale: Locale = "us",
  options: { onlyRoles?: string[] } = {},
): Promise<{ result: AnalysisResult; diagnostics: V2Diagnostics }> {
  const startedAt = Date.now();
  let modelCalls = 0;

  const primary = documents.find((d) => d.kind === "pdf") ?? documents[0];
  const pages = documents.flatMap((d) => d.pages);
  if (!pages.length) throw new LocalAnalysisError("No readable pages in the upload.", 400);

  // Memory: one small window for every call. Never the whole script.
  const numCtx = Math.min(config.numCtx, V2_MAX_NUM_CTX);
  const cfg: OllamaConfig = { ...config, numCtx, promptCharBudget: Math.max(1500, Math.floor((numCtx - 1200) * 3.2)) };

  const cast = extractCast(primary.pageLines);
  const screenplay = cast.cast.filter((c) => c.speaking).length >= 2 && cast.scenes.length >= 2;
  const mode: ResolvedMode =
    requestedMode === "film_tv" || requestedMode === "commercial" ? requestedMode : screenplay ? "film_tv" : "commercial";

  // ---- project + story ------------------------------------------------------
  onProgress({ phase: "project", message: "Reading the title page" });
  const project = emptyProject();
  const head = pages.slice(0, 4).join("\n").slice(0, 5000);
  const projectReply = await chatJson<{
    title: string; productionType: string; director: string; writer: string; castingDirector: string; location: string;
  }>(cfg, {
    system: PROJECT_SYSTEM,
    user: projectUser(documents[0]?.name ?? "script", head),
    schema: PROJECT_SCHEMA,
    label: "project details",
    maxOutputTokens: 400,
    keepAlive: "10m",
  });
  modelCalls++;
  project.name = clean(projectReply.title) || fallbackTitle(documents[0]?.name);
  project.type = PROJECT_TYPES.includes(projectReply.productionType as (typeof PROJECT_TYPES)[number])
    ? projectReply.productionType
    : mode === "commercial" ? "commercial" : "feature_film";
  project.director = clean(projectReply.director) || null;
  project.writer = clean(projectReply.writer) || null;
  project.castingDirector = clean(projectReply.castingDirector) || null;
  project.location = clean(projectReply.location) || null;

  if (cast.scenes.length >= 5) {
    onProgress({ phase: "story", message: "Writing the logline and synopsis" });
    const headings: string[] = [];
    let used = 0;
    const stride = Math.max(1, Math.ceil(cast.scenes.length / 140));
    for (let i = 0; i < cast.scenes.length; i += stride) {
      const h = `p${cast.scenes[i].startPage} ${cast.scenes[i].heading}`;
      if (used + h.length > 5000) break;
      headings.push(h);
      used += h.length + 1;
    }
    try {
      const story = await chatJson<{ logline: string; synopsis: string }>(cfg, {
        system: STORY_SYSTEM,
        user: storyUser(project.name, headings),
        schema: STORY_SCHEMA,
        label: "logline and synopsis",
        maxOutputTokens: 500,
        keepAlive: "10m",
      });
      modelCalls++;
      project.logline = clean(story.logline) || null;
      project.synopsis = clean(story.synopsis) || null;
    } catch (error) {
      log("v2: story pass failed", { error: String(error) });
    }
  }

  // ---- cast -----------------------------------------------------------------
  const { ordered, tiers } = rankCast(cast.cast);
  const wanted = (options.onlyRoles ?? []).map((n) => n.toUpperCase().split(/\s+/).filter(Boolean));
  const chosen = wanted.length
    ? ordered.filter((c) => {
        const w = c.key.split(" ");
        return wanted.some((x) => x.every((y) => w.includes(y)) || w.every((y) => x.includes(y)));
      })
    : ordered;
  const maxRoles = Number(process.env.OLLAMA_MAX_ROLES) || 120;
  const members = chosen.slice(0, maxRoles);
  onProgress({
    phase: "cast",
    message: `Found ${ordered.length} character${ordered.length === 1 ? "" : "s"} (${ordered.filter((c) => !c.speaking).length} silent)`,
  });
  if (!members.length) {
    throw new LocalAnalysisError(
      "No roles could be found in this document. It may be a scan without a text layer, or not a screenplay. " +
        "Nothing was sent anywhere — this ran entirely on this machine.",
      422,
    );
  }
  log("v2: cast", {
    roles: members.length,
    dropped: cast.dropped.length,
    merged: cast.merged.length,
  });

  // ---- one call per role ------------------------------------------------------
  const roles: Role[] = [];
  const retried: string[] = [];
  const fallback: string[] = [];
  const agesFromScript: string[] = [];
  const agesEstimated: string[] = [];
  let agesFromModel = 0;
  const castNames = members.map((m) => m.name);
  let firstFailure: unknown = null;

  for (const [index, member] of members.entries()) {
    onProgress({ phase: "roles", message: `Describing ${member.name}`, done: index, total: members.length });
    const tier = tiers.get(member.key) ?? "DAY PLAYER";
    const evidence = buildRoleEvidence(member);

    const ask = (correction: string) =>
      chatJson<unknown>(cfg, {
        system: ROLE_SYSTEM,
        user: roleUser(member, tier, evidence, correction),
        schema: ROLE_SCHEMA,
        label: `role: ${member.name}`,
        maxOutputTokens: 420,
        timeoutMs: 600_000,
        keepAlive: "10m",
      });

    let reply: RoleReply | null = null;
    let why = "";
    for (let attempt = 1; attempt <= 2 && !reply; attempt++) {
      try {
        const raw = await ask(
          attempt === 1
            ? ""
            : `\n\nYour previous answer was rejected: ${why}. Answer again, following the field rules exactly.`,
        );
        modelCalls++;
        const checked = validateReply(raw);
        if (checked.ok) reply = checked.reply;
        else why = checked.why;
      } catch (error) {
        modelCalls++;
        if (!firstFailure) firstFailure = error;
        why = error instanceof Error ? error.message.slice(0, 160) : "the call failed";
        // Ollama itself being gone is not worth a second call per role.
        if (error instanceof LocalAnalysisError && error.status === 503) break;
      }
      if (!reply && attempt === 1) retried.push(member.name);
    }
    if (!reply) {
      fallback.push(member.name);
      log("v2: role fell back", { role: member.name, why });
    }

    // Age: script first, then the model, then an estimate. Never blank.
    const stated = statedAge(member);
    let ageMin: number;
    let ageMax: number;
    if (stated !== null) {
      const pad = stated < 20 ? 1 : 2;
      ageMin = Math.max(1, stated - pad);
      ageMax = stated + pad;
      if (reply && reply.ageMin <= stated && reply.ageMax >= stated && reply.ageMax - reply.ageMin <= 10) {
        ageMin = reply.ageMin;
        ageMax = reply.ageMax;
      }
      agesFromScript.push(`${member.name}: ${stated}`);
    } else if (reply) {
      ageMin = reply.ageMin;
      ageMax = reply.ageMax;
      agesFromModel++;
    } else {
      [ageMin, ageMax] = estimateAge(member.name);
      agesEstimated.push(member.name);
    }

    let gender = reply?.gender ?? "";
    const byPronoun = pronounGender(member);
    if (byPronoun && gender !== byPronoun) gender = byPronoun;
    if (!gender) gender = byPronoun ?? (/\b(nurse|stewardess|mrs|waitress|actress)\b/i.test(member.name) ? "Female" : "Male");

    const ethnicity = reply ? ethnicityStated(reply.ethnicity, evidence.identity) : "";

    const budget = DESCRIPTION_CHARS[tier];
    let body = reply ? stripEssayClauses(reply.description) : fallbackBody(member);
    body = tightenDescription(body, tier === "LEAD" ? 5 : tier === "SUPPORTING" ? 4 : 2, log, member.name);
    body = withoutOtherCharacters(body, member.name, castNames);
    body = stripDemographicEcho(body);
    body = stripAgeClaims(body);
    if (body.length > budget + 120) body = clip(body, budget + 120);

    const roleType = screenplay ? roleTypeLabel(tier, locale) : mode === "commercial" ? "PRINCIPAL" : "SUPPORTING";
    const ageRange = `${ageMin}-${ageMax}`;
    const lead = `${ageMin} to ${ageMax} years old`;

    roles.push({
      name: member.name,
      description: composeDescription({ gender, ageRange: lead, ethnicity, body, roleType }),
      ageRange,
      gender,
      ethnicity: ethnicity || null,
      roleType,
      speaking: member.speaking,
      characteristics: reply?.traits ?? [],
      contentAdvisories: [],
      submissionNotes: [],
      pageNumbers: member.pages,
    });

    onProgress({ phase: "roles", message: `Described ${member.name}`, done: index + 1, total: members.length });
    if (index < 2 && fallback.length === index + 1) {
      throw new LocalAnalysisError(
        `Stopped after ${index + 1} role${index ? "s" : ""}: the local model gave no usable answer for ${member.name} twice` +
          `${why ? ` (${why})` : ""}. Nothing was sent anywhere; this ran entirely on this machine.`,
        502,
        firstFailure ? String(firstFailure) : why,
      );
    }
  }

  if (fallback.length === roles.length) {
    throw new LocalAnalysisError(
      `The local model failed on every role (${roles.length}). First failure: ${firstFailure ? String(firstFailure) : "unknown"}.`,
      502,
    );
  }

  onProgress({ phase: "assembling", message: "Putting the breakdown together" });
  const selfTapeInstructions: SelfTapeInstruction[] = roles.map((r) => defaultSelfTape(r.name));
  const formQuestions: FormQuestion[] = roles.map((r) => defaultFormQuestions(r.name, mode, r.contentAdvisories));
  const result = normalizeResult({ mode, project, roles, selfTapeInstructions, formQuestions });

  return {
    result,
    diagnostics: {
      version: "v2",
      pages: pages.length,
      parsedAsScreenplay: screenplay,
      rolesFound: ordered.length,
      speakingRoles: ordered.filter((c) => c.speaking).length,
      nonSpeakingRoles: ordered.filter((c) => !c.speaking).length,
      droppedCues: cast.dropped,
      merged: cast.merged,
      rolesDescribed: roles.length - fallback.length,
      rolesRetried: retried,
      rolesFallback: fallback,
      agesFromScript,
      agesFromModel,
      agesEstimated,
      modelCalls,
      numCtx,
      model: cfg.model,
      elapsedMs: Date.now() - startedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "").replace(/[,;:]$/, "") + ".";
}

/** Last resort when the model gave nothing usable: the script's own introduction, trimmed. */
function fallbackBody(member: CastMember): string {
  const first = member.sentences.find((s) => carriesLook(s.text)) ?? member.sentences[0];
  if (!first) return member.speaking ? `Speaking role in the script.` : `Non-speaking presence in the script.`;
  return first.text.replace(/\s+/g, " ").slice(0, 240);
}

/** Drop a sentence that recounts a moment with another named character. */
const NARRATED_MOMENT = /\b(when|then|after|as|before|while|until|once)\b/i;
function withoutOtherCharacters(body: string, self: string, cast: string[]): string {
  if (!body) return body;
  const others = cast.filter((n) => n && n !== self && n.length > 3);
  const sentences = body.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept = sentences.filter((s) => {
    const names = others.some((o) => new RegExp(`\\b${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b(?!['’]s)`).test(s));
    return !(names && NARRATED_MOMENT.test(s));
  });
  return (kept.length ? kept : sentences.slice(0, 1)).join(" ");
}

/** "A 35-year-old man." at the start is already printed in the lead line. */
function stripDemographicEcho(body: string): string {
  return body
    .replace(/^(?:An?\s+)?(?:\d{1,2}|[a-z]+)(?:-|\s)years?(?:-|\s)old\s+(?:male|female|man|woman|boy|girl)\b[,.]?\s*/i, "")
    .replace(/^(?:Male|Female|Man|Woman)[,;.]\s*(?:\d{1,2}(?:\s*(?:to|-)\s*\d{1,2})?\s*(?:years old)?[,;.]\s*)?/i, "")
    .trim();
}

function fallbackTitle(fileName: string | undefined): string {
  if (!fileName) return "Untitled";
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Untitled";
}

function emptyProject(): Project {
  return {
    name: "Untitled", brand: "", type: "feature_film", logline: null, synopsis: null, location: null,
    deadline: null, director: null, writer: null, producers: null, castingDirector: null, union: null,
    rate: null, auditionDates: null, callbackDates: null, shootDates: null, productionDates: null,
    contentAdvisories: [], submissionNotes: [],
  };
}

// Kept so an unused-import lint stays quiet if a filter is toggled off while tuning.
void findNarrativeVoice; void findBookVoice; void findEssayVoice; void displayName;
