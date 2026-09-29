/**
 * Evidence for one role call, in labelled blocks. Deterministic, no model.
 *
 * v2.0 sent up to twelve action sentences in page order. Most of those are
 * blocking ("Tommy looks around, clutching his stomach"), and an 8B model
 * paraphrases blocking into scene narration. These blocks send what a
 * breakdown is written from instead:
 *
 *   INTRODUCTION     the first line that names them, where "(fifties, civilian
 *                    dress)" and "40's, TEXAN, muscle and sinew" live
 *   LOOK AND AGE     sentences with an age, build, hair, clothing, injury,
 *                    nationality, accent
 *   JOB AND TIES     rank / job nouns and family or command relationships
 *   PHYSICAL WORK    swimming, climbing, fighting, driving: what the part
 *                    physically asks of the actor
 *   DIALOGUE         a few lines, or a plain "no dialogue"
 */
import type { CastMember } from "./cast";

export interface Evidence {
  text: string;
  /** The description-bearing sentences only (no dialogue), for local retrieval. */
  query: string;
  /** Everything the model was shown about this person, lower-cased, for grounding checks. */
  identity: string;
  /** Only the action lines (no dialogue), lower-cased: looks and situations must come from these. */
  scene: string;
  /** True when the evidence contains a female cue (she, her, woman, wife, mother...). */
  femaleCue: boolean;
}

const LOOK_CUE =
  /\(\s*(?:aged?\s+)?\d{1,2}\b|\b\d{1,2}['’]?s\b|\b(?:teens?|teenage|twenties|thirties|forties|fifties|sixties|seventies|eighties|early|mid|late|young|old|elderly|middle[- ]aged|tall|short|thin|slim|lean|heavy|heavyset|stocky|broad|wiry|gaunt|weathered|handsome|beautiful|pretty|grey|gray|greying|blonde?|brunette|red[- ]haired|bald|beard|bearded|moustache|mustache|stubble|hair|scar|scarred|tattoo|limp|blind|deaf|glasses|spectacles|uniform|suit|dress|coat|jacket|helmet|mask|goggles|accent|drawl|muscle|sinew|battered|ravaged|pale|bruised|wounded|muscular|athletic|texan|british|english|scottish|welsh|irish|french|german|dutch|swedish|american|australian|canadian|african|asian|hispanic|latino|latina|black|white|indian|korean|japanese|chinese|russian|italian|spanish|mexican)\b/i;

const JOB_OR_TIE =
  /\b(?:captain|commander|colonel|major|lieutenant|sergeant|corporal|private|officer|admiral|general|pilot|doctor|nurse|medic|guard|warden|driver|owner|skipper|farmer|teacher|student|priest|judge|lawyer|reporter|editor|engineer|mechanic|sailor|seaman|soldier|inmate|prisoner|convict|librarian|cook|waiter|waitress|bartender|cop|detective|sheriff|hunter|chef|scientist|professor|banker|clerk|manager|secretary|stewardess|steward|attendant|orderly)\b|\b(?:his|her|their|[A-Z][a-z]+['’]s)\s+(?:father|mother|dad|mom|son|daughter|brother|sister|wife|husband|friend|partner|boss|commander|mate|wingman|wing mate|grandfather|grandmother|uncle|aunt|cousin|lover|girlfriend|boyfriend)\b/;

const PHYSICAL =
  /\b(?:swims?|swimming|runs?|running|sprints?|climbs?|climbing|fights?|fighting|falls?|falling|dives?|diving|jumps?|leaps?|drives?|driving|flies|flying|shoots?|fires|rows?|rowing|drowns?|drowning|burns?|burning|crawls?|hauls?|drags?|dragging|punches|kicks?|struggles?|wades?|hangs?)\b/i;

/** Handling and moving verbs: the clothing or prop in these sentences is blocking, not a look ("grabs a life jacket"). */
const HANDLING =
  /\b(?:grabs?|picks?|pulls?|puts?|hands?|hits?|takes?|throws?|holds?|carries|carrying|wraps?|drops?|tosses?|passes|passing|opens?|closes?|puts|outs|slips?|hangs?)\b/i;

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const end = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf(" - "), cut.lastIndexOf(" "));
  return `${cut.slice(0, end > n * 0.6 ? end : n).replace(/[\s,;:-]+$/, "")}…`;
};

const MAX_TOTAL = 2600;

export function buildEvidence(member: CastMember, statedAgeValue: number | null): Evidence {
  const used = new Set<number>();
  const shown: string[] = [];
  const blocks: string[] = [];

  const push = (label: string, indexes: number[], max: number, each: number) => {
    const lines: string[] = [];
    for (const i of indexes) {
      if (lines.length >= max) break;
      if (used.has(i)) continue;
      const s = member.sentences[i];
      used.add(i);
      shown.push(s.text);
      lines.push(`(p${s.page}) ${clip(s.text, each)}`);
    }
    if (lines.length) blocks.push(`${label}\n${lines.join("\n")}`);
  };

  const all = member.sentences.map((_, i) => i);
  // A sentence is about this person when they are its subject: their name is in its first few words.
  // "The Elderly Man reaches out to Tommy, touching his face - clearly blind" is about the Elderly Man.
  const nameTokens = [member.name, ...member.aliases]
    .flatMap((n) => n.toLowerCase().replace(/[^a-z' -]/g, " ").split(/\s+/))
    .filter((w) => w.length >= 3 && !["the", "and", "mr", "mrs", "sgt", "pvt"].includes(w));
  const subjectOf = (i: number) => {
    const first = member.sentences[i].text.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 5);
    return first.some((w) => nameTokens.includes(w.replace(/'s$/, "")));
  };
  if (member.sentences.length) push("INTRODUCTION", [0], 1, 320);
  push(
    "LOOK AND AGE",
    all.filter((i) => {
      const t = member.sentences[i].text;
      return subjectOf(i) && LOOK_CUE.test(t) && (!HANDLING.test(t) || /\(\s*(?:aged?\s+)?\w+[- ]?\w*\s*[,)]|\b\d0['’]?s\b/.test(t));
    }),
    3,
    260,
  );
  push("JOB AND TIES", all.filter((i) => JOB_OR_TIE.test(member.sentences[i].text)), 3, 240);
  push("PHYSICAL WORK", all.filter((i) => subjectOf(i) && PHYSICAL.test(member.sentences[i].text)), 2, 200);
  if (!member.sentences.length) blocks.push(`No action line names ${member.name} beyond the cue.`);

  const facts = [`Speaks in the script: ${member.speaking ? `yes (${member.cues} speech${member.cues === 1 ? "" : "es"})` : "no, non-speaking"}`];
  if (statedAgeValue !== null) facts.push(`Age stated in the script: ${statedAgeValue}`);

  let dialogue = "";
  const said: string[] = [];
  if (member.dialogue.length) {
    const want = 4;
    const step = Math.max(1, Math.floor(member.dialogue.length / want));
    const lines: string[] = [];
    for (let i = 0; i < member.dialogue.length && lines.length < want; i += step) {
      const d = member.dialogue[i];
      said.push(d.text);
      lines.push(`(p${d.page}) ${clip(d.text, 140)}`);
    }
    dialogue = `DIALOGUE\n${lines.join("\n")}`;
  } else dialogue = "DIALOGUE\nnone";

  let text = `${facts.join("\n")}\n\n${blocks.join("\n\n")}\n\n${dialogue}`;
  if (text.length > MAX_TOTAL) text = `${text.slice(0, MAX_TOTAL)}…`;
  const sceneText = `${member.name}\n${shown.join("\n")}`.toLowerCase();
  return {
    text,
    scene: sceneText,
    femaleCue: /\b(she|her|hers|herself|woman|women|female|girl|lady|wife|mother|mrs|miss|ms|stewardess|nurse|waitress|actress|daughter|sister)\b/i.test(`${member.name} ${shown.join(" ")}`),
    query: `${member.name} ${member.name} ${shown.join(" ")}`,
    identity: `${member.name}\n${[...shown, ...said].join("\n")}`.toLowerCase(),
  };
}
