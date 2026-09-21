/**
 * Detects narrative-summary voice in role descriptions.
 *
 * A breakdown describes a person an agent might submit. When the model slips
 * into summarising the script instead, it produces sentences that read fine but
 * tell an agent nothing castable — "his journey", "helps establish", "by the
 * end". Measured across 310 real Breakdown Services entries, these patterns fire
 * on 6.8% of professional copy, so that is roughly the floor to expect rather
 * than zero — real breakdowns slip into it too. Well above that means the
 * description prompt is drifting into summarising the script.
 *
 * Checked against that corpus: every "represents" hit was thematic ("represents
 * communal morality", "represents hope amid hardship"), none was a lawyer
 * representing a client. A false positive costs a log line and nothing else.
 *
 * Used for logging only. It never rewrites or rejects a description; it exists
 * so a prompt change can be judged against real output instead of assumed.
 */
const NARRATIVE_VOICE: RegExp[] = [
  /\b(his|her|their|the character's) (journey|arc)\b/i,
  /\bin the story\b/i,
  /\bthroughout the (film|series|story|episode)\b/i,
  /\bby the end\b/i,
  /\bserves as\b/i,
  /\brepresents\b/i,
  /\bwe (see|learn|meet|follow)\b/i,
  /\bthe audience\b/i,
  /\bhelps? establish\b/i,
  /\bembodies the theme\b/i,
];

/** Returns the narrative-voice phrases found in a description. */
export function findNarrativeVoice(description: string): string[] {
  if (!description) return [];
  return NARRATIVE_VOICE.flatMap((pattern) => {
    const match = description.match(pattern);
    return match ? [match[0].toLowerCase()] : [];
  });
}
