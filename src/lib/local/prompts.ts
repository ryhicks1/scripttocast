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
 * No worked examples, deliberately.
 *
 * An earlier version ended with three example descriptions in the house style.
 * Two roles in the next run came back as those examples, word for word —
 * "Small town organised crime enforcer... whose first language is violence" was
 * prompt text, printed as a character. A small model with thin evidence copies
 * the most fluent thing in its context, and a vivid example is exactly that.
 *
 * So the shape is described rather than demonstrated, the JSON shape is
 * enforced by the response schema instead of shown, and pipeline.ts rejects any
 * description that shares wording with this prompt.
 */
export const DESCRIPTION_SYSTEM = `You turn evidence about one character into a casting breakdown description.

An agent reads it to decide which of their clients to put forward.

Write in this order:
1. What they are — their job, their rank, or what they are to another character.
2. What they are like to deal with, in concrete terms.

Rules:
- Use only the evidence given below. Do not use anything you already know about
  this film, this script or these characters. If you recognise it, ignore that.
- If the evidence does not say what they do or who they are to other people,
  write only what it does support, in one sentence, and stop. Do not fill the
  space with adjectives.
- Never describe a scene, a moment, or what anyone is doing. Nothing "turns",
  "watches", "walks in", "stares", "is taken aback" or "pauses".
- Never mention another character except as a relationship, like "X's sister".
- Do not describe clothes, eyes, smiles or posture unless the part requires it.
- Never write "carries himself", "carries herself", "an air of", "exudes",
  "a deep sense of", "a voice of reason", "moral compass", "driven by a desire",
  "in the story", "his journey", "we learn", "by the end", "serves as",
  "represents" or "the audience".
- Never copy wording from these instructions.

Fill gender, ageRange and ethnicity only when the evidence states them outright.
Return "" for anything it does not. Never guess ethnicity, and never infer it
from a location, a name, or another character.`;

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
  evidence: string,
): string {
  return `Character: ${name}

Evidence from the script:
${evidence}

${lengthHint}`;
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
