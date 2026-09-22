/**
 * Deterministic screenplay parsing for the private path.
 *
 * A 3B model asked to "list every character with accurate page numbers" over a
 * 105-page feature does not do it — it cannot hold the script, and page numbers
 * become guesses. But a screenplay is a formatted document: character cues are
 * centred ALL-CAPS lines immediately above dialogue. Extracting the cast from
 * that formatting is exact, free, and needs no model at all.
 *
 * So the model is never asked who is in the script. It is only asked to
 * describe a character it is handed, from lines it is handed. That is the one
 * job a small model can actually do.
 *
 * The heuristics are screenplay-specific. `looksLikeScreenplay` reports whether
 * they applied; callers fall back to a model pass for documents (casting
 * one-pagers, commercial boards) that carry no cue formatting.
 */

export interface DialogueBlock {
  page: number;
  /** Dialogue as spoken, parentheticals removed. */
  text: string;
}

export interface ParsedCharacter {
  /** Cue name, normalised: "MRS. GILMORE" -> "Mrs. Gilmore" is done at render time. */
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
  characters: ParsedCharacter[];
  /** Scene headings with their page, in order. The script's skeleton. */
  sceneHeadings: { page: number; text: string }[];
  looksLikeScreenplay: boolean;
}

const SCENE_HEADING = /^(INT\.?|EXT\.?|INT\.?\/EXT\.?|I\/E|EST\.?)[\s.]/;
const TRANSITION =
  /^(FADE (IN|OUT|TO)|CUT TO|SMASH CUT|MATCH CUT|DISSOLVE|WIPE TO|BACK TO|INTERCUT|THE END|CONTINUED|OMITTED|TITLE|SUPER|MAIN TITLES?|END CREDITS|MONTAGE|SERIES OF SHOTS)\b/;
const PAGE_MARKER = /^\(?(CONTINUED|MORE|CONT'D|CONT’D)\)?$/;
/** Trailing cue qualifiers: BOB (V.O.), BOB (CONT'D), BOB (O.S.) */
const CUE_QUALIFIER = /\s*\((V\.?O\.?|O\.?S\.?|O\.?C\.?|CONT'?’?D|PRE-?LAP|FILTERED|ON (TV|RADIO|PHONE))\)\s*$/gi;

/** A speech is a few lines. Capping it bounds how much action can leak in. */
const MAX_DIALOGUE_LINES = 6;
const MAX_DIALOGUE_CHARS = 400;

function isUpperCase(line: string): boolean {
  return /[A-Z]/.test(line) && line === line.toUpperCase();
}

/** True for a line that reads like a character cue rather than action. */
function looksLikeCue(line: string): boolean {
  const bare = line.replace(CUE_QUALIFIER, "").trim();
  if (!bare || bare.length > 40) return false;
  if (!isUpperCase(bare)) return false;
  if (SCENE_HEADING.test(bare) || TRANSITION.test(bare) || PAGE_MARKER.test(bare)) return false;
  // Cues are names, not sentences, and never end in terminal punctuation.
  if (/[.!?,:;]$/.test(bare)) return false;
  if (bare.split(/\s+/).length > 5) return false;
  // Reject anything that is mostly digits — page numbers, scene numbers.
  if (!/[A-Z]{2}/.test(bare)) return false;
  return true;
}

/** Cue name without qualifiers, used as the identity of a character. */
function cueName(line: string): string {
  return line
    .replace(CUE_QUALIFIER, "")
    .replace(/\s*\(.*\)\s*$/, "")
    .replace(/[\s*]+$/, "")
    .trim();
}

function isParenthetical(line: string): boolean {
  return /^\(.*\)?$/.test(line.trim());
}

/**
 * Walk each page's lines, collecting cue -> dialogue pairs.
 *
 * A cue only counts when the next non-empty line is dialogue: real action lines
 * in caps ("BANG!", "LATER THAT NIGHT") are followed by blank lines or more
 * action, so this filter removes most of them without a name list.
 */
export function parseScript(pages: string[]): ParsedScript {
  const byName = new Map<string, ParsedCharacter>();
  const sceneHeadings: { page: number; text: string }[] = [];
  const fullText = pages.join("\n");

  pages.forEach((pageText, index) => {
    const pageNumber = index + 1;
    const lines = pageText.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (SCENE_HEADING.test(line) && isUpperCase(line)) {
        sceneHeadings.push({ page: pageNumber, text: line.slice(0, 120) });
        continue;
      }

      if (!looksLikeCue(line)) continue;

      // Collect the dialogue that follows.
      //
      // It stops at the next cue or scene heading rather than at a blank line,
      // because extracted PDF text has no blank lines: pdf.js emits no text
      // item for an empty line, so the paragraph breaks that are obvious in the
      // PDF are simply absent here. That also means an action line following a
      // speech can be swallowed into it, so the capture is capped — a speech is
      // a few lines, and the cap bounds how much action can leak in.
      const spoken: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const firstFollowing = lines[j]?.trim() ?? "";
      if (!firstFollowing) continue;
      if (looksLikeCue(firstFollowing) || SCENE_HEADING.test(firstFollowing)) continue;
      // All-caps under an all-caps line is action, not dialogue.
      if (isUpperCase(firstFollowing) && !isParenthetical(firstFollowing)) continue;

      let taken = 0;
      let chars = 0;
      while (j < lines.length && taken < MAX_DIALOGUE_LINES && chars < MAX_DIALOGUE_CHARS) {
        const next = lines[j].trim();
        if (!next) break;
        if (looksLikeCue(next) || SCENE_HEADING.test(next)) break;
        if (!isParenthetical(next) && !PAGE_MARKER.test(next)) {
          spoken.push(next);
          chars += next.length;
        }
        taken++;
        j++;
      }

      const text = spoken.join(" ").trim();
      if (!text) {
        i = j - 1;
        continue;
      }

      const name = cueName(line);
      if (!name) continue;

      const existing = byName.get(name) ?? {
        name,
        pages: [],
        cues: 0,
        dialogueChars: 0,
        blocks: [],
      };
      existing.cues += 1;
      existing.dialogueChars += text.length;
      if (!existing.pages.includes(pageNumber)) existing.pages.push(pageNumber);
      existing.blocks.push({ page: pageNumber, text });
      byName.set(name, existing);

      i = j - 1;
    }
  });

  // A stray all-caps action line ("BANG", "LATER") can pick up the prose under
  // it and look like a one-line role. A real character recurs: they are
  // introduced in action and then speak, or they speak more than once. So a
  // single cue only counts when the name appears elsewhere in the script too.
  const characters = [...byName.values()]
    .filter((c) => c.dialogueChars >= 20)
    .filter((c) => c.cues >= 2 || countOccurrences(fullText, c.name) >= 2)
    .sort((a, b) => b.cues - a.cues || b.dialogueChars - a.dialogueChars);

  return {
    pages,
    characters,
    sceneHeadings,
    looksLikeScreenplay: characters.length >= 2 && sceneHeadings.length >= 2,
  };
}

function countOccurrences(haystack: string, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return haystack.match(new RegExp(`\\b${escaped}\\b`, "g"))?.length ?? 0;
}

/** Role tiers, assigned from share of total dialogue. */
export type Tier = "LEAD" | "SUPPORTING" | "DAY PLAYER";

export function assignTiers(characters: ParsedCharacter[]): Map<string, Tier> {
  // Ranked on how often a character speaks rather than how many characters of
  // dialogue they have: cue counts survive the action-line leakage described in
  // parseScript, total dialogue length does not.
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

/** Sentence ceilings by tier, from the house style in the reference corpus. */
export const SENTENCE_CEILING: Record<Tier, number> = {
  LEAD: 5,
  SUPPORTING: 4,
  "DAY PLAYER": 2,
};

/**
 * The evidence a model needs to describe one character.
 *
 * The first version of this handed over an introduction line and a spread of
 * dialogue, and the descriptions that came back were scene summaries: "A quiet,
 * introspective woman who stares out at the sea, lost in thought." That is not
 * the model failing to follow instructions. It is the model reporting what it
 * was given — an action beat — because nothing in front of it said who the
 * person was.
 *
 * A casting description answers: what do they do, who are they to the other
 * characters, and what are they like to deal with. None of that is in a
 * character's own dialogue. It is in how the script introduces them, what other
 * characters say about them, and where they turn up. So that is what gets
 * collected here, and the model's job drops from inventing a person to
 * compressing evidence — which is a job a 3B model can do.
 */
export function buildEvidence(
  script: ParsedScript,
  character: ParsedCharacter,
  charBudget: number,
): string {
  const parts: string[] = [];

  const intro = findIntroduction(script.pages, character.name);
  if (intro) parts.push(`How the script introduces them:\n${intro}`);

  const mentions = mentionsOf(script, character);
  if (mentions.length) {
    parts.push(`What other characters say about them:\n${mentions.join("\n")}`);
  }

  const world = settingsFor(script, character);
  if (world.length) parts.push(`Where they turn up:\n${world.join("\n")}`);

  const withWhom = sharesScenesWith(script, character);
  if (withWhom.length) parts.push(`On the page with: ${withWhom.join(", ")}`);

  const wanted = 8;
  const step = Math.max(1, Math.floor(character.blocks.length / wanted));
  const sampled: DialogueBlock[] = [];
  for (let i = 0; i < character.blocks.length && sampled.length < wanted; i += step) {
    sampled.push(character.blocks[i]);
  }
  if (sampled.length) {
    parts.push(
      `What they say:\n${sampled.map((b) => `(p${b.page}) ${b.text}`).join("\n")}`,
    );
  }

  let out = parts.join("\n\n");
  if (out.length > charBudget) out = `${out.slice(0, charBudget)}…`;
  return out;
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
  // Generic cue names ("MAN", "COP") match half the script and prove nothing.
  const GENERIC = new Set(["MAN", "BOY", "GIRL", "COP", "KID", "GUY", "DOC", "MOM", "DAD", "SON"]);
  if (GENERIC.has(token)) return null;
  return token.replace(/[.'’]/g, "");
}

/**
 * Lines spoken by other characters that name this one.
 *
 * This is where a script says what somebody does for a living and who they are
 * to everyone else — "She's my wife", "ask the doctor", "that's Reema's
 * brother" — none of which a character ever says about themselves.
 */
function mentionsOf(script: ParsedScript, character: ParsedCharacter): string[] {
  const token = mentionToken(character.name);
  if (!token) return [];
  const pattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

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

/** Characters who speak on the same pages, most-shared first. */
function sharesScenesWith(script: ParsedScript, character: ParsedCharacter): string[] {
  const pages = new Set(character.pages);
  return script.characters
    .filter((other) => other.name !== character.name)
    .map((other) => ({ name: other.name, shared: other.pages.filter((p) => pages.has(p)).length }))
    .filter((entry) => entry.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, 3)
    .map((entry) => `${entry.name} (${entry.shared} page${entry.shared === 1 ? "" : "s"})`);
}

/**
 * A character's introduction — the action line that first names them in caps,
 * which in a screenplay is where age, look and occupation are written down
 * ("MARA VOSS, late thirties, an unhurried paramedic...").
 *
 * The name must appear in caps in a line that also runs in prose: that
 * combination is the screenplay convention for introducing someone, and it is
 * what separates a real introduction from a line that merely mentions them.
 *
 * Matched on the line rather than the paragraph, because extracted PDF text has
 * no blank lines and paragraphs do not survive extraction.
 */
function findIntroduction(pages: string[], name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const capsMention = new RegExp(`\\b${escaped}\\b`);
  for (const page of pages) {
    const lines = page.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length < 25) continue;
      if (!capsMention.test(line)) continue;
      if (!/[a-z]/.test(line)) continue; // all caps: a cue or a transition
      if (looksLikeCue(line)) continue;
      const next = lines[i + 1]?.trim() ?? "";
      const extra = next && /[a-z]/.test(next) && !looksLikeCue(next) ? ` ${next}` : "";
      return `${line}${extra}`.slice(0, 600);
    }
  }
  return null;
}

/** Title Case a cue name for display: "HAPPY GILMORE" -> "Happy Gilmore". */
export function displayName(cue: string): string {
  return cue
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(Mr|Mrs|Ms|Dr|Sgt|Lt|Capt)\b/g, (m) => `${m}.`)
    .replace(/\.\./g, ".");
}
