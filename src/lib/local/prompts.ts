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
 * The rules both prompts need, in one place.
 *
 * These once lived only in a second, leaner prompt kept for small models —
 * which is to say they were written, committed, and never sent, because every
 * run used the house prompt. A release went out with "A seasoned operative"
 * still in its output and not a fragment in sight. The lean prompt is gone and
 * these are appended to the one prompt there is.
 */
export const LOCAL_STYLE_RULES = `HOW IT IS WRITTEN — the part that goes wrong most often:

- WRITE IN FRAGMENTS. Nearly two thirds of the sentences in professional
  breakdowns have no verb in them at all: a job title alone, a run of two or
  three adjectives alone. Each is a whole sentence. A full sentence spends its
  words on grammar; a fragment spends them on the person.
- Fragments are for density, not brevity. Say MORE about the person in shorter
  units — not less. A description of four words is not a good fragment, it is
  an empty one.
- Open on a noun or an adjective. Never open with He is, She is, They are, or
  the character's name.
- Never open with the words seasoned, skilled or young. They say nothing, and
  they end up on every role in the breakdown.

PHYSICALITY. When the script says how a character looks, moves, carries
themselves or sounds, put it in, near the front, using the script's own words
about that character. Build, bearing, age in the face, how they hold
themselves, what their voice does. That is what an agent pictures, and it is
the difference between a description someone can cast from and a list of
adjectives.

Only what the evidence gives you. Never invent a look. Never carry a look
across from another character. If the script does not describe them, write
nothing about their appearance rather than reaching for something.

WHAT THE PART DEMANDS. At most one line of the kind a casting director writes
to an actor: what the performance has to carry, or what an actor must be able
to do. Only where the evidence supports it.

NEVER:
- Explain your reasoning or cite the script. Nothing has to be proved.
- Hedge. If the evidence does not support it, leave it out.
- Reach for stock phrasing about presence, understanding, bearing or air.
- Retell a scene, or describe what anyone is doing.
- Use any wording from these instructions. Every phrase here is about writing,
  not about your character. A phrase quoted above belongs to no one in your
  script.`;

/**
 * The house prompt, adapted to describing one role at a time.
 *
 * src/lib/prompts.ts is what the public path sends to claude-opus-5: the
 * canonical format, the tier ceilings, the banned constructions, the worked
 * examples, the cut test. The local path skipped it because a 3B model cannot
 * hold a hundred lines of layered rules — it drops the format or returns a
 * shape that parses and says nothing.
 *
 * That reasoning was about 3B. An 8B model can hold it, and the house style is
 * better written there than anywhere else, so it is reused verbatim rather than
 * paraphrased — one source of truth for what a breakdown sounds like. The
 * addendum narrows a whole-breakdown instruction to one role, which the
 * response schema enforces anyway.
 *
 * Its worked examples are a known hazard: a model short of evidence copies them
 * out as a character. pipeline.ts catches that and retries, saying so outright.
 */
export function houseDescriptionSystem(mode: ResolvedMode, locale: Locale = "us"): string {
  return `${buildSystemPrompt(mode, locale)}

────────────────────────────────────────
YOU ARE DOING ONE PART OF THAT JOB.

You are given the evidence for a SINGLE character, gathered from the script.
Return only that character's fields: gender, ageRange, ethnicity, description
and traits. No project, no roles array, no self-tape, no form questions.

The description follows the DESCRIPTION FORMAT above, except that you write only
the [ROLE DESCRIPTION] part — the gender, age and ethnicity are returned as
their own fields and printed before your text, so do not repeat them in it, and
do not write the trailing role type. Both are added for you.

${LOCAL_STYLE_RULES}

Use only the evidence below. Do not use anything you already know about this
film or these characters. Never copy wording from these instructions.`;
}

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

  return `Character: ${name}

Evidence from the script:
${evidence}

${lengthHint}${avoid}`;
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
