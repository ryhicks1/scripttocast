/**
 * Turn the Breakdown Services reference corpus into numbers.
 *
 * The corpus is 68 real Breakdown Services / Actors Access breakdowns (310 role
 * entries) in a Google Doc. It carries an explicit copyright and
 * non-redistribution notice, so the text is NOT stored in this repository and
 * must not be. What is stored is scripts/corpus/reference-metrics.json —
 * aggregate distributions with no breakdown text in them — which is all the
 * scorer needs.
 *
 * To regenerate: export the doc as plain text or markdown, then
 *
 *   node scripts/corpus/parse-corpus.mjs ~/Downloads/breakdowns.txt
 *
 * The export is heavily escape-mangled — literal "&#10;" for newlines, runs of
 * backslashes before markdown punctuation, smart quotes — so most of this file
 * is undoing that before anything is measured.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { measureDescription, summarise } from "../lib/breakdown-metrics.mjs";

const OUT = new URL("./reference-metrics.json", import.meta.url);

/** Role entries are marked "\[ NAME \]" with a variable run of backslashes. */
const ROLE_MARKER = /\\+\[\s*([^\]\\]{1,80}?)\s*\\+\]/g;

/** The format template at the top of the doc, which is not a role. */
const TEMPLATE_FIELDS = new Set([
  "GENDER",
  "AGE RANGE",
  "ETHNIC BACKGROUND",
  "ROLE DESCRIPTION",
  "ROLE TYPE",
]);

function unmangle(text) {
  return (
    text
      // The export writes newlines inside table cells as a literal entity.
      .replace(/&#10;/g, "\n")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      // Runs of backslashes before markdown punctuation: \\\* \\\[ \#
      .replace(/\\+([*_[\]#`~\-.])/g, "$1")
      .replace(/\\+/g, "")
      .replace(/\*\*/g, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function parseCorpus(raw) {
  const hits = [...raw.matchAll(ROLE_MARKER)];
  const entries = [];

  for (let i = 0; i < hits.length; i++) {
    const name = hits[i][1].trim();
    if (TEMPLATE_FIELDS.has(name.toUpperCase())) continue;

    const start = hits[i].index + hits[i][0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index : raw.length;
    // A role's description lives in one markdown table cell. The first pipe
    // after it is the cell boundary; everything past it belongs to the page,
    // not the role.
    const body = raw.slice(start, end).split("|")[0];
    const description = unmangle(body);
    if (description.length < 20) continue;

    entries.push({ name: unmangle(name), description });
  }

  return entries;
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: node scripts/corpus/parse-corpus.mjs <exported-doc.txt>");
    process.exit(1);
  }

  const entries = parseCorpus(readFileSync(input, "utf8"));
  if (entries.length < 50) {
    console.error(
      `Only ${entries.length} role entries were found. The export format has probably ` +
        `changed — check that role names still appear as "\\[ NAME \\]".`,
    );
    process.exit(1);
  }

  const profile = summarise(entries.map((entry) => measureDescription(entry.description)));

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString().slice(0, 10),
        source: {
          description:
            "Breakdown Services / Actors Access breakdowns, parsed from a private Google Doc export.",
          roleEntries: entries.length,
          note:
            "Derived statistics only. The breakdown text is copyright Breakdown Services, Ltd. " +
            "and is deliberately not stored in this repository.",
        },
        profile,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`parsed ${entries.length} role entries`);
  console.log(JSON.stringify(profile, null, 2));
}

// Importable for tests; only parses a file when run directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
