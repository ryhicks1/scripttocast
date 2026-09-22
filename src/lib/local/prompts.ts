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

export const DESCRIPTION_SYSTEM = `You write one casting breakdown description for one character.

Describe the PERSON, not the plot: their temperament, how they carry
themselves, how they treat people, what they want.

Never retell what happens. Do not write "in the story", "his journey",
"we learn", "by the end", "serves as", "represents", or "the audience".
Do not describe scenes. Do not mention the plot.

Fill gender, ageRange and ethnicity only when the text says or plainly shows
them. Otherwise return "" for that field. Never guess ethnicity.

Example of the voice, for a different script:

{"gender":"Woman","ageRange":"30 to 40 years old","ethnicity":"","description":"A blunt, unhurried paramedic who has seen enough to stop being impressed. Dry to the point of rudeness with colleagues, unexpectedly gentle with patients. Wants to be left alone to do the job properly.","traits":["dry wit","medical procedural"]}`;

export function descriptionUser(
  name: string,
  maxSentences: number,
  excerpts: string,
): string {
  return `Character: ${name}

${excerpts}

Write at most ${maxSentences} sentence${maxSentences === 1 ? "" : "s"}. Fewer is better.`;
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
