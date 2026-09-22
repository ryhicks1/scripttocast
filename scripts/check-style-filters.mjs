/**
 * Measure the style filters against the real corpus.
 *
 * A filter that drops sentences has to be checked against professional copy, or
 * it quietly deletes good writing. Real breakdowns are the only fair test:
 * whatever fires on them is a false positive, because those entries were
 * written by working casting directors and published.
 *
 *   node scripts/check-style-filters.mjs ~/Downloads/breakdowns.txt
 *
 * The corpus text is not in this repository — see scripts/corpus/README.md.
 */
import { readFileSync } from "node:fs";
import { parseCorpus } from "./corpus/parse-corpus.mjs";
import { sentencesOf } from "./lib/breakdown-metrics.mjs";
import { findNarrativeVoice } from "../src/lib/description-quality.ts";
import { findBookVoice } from "../src/lib/local/style.ts";

const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/check-style-filters.mjs <exported-doc.txt>");
  process.exit(1);
}

const entries = parseCorpus(readFileSync(input, "utf8"));
const sentences = entries.flatMap((e) => sentencesOf(e.description));

function report(label, find) {
  const entryHits = entries.filter((e) => find(e.description).length);
  const sentenceHits = sentences.filter((s) => find(s).length);
  console.log(
    `${label.padEnd(18)} ${((entryHits.length / entries.length) * 100).toFixed(1)}% of entries` +
      `   ${((sentenceHits.length / sentences.length) * 100).toFixed(1)}% of sentences`,
  );
  return entryHits;
}

console.log(`\n${entries.length} real entries, ${sentences.length} sentences\n`);
report("narrative voice", findNarrativeVoice);
const book = report("book voice", findBookVoice);

console.log("\nphrases the book-voice filter matched in real breakdowns:");
const counts = new Map();
for (const entry of book) {
  for (const phrase of findBookVoice(entry.description)) {
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
}
for (const [phrase, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${phrase}`);
}
