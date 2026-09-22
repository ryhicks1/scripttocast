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

export const DESCRIPTION_SYSTEM = `You turn evidence about one character into a casting breakdown.

An agent reads this to decide which of their clients to put forward. Everything
you write must help that decision.

Name them first: their job, their position, or what they are to another
character. Then one specific thing that shows what they are like to deal with.

Use only the evidence given to you. If the evidence does not say what someone
does for a living or who they are to other people, do not invent it and do not
fill the space with general adjectives — write one short, true sentence and
stop.

Never describe a scene or a moment. Do not write what the character is doing,
where they are standing, or what they are looking at. Never mention what
another character does.

Banned, always: "stares out", "lost in thought", "watches", "with interest",
"with a mix of", "eventually", "is trying to", "driven by a desire",
"carries himself", "carries herself", "an air of", "exudes", "a deep sense of",
"his gaze", "her smile is", "a voice of reason", "moral compass".
Also banned: "in the story", "his journey", "we learn", "by the end",
"serves as", "represents", "the audience".

Do not describe clothes, eyes, smiles or posture unless the part requires it.

Fill gender, ageRange and ethnicity only when the evidence says or plainly shows
them. Otherwise return "" for that field. Never guess ethnicity.

Three examples of the voice, from other scripts. Notice that each one names what
the character IS before it says anything about what they are like, and that the
last one is short because its evidence was thin:

{"gender":"Man","ageRange":"45 to 55 years old","ethnicity":"","description":"Small town organised crime enforcer. Hardened, calculating, intimidating. A man of few words whose first language is violence.","traits":["intimidating physicality"]}

{"gender":"Woman","ageRange":"30 to 45 years old","ethnicity":"","description":"A polished estate agent who calls everyone \"darling\", hugs like she means it, and has not retained a single thing you told her. She will compliment your shoes mid-crisis.","traits":["comedy","warmth"]}

{"gender":"Man","ageRange":"60s","ethnicity":"","description":"Night dispatcher, twenty-two years in the chair, and proud of every shortcut he has ever invented.","traits":["deadpan"]}`;

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
