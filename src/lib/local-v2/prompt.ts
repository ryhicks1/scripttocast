/**
 * The v2.1 role prompt: rules, a banned-word list, eight worked examples, and
 * the reply schema. The system text is identical on every role call, so
 * Ollama's prompt cache holds it.
 *
 * The worked examples are written for this project from public screenplays
 * (Edge of Tomorrow, The Shawshank Redemption, Interstellar). None is from
 * Dunkirk and none is Breakdown Services text, so they are safe to commit.
 * The real breakdown entries are a separate, local-only bank: retrieval.ts.
 */
import type { V2Tier } from "./cast";
import { TIER_RULES } from "./helpers";

export const ROLE_SCHEMA = {
  type: "object",
  required: ["gender", "ageMin", "ageMax", "occupation", "relationship", "lookCues", "type", "traits", "skills", "requirements", "storyNote", "ethnicity"],
  additionalProperties: false,
  properties: {
    gender: { type: "string", enum: ["Male", "Female", "Non-binary"] },
    ageMin: { type: "integer", minimum: 1, maximum: 99 },
    ageMax: { type: "integer", minimum: 1, maximum: 99 },
    occupation: { type: "string" },
    relationship: { type: "string" },
    lookCues: { type: "array", items: { type: "string" }, maxItems: 3 },
    type: { type: "string" },
    traits: { type: "array", items: { type: "string" }, maxItems: 4 },
    skills: { type: "array", items: { type: "string" }, maxItems: 4 },
    requirements: { type: "array", items: { type: "string" }, maxItems: 4 },
    storyNote: { type: "string" },
    ethnicity: { type: "string" },
  },
} as const;

const RULES = `You fill in a casting-breakdown form for ONE character in a screenplay. Casting directors write these to get exactly the actor and look they want, and agents read them to decide which client on their roster fits. So the form describes the JOB, the LOOK and the TYPE of the person. It does not summarise the story or explain the character's psychology.

You get evidence from the script about that one character. Use only that evidence and ordinary common sense about the job or rank. Do not attribute to this character anything the evidence gives to someone else.

Fields, in this order:
- gender: Male, Female or Non-binary, as the script presents them (he/she, Mr/Mrs, woman/man). If the evidence has no pronoun or word that shows it, answer Male; do not guess Female.
- ageMin, ageMax: whole numbers, the playing-age range an agent would search on. If the script states an age, use a range of about 4 years around it. If it gives only a decade ("40's"), use that decade. Otherwise judge from the job and life stage, and keep the range within 10 years: junior ranks, students and trainees 18 to 30; ordinary working adults 30 to 50; officers, senior staff and heads of households 40 to 60; retired or elderly people 65 and up.
- occupation: their job, rank or role in the world, one to six words ("Squad drill sergeant", "Prison warden", "Farmer and grandfather"). Never just "young man" or "woman". Use only a job the name or the lines support; never invent one (a regiment name like Highlander is a soldier, not a warrior of legend). If the script gives no job, say what they are to the others in occupation plus relationship ("Young crewman" with relationship "the warden's nephew"). Always fill this.
- relationship: who they are to another character when that defines them, up to eight words ("Murph's grandfather"), else "".
- lookCues: up to three short phrases that the SCRIPT gives about how they look, dress or move: build, hair, glasses, uniform, injury, height, condition. Copy the script's own words; they describe how the person appears, never what they are doing (no verbs like climbs, looks, concentrates), and never their age. Not objects they hold or wear in one scene (a life jacket, a coat they grab). If the script gives none, use []. Never write handsome, attractive, rugged or any guess about their face.
- type: the castable type in up to six words ("loud, hard-driving sergeant"), else "".
- traits: plain single-word adjectives an actor could play that the lines support, different from the words already in occupation and type. If the lines show nothing about temperament (a day player with one line), use []. Leads at most 4, supporting at most 3, day players at most 2. Fewer is better. No opposites joined by "but".
- skills: what an agent filters on: an accent or language only when the script shows a nationality, region or dialect; singing, stunts, fighting, weapons, riding, driving, swimming, flying, animals. Else [].
- requirements: what the part asks of the actor or the production: non-speaking, physical or stunt work, mask or costume work, kissing or intimacy, violence, prosthetics or makeup, smoking, minors. Else [].
- storyNote: leads only, at most 12 words, and it must begin with Carries, Has, Is, Lives, Works, Serves, Owns, Hides or Keeps, and use only facts in the evidence. Not what they do in a scene, nothing about how it ends, no other character's name. If unsure, "". Everyone else: "".
- ethnicity: only if the script itself states it. Otherwise "". Never guess it. A nationality goes in skills as an accent, not here.

Never write a plot: no scenes, no "when", "after", "then", no outcomes or deaths. Never put an age or number in any text field. Never mention the script, the film or the audience.
Never use these words: introspective, self-critical, self-aware, decisive, complex, nuanced, multifaceted, dynamic, well-rounded, natural leader, leader among, leadership, sense of humor, calm under pressure, demeanor, resourceful, protective of, a mix of, but also, air of, catalyst, journey.
Real breakdowns are short and stop early. A small part gets a few words, not a paragraph. If you have nothing true to put in a field, leave it empty.

The examples below show the evidence you get and the form you fill. Their content belongs to other characters and other scripts. Never copy it into your answer.
`;

interface Pair {
  tier: V2Tier;
  name: string;
  speaking: boolean;
  evidence: string;
  answer: Record<string, unknown>;
}

const EMPTY = { relationship: "", lookCues: [], type: "", traits: [], skills: [], requirements: [], storyNote: "", ethnicity: "" };

/** Eight worked pairs. Evidence is laid out exactly as evidence.ts prints it. */
export const PAIRS: Pair[] = [
  {
    tier: "LEAD", name: "Cage", speaking: true,
    evidence: `Speaks in the script: yes (325 speeches)

INTRODUCTION
(p2) Cage’s beautiful wife HAYLEY (30’s), sits up too.

LOOK AND AGE
(p2) CAGE (now late 30’s) stares at the photo.
(p2) Cage is ONLY A FEW YEARS OLDER, but his face is RAVAGED BY TIME.
(p3) Yobo looks at Cage’s BATTERED EXOJACKET.

JOB AND TIES
(p20) Cage pulls out the PHOTO of his son.

PHYSICAL WORK
(p6) Cage RUNNING THROUGH IT ALL...

DIALOGUE
(p2) Adam? What is it?
(p33) I need to learn how to fight.
(p85) We've got to get to the jackets.`,
    answer: { ...EMPTY, gender: "Male", ageMin: 35, ageMax: 42, occupation: "Conscript soldier", relationship: "husband and father", lookCues: ["face ravaged by time", "battered exojacket"], type: "worn-out, stubborn everyman", traits: ["dry", "stubborn", "haunted"], requirements: ["running and stunt work in heavy armour", "wide emotional range"], storyNote: "Carries the loss of his wife and son" },
  },
  {
    tier: "LEAD", name: "Warden Samuel Norton", speaking: true,
    evidence: `Speaks in the script: yes (54 speeches)

INTRODUCTION
(p13) WARDEN SAMUEL NORTON strolls forth, a colorless man in a gray suit and a church pin in his lapel.

JOB AND TIES
(p77) Norton locks the safe, swings his wife's framed sampler back into place.

DIALOGUE
(p13) I am Mr. Norton, the warden. You are sinners and scum, that's why they sent you to me. Rule…
(p49) You like working in the laundry?
(p99) Lickety-split. I wanna get home.`,
    answer: { ...EMPTY, gender: "Male", ageMin: 50, ageMax: 60, occupation: "Prison warden", lookCues: ["colorless", "gray suit", "church pin"], type: "pious, cold authority figure", traits: ["polite", "controlling", "smug"], requirements: ["preacher's delivery", "handles a pistol"], storyNote: "Hides his dealings behind religion" },
  },
  {
    tier: "SUPPORTING", name: "Sgt. Farell", speaking: true,
    evidence: `Speaks in the script: yes (39 speeches)

INTRODUCTION
(p3) FARELL (40’s, TEXAN, muscle and sinew) glares.

PHYSICAL WORK
(p13) The fat Private STRUGGLES over an OBSTACLE, FARELL SCREAMING until...
(p20) Farell land next to Cage and run to: IN THE TRENCH.

DIALOGUE
(p3) DON’T YOU DARE PUKE, PRIVATE--
(p20) CONTACT MINUS 10. LATCHES OFF.
(p63) K, LIGHT EM UP, LADIES. HUDS ON.`,
    answer: { ...EMPTY, gender: "Male", ageMin: 40, ageMax: 49, occupation: "Squad drill sergeant", lookCues: ["muscle and sinew"], type: "loud, hard-driving sergeant", traits: ["blustering", "relentless"], skills: ["Texan accent"], requirements: ["shouting", "action and stunt work in armour"] },
  },
  {
    tier: "SUPPORTING", name: "Yobo", speaking: true,
    evidence: `Speaks in the script: yes (60 speeches)
Age stated in the script: 18

INTRODUCTION
(p3) “YOBO” YONABURU (18, ASIAN AMERICAN, innocent) struggles with his exojacket.

LOOK AND AGE
(p4) Yobo now an ASH WHITE.

PHYSICAL WORK
(p86) YOBO sees them run past, towards the DROPSHIP HANGER.

DIALOGUE
(p3) I can’t breathe.
(p7) Help me --
(p35) What are you doing?`,
    answer: { ...EMPTY, gender: "Male", ageMin: 17, ageMax: 20, occupation: "Fresh army recruit", lookCues: ["innocent"], type: "eager, fresh-faced kid", traits: ["anxious", "earnest"], requirements: ["stunt work in an exojacket"], ethnicity: "Asian American" },
  },
  {
    tier: "SUPPORTING", name: "Brooks", speaking: true,
    evidence: `Speaks in the script: yes (33 speeches)

INTRODUCTION
(p19) BROOKS HATLEN is sitting closest to Andy.

LOOK AND AGE
(p19) Brooks opens up his sweater and feeds the maggot to a baby crow nestled in an inside pocket.
(p59) It swings hugely open, revealing Brooks standing in his cheap suit, carrying a cheap bag, wearing a cheap hat.

JOB AND TIES
(p27) Brooks Hatlen pushes a cart of books from cell to cell.

DIALOGUE
(p19) You gonna eat that?
(p50) Since 1912. Yuh, over 37 years.
(p60) The parole board got me into this halfway house called the Brewster, and a job bagging groceries at the Foodway...`,
    answer: { ...EMPTY, gender: "Male", ageMin: 60, ageMax: 72, occupation: "Long-serving inmate and prison librarian", lookCues: ["cheap suit", "cheap hat"], type: "gentle old-timer", traits: ["soft-spoken", "kind", "institutionalized"], requirements: ["handles a live bird (animal handler on set)"] },
  },
  {
    tier: "SUPPORTING", name: "Donald", speaking: true,
    evidence: `Speaks in the script: yes (24 speeches)

INTRODUCTION
(p4) This is Grandpa (DONALD).

PHYSICAL WORK
(p51) Donald watches two approaching vehicles kick up dust.

DIALOGUE
(p4) Not at the table, Murph.
(p6) Repopulating the Earth - start pulling your weight.
(p19) Fine. But popcorn at a ball game is unnatural. I want a hot dog.`,
    answer: { ...EMPTY, gender: "Male", ageMin: 62, ageMax: 72, occupation: "Farmer and grandfather", relationship: "Murph's grandfather", type: "wry, plain-spoken elder", traits: ["blunt", "wry"] },
  },
  {
    tier: "DAY PLAYER", name: "Medic", speaking: false,
    evidence: `Speaks in the script: no, non-speaking

INTRODUCTION
(p25) The MEDIC shoots the FRANTIC CAGE in the NECK with a HYPO GUN.

DIALOGUE
none`,
    answer: { ...EMPTY, gender: "Male", ageMin: 25, ageMax: 40, occupation: "Military medic", requirements: ["non-speaking", "brief action with a prop"] },
  },
  {
    tier: "DAY PLAYER", name: "Nurse", speaking: true,
    evidence: `Speaks in the script: yes (1 speech)

No action line names Nurse beyond the cue.

DIALOGUE
(p27) Oh, Jesus.`,
    answer: { ...EMPTY, gender: "Female", ageMin: 30, ageMax: 45, occupation: "Hospital nurse", requirements: ["one line"] },
  },
];

export function pairText(p: Pair): string {
  return `EXAMPLE
Character: ${p.name}
Speaks in the script: ${p.speaking ? "yes" : "no, silent"}
Size of part: ${p.tier}

EVIDENCE
${p.evidence}

ANSWER
${JSON.stringify(p.answer)}
`;
}

/** Identical on every call. */
export const ROLE_SYSTEM = `${RULES}\n${PAIRS.map(pairText).join("\n")}`;

/**
 * What the copy check compares a reply against: every text field of every
 * worked answer (whole-field matches), plus each answer read as one sentence
 * (for six-word runs).
 */
export const PAIR_ANSWER_TEXTS: string[] = PAIRS.flatMap((p) => {
  const values = Object.values(p.answer).flat().filter((v): v is string => typeof v === "string" && v.length > 0);
  return [...values, values.join(". ")];
});

export const LENGTH_HINT: Record<V2Tier, string> = {
  LEAD: `Lead: fill every field that has evidence, at most ${TIER_RULES.LEAD.traits} traits, one storyNote.`,
  SUPPORTING: `Supporting: at most ${TIER_RULES.SUPPORTING.traits} traits, storyNote "".`,
  "DAY PLAYER": `Day player: keep it to a few words. At most ${TIER_RULES["DAY PLAYER"].traits} traits, storyNote "".`,
};

export function roleUser(o: {
  name: string;
  aliases: string[];
  speaking: boolean;
  tier: V2Tier;
  evidence: string;
  similar: string[];
  correction?: string;
}): string {
  const also = o.aliases.length ? ` (also written as ${o.aliases.join(", ")})` : "";
  const similar = o.similar.length
    ? `\n\nSIMILAR REAL BREAKDOWN DESCRIPTIONS (tone and shape only; other people, other scripts; never copy their words, facts or traits):\n${o.similar.map((t) => `- ${t}`).join("\n")}`
    : "";
  return (
    `Character: ${o.name}${also}\n` +
    `Speaks in the script: ${o.speaking ? "yes" : "no, silent"}\n` +
    `Size of part: ${o.tier}\n` +
    `${LENGTH_HINT[o.tier]}\n\n` +
    `EVIDENCE\n${o.evidence}${similar}\n\n` +
    `Fill in the form for ${o.name} now. JSON only.${o.correction ?? ""}`
  );
}
