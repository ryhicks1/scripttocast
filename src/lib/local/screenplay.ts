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
  /** Action lines only, per page — where a script describes people. */
  actionLines: { page: number; text: string }[];
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
  const actionLines: { page: number; text: string }[] = [];
  const pages = pageLines.map((lines) => lines.map((line) => line.text).join("\n"));
  const fullText = pages.join("\n");

  pageLines.forEach((lines, index) => {
    const pageNumber = index + 1;

    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].text.trim();
      if (!text) continue;
      const kind = classify(lines[i], useLayout);

      if (kind === "scene") {
        sceneHeadings.push({ page: pageNumber, text: text.slice(0, 120) });
        continue;
      }
      if (kind === "action") {
        if (text.length >= 20 && !TRANSITION.test(text) && !PAGE_MARKER.test(text)) {
          actionLines.push({ page: pageNumber, text });
        }
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
  });

  // A stray all-caps line can pick up the prose under it and look like a
  // one-line role. A real character recurs: introduced in action, then speaks.
  const characters = [...byName.values()]
    .filter((c) => c.dialogueChars >= 20)
    .filter((c) => c.cues >= 2 || countOccurrences(fullText, c.name) >= 2)
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
  const words = name.split(/\s+/).filter((w) => w.length >= 3 && /^[A-Z][A-Z'’.-]*$/.test(w));
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
  const pattern = new RegExp(`\\b${escaped}\\b`, "i");

  const found: string[] = [];
  for (const other of script.characters) {
    if (other.name === character.name) continue;
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
 * A character's introduction — the action line that first names them in caps,
 * which in a screenplay is where age, look and occupation are written down
 * ("MARA VOSS, late thirties, an unhurried paramedic...").
 *
 * Searched in action lines only. A dialogue line that happens to name them is
 * somebody talking, not the script describing them.
 */
export function describedIn(script: ParsedScript, name: string, limit = 6): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const capsMention = new RegExp(`\\b${escaped}\\b`);
  const found: string[] = [];

  for (const line of script.actionLines) {
    if (!capsMention.test(line.text)) continue;
    if (!/[a-z]/.test(line.text)) continue; // all caps: a cue or a transition
    found.push(`(p${line.page}) ${line.text.slice(0, 400)}`);
    if (found.length >= limit) break;
  }
  return found;
}

/** Title Case a cue name for display: "HAPPY GILMORE" -> "Happy Gilmore". */
export function displayName(cue: string): string {
  return cue
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(Mr|Mrs|Ms|Dr|Sgt|Lt|Capt)\b/g, (m) => `${m}.`)
    .replace(/\.\./g, ".");
}
