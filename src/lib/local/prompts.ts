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

An agent reads it to decide which of their clients to send. Write only what
helps them decide.

Say what the character does, who they are to the other characters, how they
treat people, and what they want. Use the facts in the text in front of you.
A concrete detail from the text beats an adjective.

Do not write like a novel. Never write "carries himself", "carries herself",
"an air of", "exudes", "a deep sense of", "his gaze", "her smile is",
"a voice of reason" or "moral compass". Do not describe clothes, eyes, smiles
or posture unless the part actually requires it.

Do not retell the plot. Never write "in the story", "his journey", "we learn",
"by the end", "serves as", "represents" or "the audience".

Stop as soon as you run out of things that are true. A short description is a
good description. Never add a sentence to make it longer.

Fill gender, ageRange and ethnicity only when the text says or plainly shows
them. Otherwise return "" for that field. Never guess ethnicity.

Two examples of the voice, from other scripts:

{"gender":"Woman","ageRange":"30 to 40 years old","ethnicity":"","description":"A blunt, unhurried paramedic who has stopped being impressed by emergencies. Dry to the point of rudeness with colleagues, unexpectedly gentle with patients.","traits":["dry wit","driving"]}

{"gender":"Man","ageRange":"60s","ethnicity":"","description":"Night dispatcher, twenty-two years in the chair, proud of every shortcut he has ever invented. Wants to be thanked once before he retires.","traits":["deadpan"]}`;

/**
 * The length instruction is a phrase, never the ceiling number.
 *
 * Handed "at most 5 sentences", a 3B model writes five and pads to get there.
 * The ceiling is enforced in code instead — see tightenDescription — so it can
 * stay a limit rather than becoming a target.
 */
export function descriptionUser(
  name: string,
  lengthHint: string,
  excerpts: string,
): string {
  return `Character: ${name}

${excerpts}

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
