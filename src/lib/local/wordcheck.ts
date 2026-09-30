/**
 * "Is this text real English?" without a model and without a bundled list.
 *
 * Used to judge OCR output and text layers: a garbled scan reads as a pile of
 * non-words, real dialogue is mostly dictionary words. The system dictionary
 * (/usr/share/dict on macOS and most Linux) is read once, in memory, and
 * checked with light suffix stripping because word lists hold base forms only.
 * When there is no system list, a shape test stands in (vowels, no long
 * consonant runs), which is weaker but still separates prose from noise.
 *
 * Only ever called on script text to produce a number. Never logs the text.
 */
import { readFileSync } from "node:fs";

const DICTIONARY_PATHS = ["/usr/share/dict/words", "/usr/share/dict/web2"];
/** Contractions and script words that word lists usually miss. */
const EXTRA = new Set(
  ("a i an the and or but so if of to in on at by up as is it be do go no we he me my am us " +
    "okay ok yeah yep nope uh um hmm huh hey oh ah ha wow gonna wanna gotta kinda sorta cuz ya " +
    "int ext cont beat pov continued fade cut dissolve montage").split(" "),
);

let dictionary: Set<string> | null | undefined;

/** The system word list, or null when there is none. Loaded lazily, kept in memory. */
export function systemDictionary(): Set<string> | null {
  if (dictionary !== undefined) return dictionary;
  dictionary = null;
  for (const path of DICTIONARY_PATHS) {
    try {
      const set = new Set<string>();
      for (const word of readFileSync(path, "utf8").split("\n")) {
        const w = word.trim().toLowerCase();
        if (w && /^[a-z]+$/.test(w)) set.add(w);
      }
      if (set.size > 20000) {
        dictionary = set;
        break;
      }
    } catch {
      // Try the next path.
    }
  }
  return dictionary;
}

/** Test hook: force a specific list (or none). */
export function setDictionaryForTests(words: Set<string> | null | undefined): void {
  dictionary = words;
}

const SUFFIXES: [string, string][] = [
  ["s", ""], ["es", ""], ["ies", "y"], ["ed", ""], ["ed", "e"], ["d", ""], ["ing", ""], ["ing", "e"],
  ["ly", ""], ["er", ""], ["er", "e"], ["est", ""], ["ers", ""], ["ness", ""], ["ful", ""], ["n", ""],
];

function inList(list: Set<string>, word: string): boolean {
  if (list.has(word) || EXTRA.has(word)) return true;
  for (const [suffix, add] of SUFFIXES) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length) + add;
      if (list.has(stem)) return true;
      // Doubled final consonant: "stopped" -> "stopp" -> "stop".
      if (!add && stem.length > 3 && stem[stem.length - 1] === stem[stem.length - 2] && list.has(stem.slice(0, -1))) return true;
    }
  }
  return false;
}

/** Vowel-bearing, no run of 4+ consonants: the shape of a word, not proof of one. */
export function looksLikeWord(word: string): boolean {
  const w = word.toLowerCase();
  if (w.length <= 2) return /[aeiouy]/.test(w) || EXTRA.has(w);
  if (!/[aeiouy]/.test(w)) return false;
  if (/[^aeiouy]{5,}/.test(w)) return false;
  if (/(.)\1\1/.test(w)) return false;
  return true;
}

/** Word-like tokens of at least two letters, contractions cut at the apostrophe. */
export function wordTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.match(/[A-Za-z][A-Za-z'’]*/g) ?? []) {
    const head = raw.split(/['’]/)[0];
    if (head.length >= 2) out.push(head.toLowerCase());
    else if (raw.length >= 2) out.push(raw.replace(/['’]/g, "").toLowerCase());
  }
  return out;
}

export function isRealWord(word: string): boolean {
  const list = systemDictionary();
  const w = word.toLowerCase();
  return list ? inList(list, w) : looksLikeWord(w) && w.length >= 2;
}

export interface WordStats {
  words: number;
  real: number;
  /** real / words, 0 when there are no words. */
  ratio: number;
}

export function wordStats(text: string): WordStats {
  const tokens = wordTokens(text);
  let real = 0;
  for (const token of tokens) if (isRealWord(token)) real++;
  return { words: tokens.length, real, ratio: tokens.length ? real / tokens.length : 0 };
}

/** Whether the text is too broken to trust: plenty of words, few of them real. */
export function looksGarbled(stats: WordStats): boolean {
  return stats.words >= 150 && stats.ratio < 0.5;
}
