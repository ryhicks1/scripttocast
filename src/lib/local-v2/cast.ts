/**
 * v2 cast extraction for the private path. Deterministic: no model, no network.
 *
 * What v1 did: every cue with dialogue that recurs (or has two words) is a role.
 * That kept title cards ("DUNKIRK", "THE ENEMY HAVE DRIVEN"), crowd voices
 * ("VOICES", "MALE VOICE"), duplicates, and it dropped every one-line role
 * with a one-word name (SAILOR, SUB-LIEUTENANT) and every non-speaking role.
 *
 * What v2 does:
 *   1. Reads speakers from cue lines, with the junk filter below applied.
 *   2. Reads non-speaking roles the way a screenwriter introduces them in
 *      action: a CAPS introduction ("MARA VOSS, 30s, ..."), "This is Gibson.",
 *      "George (seventeen)", "A Warrant Officer ...", "The Editor".
 *   3. Merges variants (JOHN / JOHN (V.O.) / JOHN (CONT'D) / THE BOY / BOY).
 *
 * Every drop is recorded with a reason, so a run can be audited afterwards.
 */
import type { Line } from "../local/extract";
import { carriesLook, displayName, segmentScenes, type Scene } from "../local/screenplay";

export interface CastMember {
  /** Canonical key, upper case: what merges are decided on. */
  key: string;
  /** Name as shown on the breakdown. */
  name: string;
  speaking: boolean;
  /** Cue lines (0 for a non-speaking role). */
  cues: number;
  /** Action sentences that name them. */
  mentions: number;
  /** Pages where they speak or are named in action, ascending. */
  pages: number[];
  firstPage: number;
  /** Other spellings folded into this role. */
  aliases: string[];
  source: "cue" | "action-caps" | "action-intro";
  /** A few of their lines, spread across the script. */
  dialogue: { page: number; text: string }[];
  /** Action sentences that are about them (and no longer-named role). */
  sentences: { page: number; text: string }[];
}

export interface CastResult {
  cast: CastMember[];
  dropped: { name: string; reason: string }[];
  merged: { from: string; into: string }[];
  scenes: Scene[];
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Nouns that make a bare phrase a person: "A Warrant Officer", "The Editor". */
const ROLE_NOUNS = new Set(
  (
    "officer soldier seaman sailor nurse corporal sergeant private lieutenant captain major colonel " +
    "general admiral commander pilot driver guard editor civilian doctor medic orderly waiter waitress " +
    "bartender clerk cop policeman policewoman detective priest vicar teacher student stewardess steward " +
    "engineer mechanic farmer fisherman skipper boatman bearer survivor prisoner trooper gunner radioman " +
    "operator secretary receptionist manager reporter journalist photographer announcer host bouncer cook " +
    "chef nun monk king queen prince princess lord lady servant maid butler mother father wife husband " +
    "son daughter brother sister grandmother grandfather uncle aunt neighbor neighbour stranger passenger " +
    "conductor porter highlander grenadier marine airman flyer aviator leader chief boss thug henchman goon " +
    "hostage witness judge lawyer attorney juror bailiff coroner mayor senator president governor " +
    "ambassador courier messenger vendor shopkeeper landlord landlady barman valet coach referee umpire " +
    "pharmacist surgeon paramedic dispatcher sheriff deputy ranger warden jailer cabbie biker dancer " +
    "singer musician youth boy girl man woman child baby infant teenager teen elder veteran recruit " +
    "cadet midshipman ensign bosun coxswain rower swimmer diver lookout technician scientist professor " +
    "director producer actor actress agent assistant intern cashier customer patient inmate rebel " +
    "villager townsman tourist gardener janitor cleaner bodyguard smuggler pirate soldier fighter " +
    "warrior knight guardsman sentry scout spy diplomat minister clerk pianist bugler drummer piper"
  ).split(/\s+/),
);

/** Too generic to be a role when they stand alone in action lines. */
const GENERIC_ALONE = new Set([
  "man", "woman", "boy", "girl", "kid", "child", "guy", "lady", "person", "youth", "baby", "infant",
  "teen", "teenager", "stranger", "figure", "people", "elder", "leader", "chief", "boss",
]);

/** Group and crowd cues: several people, not a character. */
const CROWD = new Set([
  "ALL", "EVERYONE", "EVERYBODY", "BOTH", "CROWD", "OTHERS", "OTHER", "MEN", "WOMEN", "PEOPLE", "CHORUS",
  "SOLDIERS", "GUARDS", "KIDS", "CHILDREN", "BYSTANDERS", "SURVIVORS", "PASSENGERS", "MOB", "AUDIENCE",
  "TOGETHER", "SEVERAL", "SOMEONE", "ANYONE", "NOBODY", "EVERYTHING", "SOMEBODY",
]);

/** Sound, music and effect cues that sit where a character cue sits. */
const SOUND_CUE =
  /^(MUSIC|SOUND|SOUNDS|SFX|SONG|SCORE|NOISE|NOISES|EXPLOSION|EXPLOSIONS|GUNSHOT|GUNSHOTS|GUNFIRE|SIREN|SIRENS|SCREAM|SCREAMS|SCREAMING|BOOM|BOOMS|BANG|BANGS|BLAM|CRASH|SPLASH|RADIO|TV|TELEPHONE|PHONE|RING|RINGING|BEEP|BUZZER|ALARM|SILENCE|TITLE|SUPER|CAPTION|SUBTITLE|SUBTITLES|CHYRON|INSERT|FLASHBACK|OMITTED|END|CREDITS|MONTAGE|INTERCUT|CONTINUED|MORE|CUT|FADE|DISSOLVE|SMASH|MATCH|ANGLE|CLOSE|WIDE|POV|LATER|MOMENTS|CONTINUOUS|SAME|DAY|NIGHT|MORNING|EVENING|BACK|INT|EXT)\b/;

const VOICE_CUE =
  /^((MALE|FEMALE|MAN'?S|WOMAN'?S|OTHER|SEVERAL|VARIOUS|DISTANT|OFFSCREEN|OFF-?SCREEN|RADIO|LOUDSPEAKER|OVER)\s+)*(VOICES?|VOICEOVER|VO|OS)(\s+(ON|OVER|FROM|IN)\s+.*)?$/;

/** Words that make a 3+ word "cue" a sentence fragment (a title card), not a name. */
const SENTENCE_WORD =
  /\b(HAVE|HAS|HAD|IS|ARE|WAS|WERE|BE|BEEN|WILL|WOULD|CAN'?T|DON'?T|DRIVEN|DOES|DID|WITH|FROM|INTO|THAT|THIS|WHO|WHICH|WHEN|WHERE|BECAUSE)\b/;

const CAPS_STOP = new Set(
  (
    "INT EXT DAY NIGHT MORNING EVENING AFTERNOON DAWN DUSK LATER CONTINUOUS MOMENTS SAME CUT FADE DISSOLVE " +
    "SMASH MATCH ANGLE CLOSE WIDE POV INSERT SUPER TITLE OMITTED THE AND BUT FOR NOT HER HIS SHE HIM YOU ARE " +
    "WAS THAT THIS THEY THEM WITH FROM INTO ALL OFF OUT BACK NEW NOW THEN CONTINUED MORE END CREDITS MONTAGE " +
    "BLAM BANG BOOM BOOMS CRASH SPLASH GUNFIRE EXPLOSION SIREN SCREAM ROAR WHAM THUD SLAM RAF PDF BBC TV USA " +
    "UK FBI CIA NYPD LAPD OK OKAY MUSIC SOUND SFX NOISE SILENCE RADIO PHONE FLASHBACK INTERCUT ON OFF UP DOWN"
  ).split(/\s+/),
);

const HONORIFIC = new Set(["MR", "MRS", "MS", "MISS", "DR", "SGT", "LT", "CAPT", "COL", "GEN", "PROF", "SIR", "LADY", "LORD"]);

const TITLE_LINE = /^(super(\s*title)?|title(\s*card)?(\s*\d+)?|card|caption|subtitle|chyron|on[- ]screen text|text on screen|insert|graphic|words)\s*\d*\s*:?\s*$/i;

const SCENE_HEADING = /^(INT\.?|EXT\.?|INT\.?\/EXT\.?|I\/E|EST\.?)[\s.]/;

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** "MALE VOICE (O.S.)" -> "MALE VOICE"; every parenthetical goes, wherever it sits. */
export function baseCue(raw: string): string {
  return raw
    .replace(/[’]/g, "'")
    .replace(/\s*\([^)]*\)?.*$/, "")
    .replace(/\s+(V\.?O\.?|O\.?S\.?|O\.?C\.?|CONT'?D\.?|CONTINUED)\s*$/i, "")
    .replace(/[\s*.,:;\-–—]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Identity for merging: upper case, no dots, no leading article on a short name. */
export function castKey(name: string): string {
  let k = name
    .toUpperCase()
    .replace(/[’]/g, "'")
    .replace(/'S VOICE$/, "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = k.split(" ");
  if (words.length >= 2 && words.length <= 3 && /^(THE|A|AN)$/.test(words[0])) k = words.slice(1).join(" ");
  return k;
}

function words(key: string): string[] {
  return key.split(" ").filter(Boolean);
}

function lastWord(key: string): string {
  const w = words(key);
  return w[w.length - 1] ?? "";
}

function headNoun(key: string): string {
  // "STRETCHER-BEARER" -> "BEARER"
  const w = lastWord(key).split("-");
  return (w[w.length - 1] ?? "").toLowerCase();
}

function isRoleNoun(word: string): boolean {
  const w = word.toLowerCase();
  return ROLE_NOUNS.has(w) || ROLE_NOUNS.has(w.replace(/s$/, ""));
}

function isNumbered(key: string): boolean {
  return /\s\d+$/.test(key);
}

// ---------------------------------------------------------------------------
// Junk
// ---------------------------------------------------------------------------

export interface CueStats {
  cues: number;
  /** Cues that came straight after a "Title:" / "Super:" line. */
  afterTitleLine: number;
}

/**
 * Why a cue is not a character, or null when it is one.
 * `titleWords` is the script's own title, read from the title page.
 */
export function junkReason(
  rawCue: string,
  key: string,
  stats: CueStats,
  ctx: { titleKey: string; headings: string[] },
): string | null {
  if (!key || !/[A-Z]{2}/.test(key)) return "no name";
  if (SCENE_HEADING.test(key) || /\b(INT|EXT)\b\.?\s/.test(key)) return "scene-heading fragment";
  if (/^\d/.test(key)) return "starts with a number";
  if (stats.afterTitleLine > 0 && stats.afterTitleLine >= stats.cues) return "title card / on-screen text";
  if (ctx.titleKey && key === ctx.titleKey) return "the script's own title";
  if (VOICE_CUE.test(key)) return "voice / off-screen cue, not a character";
  if (/\b(V\.?O\.?|O\.?S\.?)$/.test(rawCue.trim().toUpperCase()) && words(key).length === 1 && SOUND_CUE.test(key)) {
    return "voice cue";
  }
  if (SOUND_CUE.test(key)) return "sound / music / transition cue";
  if (CROWD.has(key)) return "crowd or group cue";
  if (/[&/]|\bAND\b/.test(key) && !HONORIFIC.has(words(key)[0])) return "dual or group cue";
  const w = words(key);
  if (w.length >= 3 && /^(THE|A|AN|OF|TO|IN|ON|AT|AND|BUT|WE|IT|IS|ARE|NO|YES)$/.test(w[0])) return "sentence fragment (title card)";
  if (w.length >= 3 && SENTENCE_WORD.test(key)) return "sentence fragment (title card)";
  if (w.length >= 4 && !w.some(isRoleNounWord)) return "too long for a name";
  // A one-off single word that is a place named in a scene heading ("DUNKIRK").
  if (w.length === 1 && stats.cues <= 1 && !isRoleNoun(key) && !isNumbered(key)) {
    const re = new RegExp(`\\b${escapeRe(key)}\\b`);
    if (ctx.headings.some((h) => re.test(h.toUpperCase()))) return "place name from a scene heading";
  }
  return null;
}

function isRoleNounWord(word: string): boolean {
  return isRoleNoun(word.replace(/[^A-Za-z-]/g, "").split("-").pop() ?? "");
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Reading the script
// ---------------------------------------------------------------------------

const NOISE_LINE = /^(\d+\.?|\(?(CONTINUED|MORE|CONT'?D)\)?:?|[A-Z ]+ TO:|CUT TO:?|FADE (IN|OUT)\.?:?|THE END\.?|DISSOLVE TO:?)$/i;

interface SpeakerAcc {
  key: string;
  names: Map<string, number>;
  cues: number;
  pages: Set<number>;
  afterTitleLine: number;
  rawFirst: string;
  dialogue: { page: number; text: string }[];
}

function readTitle(pageLines: Line[][]): string {
  const first = pageLines[0] ?? [];
  for (const line of first.slice(0, 8)) {
    const t = line.text.trim();
    if (t && t.length <= 40 && t === t.toUpperCase() && /[A-Z]{3}/.test(t) && !/^(WRITTEN|BY|DRAFT)/.test(t)) {
      return castKey(baseCue(t));
    }
  }
  return "";
}

/** Paragraphs of action, with the page each starts on. */
function actionParagraphs(scenes: Scene[]): { page: number; text: string; scene: number }[] {
  const out: { page: number; text: string; scene: number }[] = [];
  for (const scene of scenes) {
    let parts: string[] = [];
    let page = scene.startPage;
    const flush = () => {
      if (!parts.length) return;
      out.push({ page, text: parts.join(" ").replace(/\s+/g, " ").trim(), scene: scene.index });
      parts = [];
    };
    for (const line of scene.lines) {
      if (line.kind === "action" && !NOISE_LINE.test(line.text.trim())) {
        if (!parts.length) page = line.page;
        parts.push(line.text.trim());
      } else {
        flush();
      }
    }
    flush();
  }
  return out;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z"“(])/).map((s) => s.trim()).filter((s) => s.length > 3);
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** "seventeen" -> 17, "fifty-nine" -> 59, "42" -> 42. */
export function ageFromWords(raw: string): number | null {
  const s = raw.toLowerCase().trim();
  if (/^\d{1,3}$/.test(s)) return Number(s);
  const m = /^([a-z]+)[- ]?([a-z]+)?$/.exec(s);
  if (!m) return null;
  const a = NUMBER_WORDS[m[1]];
  if (a === undefined) return null;
  if (m[2]) {
    const b = NUMBER_WORDS[m[2]];
    return b !== undefined && a >= 20 && b < 10 ? a + b : null;
  }
  return a;
}

const NUM_WORD_ALT = Object.keys(NUMBER_WORDS).join("|");

/**
 * Cast from a screenplay. `pageLines` is what extract.ts produced.
 */
export function extractCast(pageLines: Line[][]): CastResult {
  const scenes = segmentScenes(pageLines);
  const headings = scenes.map((s) => s.heading);
  const titleKey = readTitle(pageLines);
  const dropped: CastResult["dropped"] = [];
  const merged: CastResult["merged"] = [];

  // ---- 1. speakers from cue lines ----------------------------------------
  const speakers = new Map<string, SpeakerAcc>();
  const droppedSeen = new Set<string>();
  for (const scene of scenes) {
    const lines = scene.lines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.kind !== "cue") continue;

      // Speech under the cue (skipping parentheticals, transitions, page numbers).
      let speechChars = 0;
      const spoken: string[] = [];
      for (let j = i + 1; j < lines.length && lines[j].kind === "dialogue"; j++) {
        const t = lines[j].text.trim();
        if (/^\(.*\)?$/.test(t) || NOISE_LINE.test(t)) continue;
        speechChars += t.length;
        spoken.push(t);
      }
      if (speechChars < 1) continue;

      const raw = line.text.trim();
      const base = baseCue(raw);
      const key = castKey(base);
      const prev = i > 0 ? lines[i - 1].text.trim() : "";
      const acc = speakers.get(key) ?? {
        key,
        names: new Map<string, number>(),
        cues: 0,
        pages: new Set<number>(),
        afterTitleLine: 0,
        rawFirst: raw,
        dialogue: [],
      };
      acc.dialogue.push({ page: line.page, text: spoken.join(" ").slice(0, 220) });
      acc.cues++;
      acc.pages.add(line.page);
      if (TITLE_LINE.test(prev)) acc.afterTitleLine++;
      acc.names.set(base, (acc.names.get(base) ?? 0) + 1);
      speakers.set(key, acc);
    }
  }

  const kept = new Map<string, SpeakerAcc>();
  for (const acc of speakers.values()) {
    const why = junkReason(acc.rawFirst, acc.key, acc, { titleKey, headings });
    if (why) {
      if (!droppedSeen.has(acc.key)) dropped.push({ name: displayName(acc.key), reason: why });
      droppedSeen.add(acc.key);
    } else kept.set(acc.key, acc);
  }

  // ---- 2. non-speaking roles from action ----------------------------------
  const paragraphs = actionParagraphs(scenes);
  const allText = paragraphs.map((p) => p.text).join("\n");
  const found = new Map<string, { name: string; source: CastMember["source"] }>();

  const note = (name: string, source: CastMember["source"]) => {
    const key = castKey(name);
    if (!key || found.has(key)) return;
    found.set(key, { name, source });
  };

  for (const para of paragraphs) {
    for (const sentence of sentences(para.text)) {
      collectCapsIntros(sentence, allText, note);
      collectTitleCase(sentence, note);
    }
  }

  const candidates: { key: string; name: string; source: CastMember["source"] }[] = [];
  for (const [key, { name, source }] of found) {
    if (kept.has(key)) continue;
    const w = words(key);
    if (w.length === 1 && GENERIC_ALONE.has(key.toLowerCase())) continue;
    if (SOUND_CUE.test(key) || CROWD.has(key) || VOICE_CUE.test(key)) continue;
    if (titleKey && key === titleKey) continue;
    // "HIGHLANDER" is already HIGHLANDER 1, 2, 3.
    if ([...kept.keys()].some((k) => k.startsWith(`${key} `) && isNumbered(k))) continue;
    // "Highlanders" is the crowd of HIGHLANDER 1, 2, 3 (and any plural of a role we have).
    if (/S$/.test(key)) {
      const single = key.slice(0, -1);
      if ([...kept.keys(), ...found.keys()].some((k) => k === single || k.startsWith(`${single} `))) continue;
    }
    // "Commander" alone, when COMMANDER BOLTON is a role: the same man, named two ways.
    if (w.length === 1 && [...kept.keys(), ...found.keys()].some((k) => k !== key && k.startsWith(`${key} `) && !isNumbered(k))) {
      merged.push({ from: displayName(key), into: [...kept.keys(), ...found.keys()].find((k) => k.startsWith(`${key} `))! });
      continue;
    }
    candidates.push({ key, name, source });
  }

  // ---- 3. merge variants ---------------------------------------------------
  type Row = {
    key: string;
    name: string;
    speaking: boolean;
    cues: number;
    pages: Set<number>;
    aliases: Set<string>;
    source: CastMember["source"];
    dialogue: { page: number; text: string }[];
  };
  const rows = new Map<string, Row>();
  for (const acc of kept.values()) {
    const display = [...acc.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    rows.set(acc.key, {
      key: acc.key,
      name: displayName(castKey(display)),
      speaking: true,
      cues: acc.cues,
      pages: new Set(acc.pages),
      aliases: new Set([...acc.names.keys()].filter((n) => castKey(n) !== acc.key || n !== display)),
      source: "cue",
      dialogue: acc.dialogue,
    });
  }
  for (const c of candidates) {
    rows.set(c.key, {
      key: c.key,
      name: /^[A-Z][a-z]/.test(c.name) ? c.name : displayName(c.key),
      speaking: false,
      cues: 0,
      pages: new Set(),
      aliases: new Set(),
      source: c.source,
      dialogue: [],
    });
  }

  // A bare proper name and its one longer form are one person: JOHN / JOHN SMITH,
  // DAWSON / MR. DAWSON. Never a job title (SOLDIER stays SOLDIER), never when
  // two longer forms compete (MR. DAWSON and MRS. DAWSON).
  const keys = [...rows.keys()];
  for (const short of keys) {
    const row = rows.get(short);
    if (!row) continue;
    const sw = words(short);
    if (sw.length !== 1 || isRoleNoun(short) || isNumbered(short) || GENERIC_ALONE.has(short.toLowerCase())) continue;
    const longer = [...rows.keys()].filter((k) => {
      const w = words(k);
      if (w.length < 2 || isNumbered(k)) return false;
      return w[w.length - 1] === short || (w[0] === short) || (HONORIFIC.has(w[0]) && w[w.length - 1] === short);
    });
    if (longer.length !== 1) continue;
    const target = rows.get(longer[0])!;
    // Two speakers with different cue names are different people until proven otherwise:
    // only fold when at most one of them has its own dialogue that the other lacks.
    target.cues += row.cues;
    row.pages.forEach((p) => target.pages.add(p));
    target.speaking = target.speaking || row.speaking;
    target.aliases.add(row.name);
    target.dialogue.push(...row.dialogue);
    merged.push({ from: row.name, into: target.name });
    rows.delete(short);
  }

  // ---- 4. who each action sentence is about --------------------------------
  // Longest name first, and a matched span is blanked, so "Shivering Soldier"
  // is not also a mention of SOLDIER, and "Commander Bolton" is not COMMANDER.
  const roleKeys = [...rows.keys()];
  const tokenOwners = new Map<string, number>();
  for (const k of roleKeys) for (const w of new Set(words(k))) tokenOwners.set(w, (tokenOwners.get(w) ?? 0) + 1);
  const forms: { key: string; re: RegExp; len: number }[] = [];
  for (const k of roleKeys) {
    const variants = new Set<string>([k]);
    const ws = words(k);
    const tail = ws[ws.length - 1];
    if (ws.length > 1 && tail && tail.length >= 3 && !isRoleNoun(tail) && !HONORIFIC.has(tail) && tokenOwners.get(tail) === 1 && !isNumbered(k)) {
      variants.add(tail);
    }
    for (const v of variants) {
      const alt = escapeRe(v).replace(/ /g, "\\s+");
      // Not followed by a digit either: SOLDIER must not swallow SOLDIER 2.
      forms.push({ key: k, re: new RegExp(`(?<![A-Za-z0-9-])${alt}(?![A-Za-z0-9])(?!\\s+\\d)`, "gi"), len: v.length });
    }
  }
  forms.sort((a, b) => b.len - a.len);

  const sentencesBy = new Map<string, { page: number; text: string }[]>();
  const mentions = new Map<string, number>();
  const mentionPages = new Map<string, Set<number>>();
  for (const para of paragraphs) {
    const seenInPara = new Set<string>();
    for (const sentence of sentences(para.text)) {
      let plain = sentence.replace(/\./g, "").replace(/’/g, "'");
      const hit = new Set<string>();
      for (const f of forms) {
        f.re.lastIndex = 0;
        if (f.re.test(plain)) {
          hit.add(f.key);
          f.re.lastIndex = 0;
          plain = plain.replace(f.re, " \u0000 ");
        }
      }
      for (const k of hit) {
        if (!sentencesBy.has(k)) sentencesBy.set(k, []);
        sentencesBy.get(k)!.push({ page: para.page, text: sentence });
        if (!seenInPara.has(k)) {
          seenInPara.add(k);
          mentions.set(k, (mentions.get(k) ?? 0) + 1);
        }
        if (!mentionPages.has(k)) mentionPages.set(k, new Set());
        mentionPages.get(k)!.add(para.page);
      }
    }
  }

  const cast: CastMember[] = [];
  for (const row of rows.values()) {
    const pages = new Set(row.pages);
    mentionPages.get(row.key)?.forEach((p) => pages.add(p));
    const sorted = [...pages].sort((a, b) => a - b);
    const sents = sentencesBy.get(row.key) ?? [];
    cast.push({
      key: row.key,
      name: row.name,
      speaking: row.speaking,
      cues: row.cues,
      mentions: mentions.get(row.key) ?? 0,
      pages: sorted,
      firstPage: sorted[0] ?? 0,
      aliases: [...row.aliases],
      source: row.source,
      dialogue: row.dialogue,
      sentences: sents,
    });
  }

  return { cast, dropped, merged, scenes };
}

// ---------------------------------------------------------------------------
// Non-speaking introductions
// ---------------------------------------------------------------------------

const CAPS_RUN = /[A-Z][A-Z'’.-]+(?:\s+[A-Z][A-Z'’.-]+){0,3}/g;

function collectCapsIntros(
  sentence: string,
  allText: string,
  note: (name: string, source: CastMember["source"]) => void,
): void {
  const letters = sentence.replace(/[^A-Za-z]/g, "");
  const upper = sentence.replace(/[^A-Z]/g, "");
  if (letters.length && upper.length / letters.length > 0.6) return; // shouting or a title line
  CAPS_RUN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CAPS_RUN.exec(sentence))) {
    const run = m[0].replace(/[.'’-]+$/, "");
    const ws = run.split(/\s+/);
    if (ws.every((w) => CAPS_STOP.has(w.replace(/[^A-Z]/g, "")))) continue;
    if (ws.some((w) => CAPS_STOP.has(w.replace(/[^A-Z]/g, "")) && ws.length === 1)) continue;
    if (ws.length === 1 && run.replace(/[^A-Z]/g, "").length < 3) continue;
    const before = sentence.slice(0, m.index);
    const after = sentence.slice(m.index + m[0].length);
    if (/^\s*[!\-–—]/.test(after) && !/^\s*[,(]/.test(after)) continue; // BLAM! and friends
    if (/\b(super|title|caption)\s*\d*\s*:?\s*$/i.test(before)) continue;
    const introduced =
      /^\s*[,(]/.test(after) ||
      /\b(this is|meet|enter|enters|introducing|named|called|known as)\s*$/i.test(before) ||
      (allText.indexOf(m[0]) === allText.lastIndexOf(m[0]) && carriesLook(after));
    if (!introduced) continue;
    note(run, "action-caps");
  }
}

const TITLE_PHRASE =
  /(?:^|[\s(,;:-])(?:A|An|The|a|an|the|Another|another)\s+((?:[A-Z][A-Za-z'’]+-?)(?:[A-Za-z'’]+)?(?:\s+[A-Z][A-Za-z'’-]+){0,2})(?![A-Za-z])/g;
const THIS_IS = /\b[Tt]his is ([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/g;
const NAME_AGE = new RegExp(
  `\\b([A-Z][a-z]+(?:\\s[A-Z][a-z]+)?)\\s*\\((?:aged?\\s+)?(?:\\d{1,2}|(?:${NUM_WORD_ALT})(?:[- ](?:${NUM_WORD_ALT}))?)\\)`,
  "g",
);
const NOT_A_PERSON = new Set([
  "This", "That", "The", "Then", "There", "They", "He", "She", "It", "We", "You", "Super", "Title", "Omitted",
  "Moments", "Later", "Continuous", "Cut", "Fade", "Back", "Behind", "Above", "Below", "Inside", "Outside",
]);

function collectTitleCase(sentence: string, note: (name: string, source: CastMember["source"]) => void): void {
  let m: RegExpExecArray | null;

  THIS_IS.lastIndex = 0;
  while ((m = THIS_IS.exec(sentence))) {
    const name = m[1];
    if (!NOT_A_PERSON.has(name.split(" ")[0])) note(name, "action-intro");
  }

  NAME_AGE.lastIndex = 0;
  while ((m = NAME_AGE.exec(sentence))) {
    const name = m[1];
    if (!NOT_A_PERSON.has(name.split(" ")[0])) note(name, "action-intro");
  }

  TITLE_PHRASE.lastIndex = 0;
  while ((m = TITLE_PHRASE.exec(sentence))) {
    const phrase = m[1].trim();
    const ws = phrase.split(/\s+/);
    // The head noun (last word, last part of a hyphenated word) must be a person.
    const head = ws[ws.length - 1].split("-").pop() ?? "";
    if (!isRoleNoun(head)) continue;
    // Plurals are groups ("Sailors and Nurses"), not roles.
    if (/s$/i.test(head) && !/(ss|us|is)$/i.test(head) && !/^(Highlander|Grenadier)s?$/i.test(head)) {
      if (ROLE_NOUNS.has(head.toLowerCase().replace(/s$/, ""))) continue;
    }
    if (ws.length === 1 && GENERIC_ALONE.has(head.toLowerCase())) continue;
    if (ws.some((w) => NOT_A_PERSON.has(w))) continue;
    note(phrase, "action-intro");
  }
}

// ---------------------------------------------------------------------------
// Prominence
// ---------------------------------------------------------------------------

export type V2Tier = "LEAD" | "SUPPORTING" | "DAY PLAYER";

/** Rank order and tiers. A silent lead (mentioned everywhere, no dialogue) still leads. */
export function rankCast(cast: CastMember[]): { ordered: CastMember[]; tiers: Map<string, V2Tier> } {
  const score = (c: CastMember) => c.cues + 0.7 * c.mentions;
  const ordered = [...cast].sort((a, b) => score(b) - score(a) || b.cues - a.cues || a.firstPage - b.firstPage);
  const total = ordered.reduce((s, c) => s + score(c), 0) || 1;
  const tiers = new Map<string, V2Tier>();
  let leads = 0;
  for (const c of ordered) {
    const share = score(c) / total;
    if (share >= 0.05 && leads < 6) {
      tiers.set(c.key, "LEAD");
      leads++;
    } else if (share >= 0.012) tiers.set(c.key, "SUPPORTING");
    else tiers.set(c.key, "DAY PLAYER");
  }
  return { ordered, tiers };
}
