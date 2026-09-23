import type { ResolvedMode } from "../breakdown";
import type { Locale } from "../locale";
import { buildSystemPrompt } from "../prompts";

/**
 * Prompts for the private path, written for a 3B local model.
 *
 * These are deliberately NOT a shortened copy of src/lib/prompts.ts. That
 * prompt is ~100 lines of layered rules — a canonical format, sentence ceilings
 * that vary by tier, a list of banned constructions, several worked examples
 * and a cut test — and it is aimed at a frontier model asked to produce one
 * deeply nested object in a single shot. A 3B model will not hold it: it drops
 * the format, ignores the tiers, or returns a shape that parses and says
 * nothing.
 *
 * The design here instead is:
 *   - one small extraction per call, never the whole breakdown at once;
 *   - short flat instructions, one example, no conditionals;
 *   - anything a rule can decide is decided in code, not asked for. The
 *     canonical "[GENDER], [AGE], [ETHNICITY]. [DESCRIPTION]...[TYPE]" line is
 *     assembled by pipeline.ts from separate fields, so the model never has to
 *     remember a format. The sentence ceiling arrives as a single number.
 *
 * The example in the description prompt is invented rather than lifted from a
 * real script — a worked example taken from a script this tool is likely to be
 * pointed at comes back as output.
 */

export const PROJECT_SYSTEM = `You read the first pages of a script or casting document and pull out facts.

Only use facts that are written in the text. If something is not written there,
return "" for it. Never guess a name, a date or a place.`;

export function projectUser(fileName: string, headText: string): string {
  return `File name: ${fileName}

First pages:
---
${headText}
---

Return the project title, what kind of production it is, and any credited
names or places that appear above.`;
}

export const STORY_SYSTEM = `You write a one-sentence logline and a short synopsis for a script.

You are given the script's scene headings in order. They tell you where the
story goes. Write plainly. Do not invent characters or events.`;

export function storyUser(title: string, headings: string[]): string {
  return `Title: ${title || "Untitled"}

Scene headings, in order:
${headings.join("\n")}

logline: one sentence.
synopsis: three or four sentences.`;
}

/**
 * The style addendum and the one-role wrapper that used to live here are gone.
 *
 * They appended "WRITE IN FRAGMENTS" and "stop where the evidence stops" to a
 * house prompt that allows a lead about a hundred and ten words, and an 8B
 * model obeyed the nearer instruction: leads came back four words long. The
 * house prompt in src/lib/prompts.ts is now sent unmodified, and pipeline.ts
 * appends the script to it.
 *
 * Deliberately deleted rather than left unused. Every regression on this path
 * has come from rules that were written, committed, and then reconnected to a
 * prompt by someone who found them lying here.
 */

/**
 * The length instruction is a phrase, never the ceiling number.
 *
 * Handed "at most 5 sentences", a small model writes five and pads to get
 * there. The ceiling is enforced in code instead — see tightenDescription — so
 * it stays a limit rather than becoming a target.
 */
export function descriptionUser(
  name: string,
  lengthHint: string,
  usedOpenings: string[] = [],
): string {
  // Openings already spent on other roles in this same breakdown.
  //
  // A Dune run opened 17 of 38 roles with "A seasoned...". Nothing in a
  // single-role prompt can prevent that, because each call is blind to the
  // others — so the ones already used are handed forward. Cheaper and more
  // reliable than asking a model to be original.
  const avoid = usedOpenings.length
    ? `\n\nThese openings are already used by other roles in this same breakdown. Do not reuse them, and do not write a near-variant:\n${usedOpenings
        .map((o) => `- "${o}"`)
        .join("\n")}`
    : "";

  // The fields are spelled out HERE, in the last few hundred tokens before the
  // answer, because the house prompt that defines them now sits after an
  // entire screenplay. An 8B model generating under a JSON grammar that has
  // lost track of what a field is for fills it with an empty string — and the
  // one place it cannot lose track is the text right next to where it writes.
  //
  // Nothing here is in quotation marks. Every leak this path has had came from
  // a quoted phrase in the prompt turning up as a character's description.
  return `Character: ${name}

Write ${name}'s entry, from the script above.

Fill every field:
- description: who ${name} is, for an actor deciding whether to submit. What they are, who they are to the other characters, what they are like to deal with, and what the part asks of the actor. Include their age, look, bearing and voice where the script gives them. ${lengthHint} This field must never be empty.
- gender: as the script presents them.
- ageRange: only if the script states or clearly implies an age. Otherwise leave it empty.
- ethnicity: only if the script states it. Otherwise leave it empty.
- traits: three to six single words.

Do not retell scenes. Do not quote dialogue. Do not invent anything the script does not support.${avoid}`;
}

export const CAST_LIST_SYSTEM = `You list the roles that a casting document is asking to cast.

Only list roles that appear in the text. Do not invent roles. Do not list
crew, brands, companies or locations.`;

export function castListUser(chunk: string): string {
  return `Document section:
---
${chunk}
---

List the role names in this section.`;
}
