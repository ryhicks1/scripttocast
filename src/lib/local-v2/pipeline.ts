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
import { composeDescription } from "../local/pipeline";
import { PROJECT_SYSTEM, projectUser, STORY_SYSTEM, storyUser } from "../local/prompts";
import { carriesLook, displayName, roleTypeLabel } from "../local/screenplay";
import { findBookVoice, findEssayVoice } from "../local/style";
import { ageFromWords, extractCast, rankCast, type CastMember, type V2Tier } from "./cast";
import { chatRole } from "./chat";
import { buildEvidence } from "./evidence";
import {
  applyProblems, assembleBody, checkFields, clampByRank, estimateAge, narrowRange, occupationUngrounded, statedDecade, stripAgeClaims, TIER_RULES, validateFields,
  type Problem, type RoleFields,
} from "./helpers";
import { PAIR_ANSWER_TEXTS, ROLE_SCHEMA, ROLE_SYSTEM, pairExampleText, roleUser } from "./prompt";
import { headOf, loadBank, retrieve, retrievePairs, retrievalEnabled } from "./retrieval";

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
  /** v2.1: what the description step did. */
  retrieval: { enabled: boolean; bank: string | null; entries: number; note: string | null; pairEntries: number; skippedScripts: number };
  promptTokens: { min: number; median: number; max: number; systemChars: number; roles: number };
  descriptionRejects: { role: string; field: string; why: string; text: string }[];
  descriptionDropped: number;
  descriptionRetries: string[];
  gendersDefaulted: string[];
  occupationsReplaced: string[];
  perRole: { role: string; tier: string; promptTokens: number; outTokens: number; ms: number; retrieved: number; pairs: number }[];
}

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
const NATIONALITY_ONLY = /^(?:british|english|scottish|welsh|irish|french|german|dutch|american|australian|canadian|swedish|texan|russian|italian|spanish)(?:\s+(?:or|and)\s+\w+)?$/i;
function ethnicityStated(claim: string, identity: string): string {
  if (NATIONALITY_ONLY.test(claim.trim())) return "";
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
  options: { onlyRoles?: string[]; /** Eval only (see route.ts): script slugs whose bank entries must not be used. */ evalSkipScripts?: string[] } = {},
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

  const wantRetrieval = retrievalEnabled();
  const loaded = wantRetrieval ? loadBank() : { bank: null, error: "retrieval switched off" };
  const bank = loaded.bank;
  if (wantRetrieval && !bank) log("v2: retrieval requested but no bank", { reason: loaded.error });
  const skipScripts = options.evalSkipScripts?.length ? new Set(options.evalSkipScripts) : null;
  const traitUse = new Map<string, number>();
  const gendersFlipped: string[] = [];
  const occupationsReplaced: string[] = [];
  const rejects: V2Diagnostics["descriptionRejects"] = [];
  const retries: string[] = [];
  const perRole: V2Diagnostics["perRole"] = [];
  let dropped = 0;

  // Tier order keeps the long static prompt identical across consecutive calls.
  const tierRank: Record<V2Tier, number> = { LEAD: 0, SUPPORTING: 1, "DAY PLAYER": 2 };
  const order = members
    .map((m, i) => ({ m, i, tier: tiers.get(m.key) ?? ("DAY PLAYER" as V2Tier) }))
    .sort((a, b) => tierRank[a.tier] - tierRank[b.tier] || a.i - b.i);
  const byIndex: (Role | undefined)[] = new Array(members.length);

  for (const [n, { m: member, i: index, tier }] of order.entries()) {
    onProgress({ phase: "roles", message: `Describing ${member.name}`, done: n, total: members.length });
    const stated = statedAge(member);
    const evidence = buildEvidence(member, stated);
    const byPronoun = pronounGender(member);

    let similarEntries: { id: number; text: string; prose?: string }[] = [];
    let pairEntries: { id: number; text: string; prose?: string; evidence?: string }[] = [];
    if (bank) {
      const q = { text: evidence.query, tier, gender: byPronoun, age: stated };
      // First choice: real (script evidence -> breakdown) pairs of the same size of part. Then plain prose.
      pairEntries = retrievePairs(bank, q, 2, { skipScripts });
      const usedIds = new Set(pairEntries.map((e) => e.id));
      similarEntries = retrieve(bank, q, 6, null, { skipScripts })
        .filter((e) => !usedIds.has(e.id))
        .slice(0, 6 - pairEntries.length);
    }
    const proseOfEntry = (e: { text: string; prose?: string }) => e.prose ?? e.text;
    const similarTexts = similarEntries.map((e) => {
      const t = proseOfEntry(e);
      return t.length > 260 ? `${t.slice(0, 260).replace(/\s+\S*$/, "")}…` : t;
    });
    const pairTexts = pairEntries.map((e) => pairExampleText(e.evidence ?? "", headOf(e.text), proseOfEntry(e)));
    const examples = [...PAIR_ANSWER_TEXTS, ...similarEntries.map(proseOfEntry), ...pairEntries.map(proseOfEntry)];

    let fields: RoleFields | null = null;
    let problems: Problem[] = [];
    let why = "";
    let promptTokens = 0;
    let outTokens = 0;
    let ms = 0;
    for (let attempt = 1; attempt <= 2 && !fields; attempt++) {
      const correction =
        attempt === 1
          ? ""
          : `\n\nYour previous answer was rejected: ${why}. Answer again, following the field rules exactly, and use fewer words.`;
      try {
        const { data, stats } = await chatRole<unknown>(cfg, {
          system: ROLE_SYSTEM,
          user: roleUser({ name: member.name, aliases: member.aliases, speaking: member.speaking, tier, evidence: evidence.text, similar: similarTexts, pairs: pairTexts, correction }),
          schema: ROLE_SCHEMA,
          label: `role: ${member.name}`,
          maxOutputTokens: 460,
          keepAlive: "10m",
        });
        modelCalls++;
        promptTokens = Math.max(promptTokens, stats.promptEval);
        outTokens += stats.evalCount;
        ms += stats.ms;
        const checked = validateFields(data);
        if (!checked.ok) {
          why = checked.why;
        } else {
          const found = checkFields(checked.fields, {
            tier,
            identity: evidence.identity,
            scene: evidence.scene,
            traitUse,
            otherNames: castNames.filter((c) => c !== member.name),
            examples,
          });
          const fatal = found.filter((p) => p.field === "occupation");
          if (fatal.length && attempt === 1) {
            why = fatal.map((p) => `${p.field} "${p.text}": ${p.why}`).join("; ");
            for (const p of fatal) rejects.push({ role: member.name, field: p.field, why: p.why, text: p.text });
          } else {
            const soft = found.filter((p) => p.field !== "occupation");
            const others = found.filter((p) => p.field !== "occupation" && p.index === -1 && p.field !== "traits");
            // One retry only when most of the form is wrong; otherwise drop what failed and keep the rest.
            const tooMuch = soft.length >= 6 || others.length >= 4;
            if (attempt === 1 && tooMuch) {
              why = soft.map((p) => `${p.field} "${p.text}": ${p.why}`).slice(0, 4).join("; ");
              for (const p of soft) rejects.push({ role: member.name, field: p.field, why: p.why, text: p.text });
            } else {
              const applied = applyProblems(checked.fields, found);
              for (const p of found) {
                if (!(attempt === 1 && tooMuch)) rejects.push({ role: member.name, field: p.field, why: p.why, text: p.text });
              }
              dropped += found.length;
              if (applied.usable) fields = applied.fields;
              else why = "occupation was not usable";
            }
          }
        }
      } catch (error) {
        modelCalls++;
        if (!firstFailure) firstFailure = error;
        why = error instanceof Error ? error.message.slice(0, 160) : "the call failed";
        // Ollama itself being gone is not worth a second call per role.
        if (error instanceof LocalAnalysisError && error.status === 503) break;
      }
      if (!fields && attempt === 1) {
        retried.push(member.name);
        retries.push(`${member.name}: ${why}`);
      }
    }
    const jobNamed = /\b(?:officer|soldier|seaman|sailor|highlander|lieutenant|private|corporal|nurse|engineer|man|boy|civilian|survivor|editor|pilot|leader|admiral|colonel|commander|captain|sergeant|guard|stewardess|bearer|medic|driver)\b/i.test(member.name);
    if (fields && jobNamed && occupationUngrounded(fields.occupation, member.name, evidence.scene)) {
      const plain = member.name.replace(/\s*\d+$/, "").replace(/\s*\([^)]*\)/g, "").trim();
      occupationsReplaced.push(`${member.name}: "${fields.occupation}" -> "${plain}"`);
      fields = { ...fields, occupation: plain };
    }
    if (fields) {
      for (const t of fields.traits) {
        const k = t.toLowerCase().split(/[^a-z]+/)[0];
        traitUse.set(k, (traitUse.get(k) ?? 0) + 1);
      }
      if (fields.type) traitUse.set(`type:${fields.type.toLowerCase()}`, (traitUse.get(`type:${fields.type.toLowerCase()}`) ?? 0) + 1);
    }
    if (!fields) {
      fallback.push(member.name);
      log("v2: role fell back", { role: member.name, why });
    }
    perRole.push({ role: member.name, tier, promptTokens, outTokens, ms, retrieved: similarEntries.length + pairEntries.length, pairs: pairEntries.length });

    // Age: script first (an exact age, then a decade), then the model, then an estimate. Never blank.
    const decade = stated === null ? statedDecade([member.name, ...member.aliases, member.name.split(/\s+/).pop() ?? ""], member.sentences.map((x) => x.text)) : null;
    let ageMin: number;
    let ageMax: number;
    if (stated !== null) {
      const pad = stated < 20 ? 1 : 2;
      ageMin = Math.max(1, stated - pad);
      ageMax = stated + pad;
      if (fields && fields.ageMin <= stated && fields.ageMax >= stated && fields.ageMax - fields.ageMin <= 8 && fields.ageMax - fields.ageMin >= 2 * pad) {
        ageMin = fields.ageMin;
        ageMax = fields.ageMax;
      }
      agesFromScript.push(`${member.name}: ${stated}`);
    } else if (decade) {
      [ageMin, ageMax] = decade;
      agesFromScript.push(`${member.name}: ${decade[0]}s`);
    } else if (fields) {
      [ageMin, ageMax] = narrowRange(fields.ageMin, fields.ageMax, 15);
      [ageMin, ageMax] = clampByRank(member.name, fields.occupation, ageMin, ageMax);
      agesFromModel++;
    } else {
      [ageMin, ageMax] = estimateAge(member.name);
      agesEstimated.push(member.name);
    }

    let gender = fields?.gender ?? "";
    if (byPronoun && gender !== byPronoun) gender = byPronoun;
    // A model that says Female with no female cue anywhere in what it read is guessing.
    if (!byPronoun && gender === "Female" && !evidence.femaleCue) {
      gender = "Male";
      gendersFlipped.push(member.name);
    }
    if (!gender) gender = byPronoun ?? (/\b(nurse|stewardess|mrs|waitress|actress)\b/i.test(member.name) ? "Female" : "Male");

    // Ethnicity only when the script's own words say it; otherwise the trade's open value.
    const stateEthnicity = fields ? ethnicityStated(fields.ethnicity, evidence.identity) : "";
    const ethnicityShown = stateEthnicity || "all ethnicities";

    let body = fields ? assembleBody(fields, tier, member.speaking) : fallbackBody(member);
    body = withoutOtherCharacters(body, member.name, castNames);
    body = stripAgeClaims(body);

    const roleType = screenplay ? roleTypeLabel(tier, locale) : mode === "commercial" ? "PRINCIPAL" : "SUPPORTING";
    const ageRange = `${ageMin}-${ageMax}`;
    const lead = `${ageMin} to ${ageMax} years old`;

    byIndex[index] = {
      name: member.name,
      description: composeDescription({ gender, ageRange: lead, ethnicity: ethnicityShown, body, roleType }),
      ageRange,
      gender,
      ethnicity: stateEthnicity || null,
      roleType,
      speaking: member.speaking,
      characteristics: fields ? [...fields.traits, ...fields.skills].slice(0, 8) : [],
      contentAdvisories: [],
      submissionNotes: [],
      pageNumbers: member.pages,
    };

    onProgress({ phase: "roles", message: `Described ${member.name}`, done: n + 1, total: members.length });
    if (n < 2 && fallback.length === n + 1) {
      throw new LocalAnalysisError(
        `Stopped after ${n + 1} role${n ? "s" : ""}: the local model gave no usable answer for ${member.name} twice` +
          `${why ? ` (${why})` : ""}. Nothing was sent anywhere; this ran entirely on this machine.`,
        502,
        firstFailure ? String(firstFailure) : why,
      );
    }
  }
  for (const r of byIndex) if (r) roles.push(r);

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
      retrieval: {
        enabled: wantRetrieval,
        bank: bank ? "loaded (path not recorded)" : null,
        entries: bank?.entries.length ?? 0,
        note: bank ? null : (loaded.error ?? null),
        pairEntries: bank?.entries.filter((e) => e.evidence).length ?? 0,
        skippedScripts: skipScripts?.size ?? 0,
      },
      promptTokens: promptStats(perRole.map((p) => p.promptTokens), ROLE_SYSTEM.length),
      descriptionRejects: rejects,
      descriptionDropped: dropped,
      descriptionRetries: retries,
      gendersDefaulted: gendersFlipped,
      occupationsReplaced,
      perRole,
    },
  };
}

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

function promptStats(values: number[], systemChars: number): V2Diagnostics["promptTokens"] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  return { min: v[0] ?? 0, median: v[v.length >> 1] ?? 0, max: v[v.length - 1] ?? 0, systemChars, roles: v.length };
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "").replace(/[,;:]$/, "") + ".";
}

/** Last resort when the model gave nothing usable: the role name and whether it speaks. Never a paraphrase of an action line. */
function fallbackBody(member: CastMember): string {
  const plain = member.name.replace(/\s*\d+$/, "").replace(/\s*\([^)]*\)/g, "").trim();
  return member.speaking ? `${plain}.` : `${plain}. Non-speaking.`;
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
