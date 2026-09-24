/**
 * Choosing audition sides the way a casting director does.
 *
 * "Generate Sides" used to extract every page a character appears on, which
 * for a lead is twenty-five pages. Real sides are nothing like that: a lead
 * reads two scenes, three to five pages in all, and a smaller role reads a page
 * or two, often part of one scene. The scene is chosen because it shows who
 * the person is, it has to be playable in a room with a reader — dialogue, two
 * or three people, not a fight or a death — and it should not hand the ending
 * to every actor in town.
 *
 * Those rules are applied here from the screenplay's own structure: who speaks
 * in each scene, how much, with whom, and how much of it is action. No model
 * is involved, so it is fast, testable, identical on the public and private
 * paths, and sends nothing anywhere. Every choice carries its reasons, so the
 * casting director can see why a scene was picked and swap it.
 */
import type { Scene, SceneLine } from "./local/screenplay";

export type SidesTier = "LEAD" | "SUPPORTING" | "DAY PLAYER";

/** A screenplay page is about fifty-five lines. */
const LINES_PER_PAGE = 55;

/**
 * How much each tier reads. From published casting practice: leads three to
 * five pages across one or two scenes, supporting a page or two, smaller roles
 * about a page. No single scene past three pages.
 */
export const SIDES_BUDGET: Record<SidesTier, { scenes: number; pages: number; perScenePages: number }> = {
  LEAD: { scenes: 2, pages: 5, perScenePages: 3 },
  SUPPORTING: { scenes: 1, pages: 2, perScenePages: 2 },
  "DAY PLAYER": { scenes: 1, pages: 1, perScenePages: 1 },
};

/** Scenes a casting director keeps out of a first round unless they choose otherwise. */
const INTIMACY = /\b(nude|naked|topless|undress(es|ed|ing)?|strips? (off|down|naked)|sex scene|having sex|makes? love|love scene|in bed together)\b/i;

/** The last part of a script is where the reveals are. */
const LATE_FRACTION = 0.85;

export interface SidesMark {
  page: number;
  y?: number;
}

export interface SidesChoice {
  sceneIndex: number;
  heading: string;
  startPage: number;
  endPage: number;
  /** Where the actor starts and stops reading. */
  start: SidesMark;
  end: SidesMark;
  /** Every page the excerpt touches, in order. */
  pages: number[];
  /** Estimated length of the excerpt, in pages. */
  lengthPages: number;
  score: number;
  /** Why it was chosen or ranked where it is, in plain words. */
  reasons: string[];
  /** Why it is held out by default. Empty when it is not. */
  flags: string[];
  /** True when the excerpt is part of a longer scene. */
  trimmed: boolean;
}

export interface SidesSelection {
  /** The speaker in the script this role was matched to, or null. */
  speaker: string | null;
  chosen: SidesChoice[];
  /** Every scene the character speaks in, best first, for swapping. */
  candidates: SidesChoice[];
}

/** Which cue name in the script is this role. "Dom Cobb" matches COBB. */
export function matchSpeaker(roleName: string, scenes: Scene[]): string | null {
  const counts = new Map<string, number>();
  for (const scene of scenes) {
    for (const line of scene.lines) {
      if (line.kind === "dialogue" && line.speaker) {
        counts.set(line.speaker, (counts.get(line.speaker) ?? 0) + 1);
      }
    }
  }
  const wanted = roleName.toUpperCase().replace(/[^A-Z0-9' ]/g, " ").trim();
  if (counts.has(wanted)) return wanted;

  const words = (s: string) => s.split(/\s+/).filter((w) => w.length > 1);
  const wantedWords = new Set(words(wanted));
  let best: string | null = null;
  let bestCount = 0;
  for (const [speaker, count] of counts) {
    const speakerWords = words(speaker);
    const overlap = speakerWords.filter((w) => wantedWords.has(w)).length;
    const fits = overlap > 0 && (overlap === speakerWords.length || overlap === wantedWords.size);
    if (fits && count > bestCount) {
      best = speaker;
      bestCount = count;
    }
  }
  return best;
}

/** Map a breakdown role type onto the three sizes of sides. */
export function sidesTierFor(roleType: string | null | undefined): SidesTier {
  const type = (roleType ?? "").toUpperCase();
  if (/LEAD|REGULAR/.test(type)) return "LEAD";
  if (/DAY|BIT|CO-?STAR|UNDER ?5|FEATURED/.test(type)) return "DAY PLAYER";
  return "SUPPORTING";
}

export function selectSides(
  scenes: Scene[],
  roleName: string,
  tier: SidesTier,
  totalPages: number,
): SidesSelection {
  const speaker = matchSpeaker(roleName, scenes);
  if (!speaker) return { speaker: null, chosen: [], candidates: [] };

  const budget = SIDES_BUDGET[tier];
  // A scene needs enough of this character to audition on — three lines —
  // unless they never have three anywhere, as a one-scene part often does.
  const linesIn = (scene: Scene) =>
    scene.lines.filter((l) => l.kind === "dialogue" && l.speaker === speaker).length;
  const minLines = Math.min(3, Math.max(0, ...scenes.map(linesIn)));
  const candidates = scenes
    .map((scene) => scoreScene(scene, speaker, budget.perScenePages, totalPages, minLines))
    .filter((choice): choice is SidesChoice => choice !== null)
    .sort((a, b) => b.score - a.score);

  const chosen: SidesChoice[] = [];
  let pagesUsed = 0;
  const fits = (choice: SidesChoice) =>
    !choice.flags.length &&
    !chosen.includes(choice) &&
    pagesUsed + choice.lengthPages <= budget.pages + 0.25;

  // The best scene first. Then, for a second, prefer one that shows the
  // character with somebody else; failing that, somewhere else; failing that,
  // simply the next best. Two scenes with the same partner in the same room
  // show the actor doing one thing twice.
  const passes: ((choice: SidesChoice) => boolean)[] = [
    (choice) => !chosen.length || contrasts(chosen[0], choice, scenes, speaker) === "partner",
    (choice) => !chosen.length || contrasts(chosen[0], choice, scenes, speaker) !== "none",
    () => true,
  ];
  for (const pass of passes) {
    for (const choice of candidates) {
      if (chosen.length >= budget.scenes) break;
      if (!fits(choice) || !pass(choice)) continue;
      chosen.push(choice);
      pagesUsed += choice.lengthPages;
    }
  }

  chosen.sort((a, b) => a.sceneIndex - b.sceneIndex);
  return { speaker, chosen, candidates };
}

function partnersOf(scene: Scene, speaker: string): Set<string> {
  const others = new Set<string>();
  for (const line of scene.lines) {
    if (line.kind === "dialogue" && line.speaker && line.speaker !== speaker) others.add(line.speaker);
  }
  return others;
}

function contrasts(
  first: SidesChoice,
  next: SidesChoice,
  scenes: Scene[],
  speaker: string,
): "partner" | "place" | "none" {
  if (Math.abs(first.sceneIndex - next.sceneIndex) <= 1) return "none";
  const a = partnersOf(scenes[first.sceneIndex], speaker);
  const b = partnersOf(scenes[next.sceneIndex], speaker);
  const samePartners = a.size === b.size && [...a].every((name) => b.has(name));
  if (!samePartners) return "partner";
  return placeOf(first.heading) === placeOf(next.heading) ? "none" : "place";
}

function placeOf(heading: string): string {
  return heading
    .toUpperCase()
    .replace(/^(INT\.?\/EXT\.?|INT\.?|EXT\.?|I\/E|EST\.?)\s*/, "")
    .replace(/\s+-\s+.*$/, "")
    .trim();
}

function scoreScene(
  scene: Scene,
  speaker: string,
  perScenePages: number,
  totalPages: number,
  minLines: number,
): SidesChoice | null {
  const theirs = scene.lines.filter((l) => l.kind === "dialogue" && l.speaker === speaker).length;
  if (!theirs || theirs < minLines) return null;

  const window = bestWindow(scene.lines, speaker, perScenePages * LINES_PER_PAGE);
  const lines = window.lines;
  const dialogue = lines.filter((l) => l.kind === "dialogue");
  const mine = dialogue.filter((l) => l.speaker === speaker).length;
  const action = lines.filter((l) => l.kind === "action").length;
  const speakers = new Set(dialogue.map((l) => l.speaker).filter((s): s is string => Boolean(s)));
  const partners = [...speakers].filter((s) => s !== speaker);
  const share = dialogue.length ? mine / dialogue.length : 0;
  const actionRatio = lines.length ? action / lines.length : 1;
  const lengthPages = Math.max(0.25, Math.round((lines.length / LINES_PER_PAGE) * 4) / 4);
  const position = totalPages ? scene.startPage / totalPages : 0;

  const reasons: string[] = [];
  const flags: string[] = [];
  let score = Math.min(mine, 30) * 0.3 + share * 10;

  const name = titleCase(speaker);
  if (share >= 0.4) reasons.push(`${name} carries ${Math.round(share * 100)}% of the dialogue`);

  if (speakers.size === 1) {
    score -= 4;
    reasons.push("Monologue — no scene partner");
  } else if (speakers.size === 2) {
    score += 3;
    reasons.push(`Two-person scene with ${titleCase(partners[0])}`);
  } else if (speakers.size === 3) {
    score += 1;
    reasons.push(`Three-person scene with ${partners.map(titleCase).join(" and ")}`);
  } else {
    score -= 3;
    reasons.push(`${speakers.size} speakers — hard to read with one reader`);
  }

  if (actionRatio > 0.5) {
    score -= 3;
    reasons.push("Mostly action — hard to play in an audition room");
  } else if (actionRatio < 0.3) {
    score += 1;
    reasons.push("Mostly dialogue");
  }

  if (position > LATE_FRACTION) {
    score -= 2;
    flags.push("In the last pages of the script — may give away the ending");
  }
  const text = lines.map((l) => l.text).join(" ");
  if (INTIMACY.test(text)) flags.push("Nudity or intimacy — kept out of a first round by default");

  if (window.trimmed) reasons.push(`Trimmed to the strongest ${formatPages(lengthPages)} of a longer scene`);

  const first = lines[0];
  const last = lines[lines.length - 1];
  const pages = [...new Set(lines.map((l) => l.page))];
  return {
    sceneIndex: scene.index,
    heading: scene.heading,
    startPage: scene.startPage,
    endPage: scene.endPage,
    start: { page: first.page, y: first.y },
    end: { page: last.page, y: last.y },
    pages,
    lengthPages,
    score: Math.round(score * 10) / 10,
    reasons,
    flags,
    trimmed: window.trimmed,
  };
}

/**
 * The stretch of a scene an actor should read.
 *
 * A scene that fits is read whole, heading and all. A longer one is cut to the
 * window with the most of this character's dialogue, starting on a cue so the
 * actor enters on a line, and ending after a speech rather than mid-sentence.
 */
function bestWindow(
  lines: SceneLine[],
  speaker: string,
  maxLines: number,
): { lines: SceneLine[]; trimmed: boolean } {
  if (lines.length <= maxLines) return { lines, trimmed: false };

  let best = { start: 0, end: Math.min(lines.length, maxLines), mine: -1 };
  for (let start = 0; start < lines.length; start++) {
    if (lines[start].kind !== "cue" && start !== 0) continue;
    let end = Math.min(lines.length, start + maxLines);
    // Finish on the end of a speech, not halfway through one.
    while (end > start + 1 && lines[end - 1]?.kind === "cue") end--;
    while (end < lines.length && end - start < maxLines && lines[end]?.kind === "dialogue") end++;
    const mine = lines
      .slice(start, end)
      .filter((l) => l.kind === "dialogue" && l.speaker === speaker).length;
    if (mine > best.mine) best = { start, end, mine };
  }
  return { lines: lines.slice(best.start, best.end), trimmed: true };
}

function titleCase(name: string): string {
  return name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function formatPages(pages: number): string {
  return pages === 1 ? "page" : `${pages} pages`;
}
