/**
 * Deterministic screenplay parsing for the private path.
 *
 * A 3B or 8B model asked to "list every character with accurate page numbers"
 * over a 105-page feature does not do it. But a screenplay is a formatted
 * document: character cues sit above dialogue, indented, in caps. Reading the
 * cast out of that formatting is exact, free, and needs no model.
 *
 * Elements are told apart by their left margin where the PDF provides one (see
 * extract.ts), and by text shape where it does not. The margin matters: without
 * it, action lines following a speech are indistinguishable from the speech
 * itself, and they end up presented to the model as dialogue. That is what
 * produced descriptions like "A young woman carrying books turns. She is taken
 * aback when Cobb traces the solution to a maze she drew" — the model was
 * handed action and summarised it, correctly.
 *
 * `looksLikeScreenplay` reports whether any of this applied; callers fall back
 * to a model pass for documents (casting one-pagers, commercial boards) that
 * carry no screenplay formatting.
 */
import type { Line } from "./extract";

export interface DialogueBlock {
  page: number;
  /** Dialogue as spoken, parentheticals removed. */
  text: string;
}

export interface ParsedCharacter {
  name: string;
  /** 1-indexed pages where this character speaks. */
  pages: number[];
  /** Number of cue lines — how often they speak. */
  cues: number;
  /** Total captured dialogue characters. See assignTiers for why cues rank. */
  dialogueChars: number;
  blocks: DialogueBlock[];
}

export interface ParsedScript {
  pages: string[];
  /**
   * Action, as sentences. Wrapped PDF lines of one sentence are joined first,
   * so a look written on the next line is not thrown away because the name
   * was on the line above.
   */
  actionLines: { page: number; text: string; run: number }[];
  characters: ParsedCharacter[];
  sceneHeadings: { page: number; text: string }[];
  looksLikeScreenplay: boolean;
  /** True when the PDF gave usable margins and elements were told apart by them. */
  usedLayout: boolean;
}

const SCENE_HEADING = /^(INT\.?|EXT\.?|INT\.?\/EXT\.?|I\/E|EST\.?)[\s.]/;
const TRANSITION =
  /^(FADE (IN|OUT|TO)|CUT TO|SMASH CUT|MATCH CUT|DISSOLVE|WIPE TO|BACK TO|INTERCUT|THE END|CONTINUED|OMITTED|TITLE|SUPER|MAIN TITLES?|END CREDITS|MONTAGE|SERIES OF SHOTS)\b/;
const PAGE_MARKER = /^\(?(CONTINUED|MORE|CONT'D|CONT’D)\)?$/;
const CUE_QUALIFIER = /\s*\((V\.?O\.?|O\.?S\.?|O\.?C\.?|CONT'?’?D|PRE-?LAP|FILTERED|ON (TV|RADIO|PHONE))\)\s*$/gi;

/** A speech is a few lines. Capping it bounds what can leak in. */
const MAX_DIALOGUE_LINES = 6;
const MAX_DIALOGUE_CHARS = 400;

// Margins in points, relative to the document's action margin. Standard
// screenplay layout puts dialogue about an inch in and a cue about two.
const DIALOGUE_INDENT = 40;
const CUE_INDENT = 130;

type Element = "scene" | "cue" | "dialogue" | "action";

function isUpperCase(line: string): boolean {
  return /[A-Z]/.test(line) && line === line.toUpperCase();
}

/** True for a line that reads like a character cue rather than action. */
function looksLikeCue(line: string): boolean {
  const bare = line.replace(CUE_QUALIFIER, "").trim();
  if (!bare || bare.length > 40) return false;
  if (!isUpperCase(bare)) return false;
  if (SCENE_HEADING.test(bare) || TRANSITION.test(bare) || PAGE_MARKER.test(bare)) return false;
  if (/[.!?,:;]$/.test(bare)) return false;
  if (bare.split(/\s+/).length > 5) return false;
  if (!/[A-Z]{2}/.test(bare)) return false;
  return true;
}

/**
 * Cue name without qualifiers — the identity of a character.
 *
 * A Dune run returned Paul and "Paul (V.O.)" as two roles, along with
 * "Gurney (O.S.)" and "Reverend Mother Mohiam (O.C.)". The old version only
 * stripped a parenthetical anchored to the end of the line, and extracted text
 * routinely carries a trailing page number or a fragment of the next item, so
 * the anchor failed and the qualifier survived into the cast list.
 *
 * Every parenthetical is stripped now, wherever it sits, along with anything
 * after it. A character cue is a name; nothing in brackets is part of it.
 */
function cueName(line: string): string {
  return line
    .replace(CUE_QUALIFIER, "")
    .replace(/\s*\([^)]*\)?.*$/, "")
    .replace(/[\s*.,:;-]+$/, "")
    .trim();
}

function isParenthetical(line: string): boolean {
  return /^\(.*\)?$/.test(line.trim());
}

/**
 * What kind of line this is.
 *
 * With margins, the answer is structural and reliable. Without them, it falls
 * back to shape alone, which cannot separate an action line from the dialogue
 * above it — so callers should prefer layout when `usedLayout` is true.
 */
function classify(line: Line, useLayout: boolean): Element {
  const text = line.text.trim();
  if (SCENE_HEADING.test(text) && isUpperCase(text)) return "scene";

  if (useLayout) {
    if (line.indent >= CUE_INDENT && looksLikeCue(text)) return "cue";
    if (line.indent >= DIALOGUE_INDENT) return "dialogue";
    return "action";
  }

  return looksLikeCue(text) ? "cue" : "action";
}

export function parseScript(pageLines: Line[][]): ParsedScript {
  const useLayout = pageLines.some((lines) => lines.some((line) => line.indent >= CUE_INDENT));

  const byName = new Map<string, ParsedCharacter>();
  const sceneHeadings: { page: number; text: string }[] = [];
  const actionLines: { page: number; text: string; run: number }[] = [];
  const pages = pageLines.map((lines) => lines.map((line) => line.text).join("\n"));
  const fullText = pages.join("\n");

  // Consecutive action lines are one paragraph that the PDF wrapped. A blank
  // line, a cue, or a scene heading ends it. Joining before the length check
  // is what keeps "This is RENNA." (14 characters) attached to the age and
  // the build written on the line below.
  let runParts: string[] = [];
  let runPage = 1;
  let nextRun = 0;

  const flushRun = () => {
    if (!runParts.length) return;
    const text = runParts.join(" ").replace(/\s+/g, " ").trim();
    runParts = [];
    const run = nextRun++;
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const trimmed = sentence.trim();
      if (trimmed.length < 8 || !/[a-z]/.test(trimmed)) continue;
      actionLines.push({ page: runPage, text: trimmed, run });
    }
  };

  pageLines.forEach((lines, index) => {
    const pageNumber = index + 1;

    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].text.trim();
      if (!text) {
        flushRun();
        continue;
      }
      const kind = classify(lines[i], useLayout);
      if (kind !== "action") flushRun();

      if (kind === "scene") {
        sceneHeadings.push({ page: pageNumber, text: text.slice(0, 120) });
        continue;
      }
      if (kind === "action") {
        if (TRANSITION.test(text) || PAGE_MARKER.test(text)) {
          flushRun();
          continue;
        }
        runPage = pageNumber;
        runParts.push(text);
        continue;
      }
      if (kind !== "cue") continue;

      // Collect the speech under this cue. It stops at the next cue, a scene
      // heading, or — where margins are available — the first action line,
      // which is what keeps action out of the model's "what they say" evidence.
      const spoken: string[] = [];
      let j = i + 1;
      let taken = 0;
      let chars = 0;
      while (j < lines.length && taken < MAX_DIALOGUE_LINES && chars < MAX_DIALOGUE_CHARS) {
        const next = lines[j].text.trim();
        if (!next) break;
        const nextKind = classify(lines[j], useLayout);
        if (nextKind === "cue" || nextKind === "scene") break;
        if (useLayout && nextKind === "action") break;
        if (!useLayout && isUpperCase(next) && !isParenthetical(next)) break;
        if (!isParenthetical(next) && !PAGE_MARKER.test(next)) {
          spoken.push(next);
          chars += next.length;
        }
        taken++;
        j++;
      }

      const speech = spoken.join(" ").trim();
      if (!speech) {
        i = j - 1;
        continue;
      }

      const name = cueName(text);
      if (!name) continue;

      const existing = byName.get(name) ?? {
        name,
        pages: [],
        cues: 0,
        dialogueChars: 0,
        blocks: [],
      };
      existing.cues += 1;
      existing.dialogueChars += speech.length;
      if (!existing.pages.includes(pageNumber)) existing.pages.push(pageNumber);
      existing.blocks.push({ page: pageNumber, text: speech });
      byName.set(name, existing);

      i = j - 1;
    }

    flushRun();
  });

  // A title card can sit where a cue sits and pick up the line under it
  // ("DUNE" over a sentence of opening action). Requiring every name to recur
  // threw that away, and also threw away one-scene roles — a guard with one
  // speech, a radioman, a fremen who speaks once. Those are day players. A
  // casting breakdown that drops them is missing characters.
  //
  // A single word that never recurs is the title-card case. Two or more words
  // and a real speech is a person. Dual cues ("PAUL & JESSICA") are not a
  // third person. Age-variant billings are added even when they never speak.
  const speaking = [...byName.values()].filter((c) => isSpeakingRole(c, fullText));

  for (const variant of promoteAgeVariants(actionLines, speaking)) {
    if (byName.has(variant.name)) continue;
    byName.set(variant.name, variant);
  }

  const characters = [...byName.values()]
    .filter((c) => {
      if (isSpeakingRole(c, fullText)) return true;
      // Flashback / era doubles: billed in action, often without dialogue.
      return isAgeVariantName(c.name) && speaking.some((s) => samePersonBase(c.name, s.name));
    })
    .sort((a, b) => b.cues - a.cues || b.dialogueChars - a.dialogueChars);

  return {
    pages,
    actionLines,
    characters,
    sceneHeadings,
    looksLikeScreenplay: characters.length >= 2 && sceneHeadings.length >= 2,
    usedLayout: useLayout,
  };
}

/**
 * A cue with speech is a role, including a day player who speaks once.
 * A one-word name that shows up once is a title card, not a person.
 */
function isSpeakingRole(c: ParsedCharacter, fullText: string): boolean {
  if (!c.name || c.dialogueChars < 1) return false;
  if (c.name.includes("&") || /\bVISION\b/.test(c.name)) return false;
  if (c.cues >= 2 || countOccurrences(fullText, c.name) >= 2) return true;
  const words = c.name.split(/\s+/).filter(Boolean);
  return words.length >= 2 && c.dialogueChars >= 20;
}

function countOccurrences(haystack: string, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return haystack.match(new RegExp(`\\b${escaped}\\b`, "g"))?.length ?? 0;
}

/** Role tiers, assigned from share of total dialogue. */
export type Tier = "LEAD" | "SUPPORTING" | "DAY PLAYER";

export function assignTiers(characters: ParsedCharacter[]): Map<string, Tier> {
  const total = characters.reduce((sum, c) => sum + c.cues, 0) || 1;
  const tiers = new Map<string, Tier>();
  let leads = 0;
  for (const character of characters) {
    const share = character.cues / total;
    if (share >= 0.08 && leads < 4) {
      tiers.set(character.name, "LEAD");
      leads++;
    } else if (share >= 0.015) {
      tiers.set(character.name, "SUPPORTING");
    } else {
      tiers.set(character.name, "DAY PLAYER");
    }
  }
  return tiers;
}

/**
 * How long a description runs, in characters, by tier.
 *
 * Characters rather than sentences, because a sentence is not a fixed unit of
 * content: in the fragment style this house uses, a sentence averages 58
 * characters; in clause style, 99. Capping sentences therefore caps how much
 * can be said by a factor that swings with writing style, and penalises
 * exactly the style we are trying to reach.
 *
 * Measured from the corpus, at roughly its p75 so the ceiling sits above the
 * median rather than under it. The old sentence ceilings (5/4/2) were below the
 * corpus median for every tier — day players were capped at half the length
 * real ones run to, which no amount of prompt work would have fixed.
 */
export const DESCRIPTION_BUDGET: Record<Tier, number> = {
  LEAD: 700,
  SUPPORTING: 520,
  "DAY PLAYER": 380,
};

/**
 * What a tier is called in the market being cast for.
 *
 * Australian breakdowns have no CO-STAR or DAY PLAYER — per lib/locale.ts, BIT
 * PLAYER is an MEAA engagement class rather than something a casting director
 * writes, so small speaking roles sit under SUPPORTING and the vocabulary is
 * flatter than the US set.
 *
 * The tier stays internal either way, because it also sets the sentence
 * ceiling: a one-scene Australian SUPPORTING role still wants a sentence or
 * two rather than four, which is exactly what the tier already encodes.
 */
export function roleTypeLabel(tier: Tier, locale: "us" | "au"): string {
  if (locale === "au" && tier === "DAY PLAYER") return "SUPPORTING";
  return tier;
}

/**
 * The evidence a model needs to describe one character.
 *
 * A casting description answers: what do they do, who are they to the other
 * characters, what are they like to deal with. None of that is in a character's
 * own dialogue, so the bundle is built from how the script introduces them,
 * what other characters say about them, and where they turn up.
 *
 * One section was tried and removed: a list of who shares scenes with them.
 * It read as a hint about the character rather than about the scene, and a
 * lead came back described as Japanese because the businessman he shares
 * twenty pages with is. Anything in this bundle that is not about THIS person
 * will end up in their description.
 */
export function buildEvidence(
  script: ParsedScript,
  character: ParsedCharacter,
  charBudget: number,
): { text: string; identity: string } {
  const parts: string[] = [];

  const described = describedIn(script, character.name);
  if (described.length) {
    parts.push(`How the script describes them:\n${described.join("\n")}`);
  }

  const mentions = mentionsOf(script, character);
  if (mentions.length) {
    parts.push(`What other characters say about them:\n${mentions.join("\n")}`);
  }

  const world = settingsFor(script, character);
  if (world.length) parts.push(`Where they turn up:\n${world.join("\n")}`);

  const wanted = 8;
  const step = Math.max(1, Math.floor(character.blocks.length / wanted));
  const sampled: DialogueBlock[] = [];
  for (let i = 0; i < character.blocks.length && sampled.length < wanted; i += step) {
    sampled.push(character.blocks[i]);
  }
  if (sampled.length) {
    parts.push(`What they say:\n${sampled.map((b) => `(p${b.page}) ${b.text}`).join("\n")}`);
  }

  let out = parts.join("\n\n");
  if (out.length > charBudget) out = `${out.slice(0, charBudget)}…`;

  // Identity evidence is the subset that can justify a demographic claim: how
  // the script describes them, and what others say about them. Deliberately not
  // the settings — "INT. TOKYO OFFICE" is not evidence that a character is
  // Japanese, and treating it as such is how a lead got the wrong ethnicity.
  const identity = [...described, ...mentions].join("\n");

  return { text: out, identity };
}

/**
 * The token to look for when another character mentions this one. Dialogue
 * writes "Mal", not "MAL", so matching is case-insensitive on the most
 * distinctive word of the cue name — "PELL" out of "NURSE PELL".
 */
function mentionToken(name: string): string | null {
  // Drop YOUNG / OLDER so "YOUNG HOLT" does not key off YOUNG and match every
  // line that says "young". The personal name is what other characters use.
  const words = withoutAgePrefix(name)
    .split(/\s+/)
    .filter((w) => w.length >= 3 && /^[A-Z][A-Z'’.-]*$/.test(w));
  if (!words.length) return null;
  const token = words.reduce((a, b) => (b.length > a.length ? b : a));
  const GENERIC = new Set(["MAN", "BOY", "GIRL", "COP", "KID", "GUY", "DOC", "MOM", "DAD", "SON"]);
  if (GENERIC.has(token)) return null;
  return token.replace(/[.'’]/g, "");
}

/**
 * Lines spoken by other characters that name this one.
 *
 * This is where a script says what somebody does for a living and who they are
 * to everyone else — "she's my wife", "ask the architect" — none of which a
 * character ever says about themselves.
 */
function mentionsOf(script: ParsedScript, character: ParsedCharacter): string[] {
  const token = mentionToken(character.name);
  if (!token) return [];
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Age-variant cards: only lines that also mark the age, so the adult's
  // dialogue does not fill the child's "what others say" section.
  const pattern = isAgeVariantName(character.name)
    ? new RegExp(
        `\\b(?:${VERSION_PREFIXES.join("|")})\\s+[^.!?]{0,40}\\b${escaped}\\b|\\b${escaped}\\b[^.!?]{0,40}\\b(?:${VERSION_PREFIXES.join("|").toLowerCase()}|kid|child|boy|girl)\\b`,
        "i",
      )
    : new RegExp(`\\b${escaped}\\b`, "i");

  const found: string[] = [];
  for (const other of script.characters) {
    if (other.name === character.name) continue;
    // The adult and the child are the same person at different ages — do not
    // quote one on the other's card.
    if (samePersonBase(other.name, character.name)) continue;
    for (const block of other.blocks) {
      if (!pattern.test(block.text)) continue;
      found.push(`${other.name}: "${block.text.slice(0, 160)}"`);
      if (found.length >= 5) return found;
    }
  }
  return found;
}

/** The scene headings on the pages where this character speaks — their world. */
function settingsFor(script: ParsedScript, character: ParsedCharacter): string[] {
  const pages = new Set(character.pages);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const heading of script.sceneHeadings) {
    if (!pages.has(heading.page)) continue;
    const key = heading.text.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(heading.text);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Words a screenplay uses when it is describing a person rather than moving
 * them. Shared with the evidence inspector so the two don't drift.
 */
const LOOK =
  /\b(\d{1,2}s?\b|teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|twenties|thirties|forties|fifties|sixties|seventies|eighties|young|old|elderly|middle[- ]aged|aged|boy|girl|kid|child|baby|man|woman|guy|lady|gentleman|tall|short|thin|thick|slim|slight|lean|heavy|stocky|broad|small|big|wiry|gaunt|weathered|handsome|beautiful|pretty|plain|grey|gray|greying|blonde?|brunette|red[- ]haired|bald|beard|moustache|mustache|stubble|hair|eyes|face|skin|scar|tattoo|limp|suit|uniform|dress|coat|jacket|boots|glasses|voice|accent|drawl|growl|whisper)\b/i;

/**
 * A caps billing for a different actor playing the same character at another
 * age. YOUNG HOLT is not HOLT — Happy Gilmore as a child in a flashback is a
 * separate day player from the adult lead. The adult's evidence must not take
 * the child's look, and the child must still appear as their own role.
 */
const VERSION_PREFIX = /^(YOUNG|OLDER|OLD|LITTLE|BABY|TEENAGE|TEEN)$/;
const VERSION_PREFIXES = ["YOUNG", "OLDER", "OLD", "LITTLE", "BABY", "TEENAGE", "TEEN"] as const;

const CAPS_RUN = /\b[A-Z][A-Z0-9'’.-]*(?:\s+[A-Z][A-Z0-9'’.-]*)*\b/g;

/** Strip a leading YOUNG / OLDER / … so the personal name can be compared. */
function withoutAgePrefix(name: string): string {
  const words = name.split(/\s+/);
  while (words.length > 1 && VERSION_PREFIX.test(words[0])) words.shift();
  return words.join(" ");
}

export function isAgeVariantName(name: string): boolean {
  const words = name.split(/\s+/);
  return words.length >= 2 && VERSION_PREFIX.test(words[0]);
}

/** True when YOUNG HAPPY GILMORE and HAPPY (or HAPPY GILMORE) are the same person at different ages. */
function samePersonBase(a: string, b: string): boolean {
  const left = withoutAgePrefix(a);
  const right = withoutAgePrefix(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.startsWith(`${right} `) || right.startsWith(`${left} `)) return true;
  const leftFirst = left.split(/\s+/)[0];
  const rightFirst = right.split(/\s+/)[0];
  return leftFirst.length >= 3 && leftFirst === rightFirst;
}

/**
 * Billings like YOUNG HOLT or YOUNG HAPPY GILMORE found in action, for people
 * who already speak under the adult cue. They often never get a dialogue cue
 * of their own — the flashback is silent, or they share a cue name — but a
 * casting breakdown still needs a separate card.
 */
function promoteAgeVariants(
  actionLines: { page: number; text: string }[],
  speaking: ParsedCharacter[],
): ParsedCharacter[] {
  if (!speaking.length) return [];

  const prefixAlt = VERSION_PREFIXES.join("|");
  // YOUNG HOLT / YOUNG HAPPY GILMORE — one or more caps words after the prefix.
  const billing = new RegExp(`\\b(?:${prefixAlt})(?:\\s+[A-Z][A-Z0-9'’.-]+){1,4}\\b`, "g");
  const byVariant = new Map<string, ParsedCharacter>();

  for (const line of actionLines) {
    billing.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = billing.exec(line.text))) {
      const name = match[0].replace(/\s+/g, " ").trim();
      if (!isAgeVariantName(name)) continue;
      if (!speaking.some((s) => samePersonBase(name, s.name))) continue;
      if (speaking.some((s) => s.name === name)) continue;

      const existing = byVariant.get(name) ?? {
        name,
        pages: [],
        cues: 0,
        dialogueChars: 0,
        blocks: [],
      };
      if (!existing.pages.includes(line.page)) existing.pages.push(line.page);
      // Seed one block from the introduction so buildEvidence has pages and
      // describedIn has something to score. Not dialogue — just presence.
      if (existing.blocks.length < 3 && passageScore(line.text, name) > 0) {
        existing.blocks.push({ page: line.page, text: line.text.slice(0, 400) });
      }
      byVariant.set(name, existing);
    }
  }

  return [...byVariant.values()].filter((c) => c.pages.length > 0);
}

const NOT_A_NAME = new Set([
  "THE", "AND", "BUT", "FOR", "HER", "HIS", "SHE", "HIM", "YOU", "ARE", "WAS",
  "NOT", "INT", "EXT", "DAY", "NIGHT", "LATER", "MOMENTS", "CONTINUOUS", "SAME",
  "BACK", "ANGLE", "POV", "CLOSE", "WIDE", "NEW", "NOW", "THEN", "ALL", "OFF",
  "OUT", "INTO", "FROM", "WITH", "THAT", "THIS", "THEY", "THEM", "HAVE", "BEEN",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when this sentence is about this character's billing, not another age
 * of them. HOLT does not match YOUNG HOLT; YOUNG HOLT matches only that form
 * (or the same words with an extra surname).
 */
export function mentionsCharacter(text: string, name: string): boolean {
  const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 40), match.index);
    const tail = before.match(/([A-Z][A-Z'’.-]*(?:\s+[A-Z][A-Z'’.-]*)*)\s*$/);
    const prior = tail?.[1].split(/\s+/) ?? [];
    // Adult role: skip a match that is really YOUNG HOLT / LITTLE MARA.
    if (!isAgeVariantName(name) && prior.some((word) => VERSION_PREFIX.test(word))) continue;
    // Age-variant role: the match is already the full YOUNG HOLT billing.
    return true;
  }

  // YOUNG HAPPY should also take "YOUNG HAPPY GILMORE" when the cue was short.
  if (isAgeVariantName(name)) {
    const longer = new RegExp(
      `\\b${escapeRegExp(name)}(?:\\s+[A-Z][A-Z0-9'’.-]+)+\\b`,
    );
    if (longer.test(text)) return true;
  }
  return false;
}

/** True when the sentence carries an age, a build, clothes, or a voice. */
export function carriesLook(text: string): boolean {
  return LOOK.test(text);
}

/**
 * Another character is named here. A longer billing of the same age
 * ("HAPPY GILMORE" for HAPPY) is not someone else. A different age
 * ("YOUNG HOLT" for HOLT) is — that look belongs on the other card.
 */
function namesSomeoneElse(text: string, name: string): boolean {
  const runs = text.match(CAPS_RUN) ?? [];
  return runs.some((run) => {
    if (run.length < 3 || NOT_A_NAME.has(run) || run === name) return false;
    if (samePersonBase(run, name) && isAgeVariantName(run) !== isAgeVariantName(name)) {
      return true;
    }
    if (run.startsWith(`${name} `) || run.endsWith(` ${name}`)) {
      const extra = run.startsWith(`${name} `)
        ? run.slice(name.length).trim()
        : run.slice(0, run.length - name.length).trim();
      // Surname or middle name on the same billing — still this person.
      if (!extra.split(/\s+/).some((word) => VERSION_PREFIX.test(word))) return false;
      return true;
    }
    return !samePersonBase(run, name);
  });
}

/**
 * How much this sentence tells a casting director who the person is.
 * Blocking ("HOLT drags the gate") scores nothing and is not passed on.
 */
function passageScore(text: string, name: string): number {
  if (!mentionsCharacter(text, name)) return 0;
  const escaped = escapeRegExp(name);
  // "MARA VOSS," and "WALT the COOK," are introductions. "MARA sits" is not.
  // "(YOUNG HAPPY GILMORE)" is the flashback reveal form — the look is written
  // before the billing, so the comma test alone would miss it.
  const introduced =
    new RegExp(
      `\\b${escaped}\\b(?:\\s+(?:[A-Z][A-Z'’.-]+|the|a|an))*\\s*[,(\\[]`,
    ).test(text) || new RegExp(`\\(\\s*${escaped}\\s*\\)`).test(text);
  // "DUKE LETO ATREIDES in ceremonial noble dress" — a portrait with no comma.
  // "RENNA sits … with her boots hanging" is still blocking: a movement verb
  // plus one clothing word is not an introduction.
  const portrait =
    new RegExp(`\\b(?:[A-Z][A-Z'’.-]+\\s+){0,4}${escaped}(?:\\s+[A-Z][A-Z'’.-]+){0,3}\\b`).test(
      text,
    ) &&
    carriesLook(text) &&
    !/\b(sits|stands|walks|crosses|lunges|runs|turns|grabs|holds|picks|shrugs)\b/i.test(text);
  const thisIs = new RegExp(`\\bthis is\\s+${escaped}\\b`, "i").test(text);
  const nameAt = text.search(new RegExp(`\\b${escaped}\\b`));
  const lookAt = text.search(new RegExp(LOOK.source, "i"));
  // A look that lands before the name belongs to whoever came first — unless
  // this is the parenthetical reveal ("a six year old kid (YOUNG HAPPY)").
  if (!introduced && !thisIs && !portrait && (lookAt === -1 || nameAt > lookAt)) return 0;

  let score = 0;
  if (introduced || portrait) score += 4;
  if (thisIs) score += 3;
  const hits = text.match(new RegExp(LOOK.source, "gi"));
  score += Math.min(hits?.length ?? 0, 4);
  // One clothing word in a blocking line ("sits with her boots hanging") is
  // not a description. An introduction is. So are two facts about the person
  // ("tall and thin", "grey suit").
  if (!introduced && !thisIs && !portrait && score < 2) return 0;
  return score;
}

/**
 * The passages that actually describe this character.
 *
 * The first lines that contain a name are usually blocking, a wrapped
 * fragment, or another age of them ("YOUNG HOLT" for HOLT). Taking those and
 * stopping — which is what this used to do — handed the model movement and
 * the wrong face, then the prompt told it to invent nothing. The description
 * came back empty or about the child when the card was for the adult.
 *
 * A passage qualifies when the sentence introduces them (a comma billing, or
 * "this is NAME") or says how they look. The next sentence or two in the same
 * action run comes with it, which is where a wrapped line hides the age.
 * Pure blocking is left out.
 */
export function describedIn(script: ParsedScript, name: string, limit = 4): string[] {
  const lines = script.actionLines;
  const clusters: { page: number; text: string; score: number; end: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (passageScore(lines[i].text, name) === 0) continue;

    let start = i;
    const escaped = escapeRegExp(name);
    const thisIs = new RegExp(`\\bthis is\\s+${escaped}\\b`, "i").test(lines[i].text);
    if (i > 0 && lines[i - 1].run === lines[i].run && thisIs) {
      const prev = lines[i - 1];
      if (!namesSomeoneElse(prev.text, name) && carriesLook(prev.text)) start = i - 1;
    }

    let end = i;
    let chars = lines.slice(start, end + 1).reduce((sum, line) => sum + line.text.length, 0);
    let followed = 0;
    while (end + 1 < lines.length && followed < 2) {
      const next = lines[end + 1];
      if (next.run !== lines[i].run) break;
      if (namesSomeoneElse(next.text, name)) break;
      // "RENNA crosses to the shelving" is the same person and still not a
      // description. A continuation ("She has been thirty-four...") does not
      // open on the name.
      const opensOnName = new RegExp(`^${escaped}\\b`).test(next.text);
      if (opensOnName && passageScore(next.text, name) === 0) break;
      if (chars + next.text.length > 520) break;
      end++;
      followed++;
      chars += next.text.length;
    }

    const text = lines
      .slice(start, end + 1)
      .map((line) => line.text)
      .join(" ");
    clusters.push({ page: lines[start].page, text, score: passageScore(text, name), end });
    i = end;
  }

  return clusters
    .sort((a, b) => b.score - a.score || a.page - b.page)
    .slice(0, limit)
    .sort((a, b) => a.page - b.page)
    .map((cluster) => `(p${cluster.page}) ${cluster.text.slice(0, 600)}`);
}

/** Title Case a cue name for display: "HAPPY GILMORE" -> "Happy Gilmore". */
export function displayName(cue: string): string {
  return cue
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(Mr|Mrs|Ms|Dr|Sgt|Lt|Capt)\b/g, (m) => `${m}.`)
    .replace(/\.\./g, ".");
}
