/**
 * Show what the model is actually given, without running a model.
 *
 * Every description failure on this path so far has been one of two things: the
 * evidence was poor and the model reported it faithfully, or the evidence was
 * good and the model ignored it. Telling those apart has needed a real Ollama
 * run, ten minutes, and a human reading the result — which is why it kept not
 * happening, and why four prompt changes shipped without anyone knowing which
 * failure they were aimed at.
 *
 * Nothing here needs a model, a server, or a network. It runs the same
 * extraction and the same buildEvidence the route runs, and prints the block
 * each role's prompt would carry, with a per-role count of what is in it:
 *
 *   node scripts/inspect-evidence.mjs script.pdf            # summary table
 *   node scripts/inspect-evidence.mjs script.pdf --role MAL # one role in full
 *   node scripts/inspect-evidence.mjs script.pdf --full     # every role in full
 *   npm run evidence:local -- --fixture movement --assert   # look/moves regression
 *
 * The script is read into memory and never written anywhere.
 *
 * The classifier below is a diagnostic, not a filter. It sorts the lines in
 * "How the script describes them" into `look` (carries appearance, age, build,
 * dress or voice vocabulary) and `moves` (everything else: blocking — "He
 * crosses to the window"). A role whose evidence is all `moves` cannot produce
 * a castable description, no matter what the prompt says.
 *
 * Three other columns matter as much:
 *
 *   N of M mentions — how many action lines name this character in the whole
 *                     script, against the six describedIn() keeps. A lead with
 *                     200 is still described from a sample; the sample has to
 *                     include the line that says what they look like.
 *   entrance        — whether the FIRST action line naming them says anything
 *                     about the person. If it does not, nothing downstream can.
 *   taken / pool    — the page span the six came from, against the span they
 *                     were drawn from.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

// The route's own modules are TypeScript, and they import each other the way
// TypeScript does — "./errors", no extension. Node strips the types but does
// not rewrite the specifier, so resolution has to be taught the extension.
// Running the real modules is the whole point: a reimplementation here would
// diagnose a pipeline that does not exist.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        // Fall through to the specifier as written.
      }
    }
    return next(specifier, context);
  },
});

const { extractDocument } = await import("../src/lib/local/extract.ts");
const {
  parseScript,
  assignTiers,
  buildEvidence,
  displayName,
  actionMentions,
  hasAppearance,
  DESCRIPTION_BUDGET,
} = await import("../src/lib/local/screenplay.ts");

function parseArgs(argv) {
  const options = { full: false, role: null, limit: 0, fixture: null, assert: false };
  const inputs = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--full") options.full = true;
    else if (arg === "--assert") options.assert = true;
    else if (arg === "--role") options.role = argv[++i];
    else if (arg === "--limit") options.limit = Number(argv[++i]);
    else if (arg === "--fixture") options.fixture = argv[++i];
    else inputs.push(arg);
  }
  return { inputs, options };
}

/**
 * Does this line say anything about the person, or only move them around?
 *
 * The first version asked whether the character's name appeared in caps, on
 * the theory that caps marks a described entrance. It cannot: describedIn()
 * selects action lines with a case-sensitive match on the caps cue name, so
 * every line it returns carries the name in caps by construction. That column
 * read 100% intro on a synthetic fixture and on a 147-page feature — look 0,
 * moves 0, 0% blocking — which is a tautology, not a measurement. Appearance
 * vocabulary is what separates a look from blocking. The same test now decides
 * which lines are kept once the pool is longer than the cap, so a count and
 * the evidence the model sees cannot drift apart.
 */
function classify(line) {
  return hasAppearance(line.replace(/^\(p\d+\)\s*/, "")) ? "look" : "moves";
}

/**
 * What the old selector handed the model: the first six mentions, in order.
 * Kept here so a fixture can show the before-state next to the current one.
 * An intro-first reading of those six is what a feature run reported as
 * look 0, moves 0 — every line was an "intro" because every line had the name.
 */
function documentOrderLines(mentions, limit = 6) {
  return mentions.slice(0, limit).map((line) => `(p${line.page}) ${line.text.slice(0, 400)}`);
}

function introFirstCounts(lines, name) {
  const caps = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const counts = { intro: 0, look: 0, moves: 0 };
  for (const line of lines) {
    const body = line.replace(/^\(p\d+\)\s*/, "");
    if (caps.test(body)) counts.intro++;
    else if (hasAppearance(body)) counts.look++;
    else counts.moves++;
  }
  return counts;
}

function section(evidence, heading) {
  const blocks = evidence.split("\n\n");
  const found = blocks.find((block) => block.startsWith(heading));
  if (!found) return [];
  return found.split("\n").slice(1).filter(Boolean);
}

function pagesOf(lines) {
  return lines.map((line) => Number(line.match(/^\(p(\d+)\)/)?.[1] ?? 0)).filter(Boolean);
}

function span(pages) {
  if (!pages.length) return "none";
  const low = Math.min(...pages);
  const high = Math.max(...pages);
  return low === high ? `p${low}` : `p${low}-${high}`;
}

const FIXTURES = {
  movement: "makeMovementPdf",
  blocking: "makeBlockingPdf",
  screenplay: "makeScreenplayPdf",
};

async function fixturePdf(name) {
  const maker = FIXTURES[name];
  if (!maker) {
    console.error(
      `unknown fixture "${name}". expected one of: ${Object.keys(FIXTURES).join(", ")}`,
    );
    process.exit(2);
  }
  const { [maker]: make } = await import("./make-test-script.mjs");
  const dir = mkdtempSync(join(tmpdir(), "scripttocast-evidence-"));
  const path = join(dir, `${name}.pdf`);
  writeFileSync(path, await make());
  return path;
}

function introKept(described, mentions) {
  if (!mentions.length) return false;
  const needle = mentions[0].text.slice(0, 80);
  return described.some((line) => line.includes(needle));
}

async function main() {
  const { inputs, options } = parseArgs(process.argv.slice(2));
  const path = options.fixture ? await fixturePdf(options.fixture) : inputs[0];
  if (!path) {
    console.error(
      "usage: node scripts/inspect-evidence.mjs <script.pdf> [--role NAME] [--full] [--limit N]\n" +
        "       node scripts/inspect-evidence.mjs --fixture movement --assert",
    );
    process.exit(2);
  }

  const bytes = readFileSync(path);
  const file = new File([bytes], basename(path), { type: "application/pdf" });
  const doc = await extractDocument(file);
  const script = parseScript(doc.pageLines);
  const tiers = assignTiers(script.characters);

  console.log(
    `${basename(path)}: ${doc.pages.length} pages, ${script.characters.length} characters, ` +
      `${script.actionLines.length} action lines, layout ${script.usedLayout ? "read" : "UNAVAILABLE"}, ` +
      `screenplay ${script.looksLikeScreenplay ? "yes" : "no"}\n`,
  );

  let characters = script.characters;
  if (options.role) {
    const wanted = options.role.toUpperCase();
    characters = characters.filter((c) => c.name.toUpperCase().includes(wanted));
    if (!characters.length) {
      console.error(`no character matching "${options.role}". Cast: ${script.characters.map((c) => c.name).join(", ")}`);
      process.exit(1);
    }
  }
  if (options.limit) characters = characters.slice(0, options.limit);
  // The movement check has to see the whole cast. --role only filters the table.
  const visible = new Set(characters.map((character) => character.name));

  const totals = { look: 0, moves: 0, intro: 0 };
  let noDescription = 0;
  let bareEntrance = 0;
  let truncated = 0;
  let fixableByRanking = 0;
  let starved = 0;
  const rows = [];

  for (const character of script.characters) {
    const tier = tiers.get(character.name) ?? "DAY PLAYER";
    const evidence = buildEvidence(script, character, 2400);
    const described = section(evidence.text, "How the script describes them");
    const counts = { look: 0, moves: 0 };
    for (const line of described) counts[classify(line)]++;

    // The whole pool, against the lines that were taken from it.
    const mentions = actionMentions(script, character.name);
    const keptIntro = introKept(described, mentions);

    // The entrance is the first action line that names them, and it is the one
    // line a screenplay reliably spends on saying who somebody is. If it says
    // nothing about the person, the description has to come from a later line.
    const entrance = !mentions.length
      ? "none"
      : hasAppearance(mentions[0].text)
        ? "described"
        : "bare";

    // A role whose taken lines are all blocking is in one of two situations
    // that need opposite fixes. Either the script DOES describe them somewhere
    // and selection walked past it, or no action line anywhere says a word
    // about them and reselection cannot help.
    const lookInPool = mentions.filter((line) => hasAppearance(line.text));
    const firstLookRank = mentions.findIndex((line) => hasAppearance(line.text)) + 1;

    const verdict = counts.look
      ? "ok"
      : lookInPool.length
        ? "RANKING"
        : "STARVED";

    if (visible.has(character.name)) {
      totals.look += counts.look;
      totals.moves += counts.moves;
      if (keptIntro) totals.intro++;
      if (!described.length) noDescription++;
      if (entrance === "bare") bareEntrance++;
      if (mentions.length > described.length) truncated++;
      if (verdict === "RANKING") fixableByRanking++;
      if (verdict === "STARVED" && described.length) starved++;
    }

    const beforeLines = documentOrderLines(mentions);
    const beforeCounts = { look: 0, moves: 0 };
    for (const line of beforeLines) beforeCounts[classify(line)]++;
    rows.push({
      name: character.name,
      mentions,
      described,
      counts,
      beforeCounts,
      beforeIntroFirst: introFirstCounts(beforeLines, character.name),
      keptIntro,
    });

    if (!visible.has(character.name)) continue;

    console.log(
      `${displayName(character.name).padEnd(22)} ${tier.padEnd(11)} ` +
        `${String(character.cues).padStart(4)} cues  ` +
        `${String(described.length).padStart(2)} of ${String(mentions.length).padEnd(4)} mentions  ` +
        `entrance ${entrance.padEnd(10)} ` +
        `intro ${keptIntro ? "yes" : "no "} ` +
        `${String(counts.look).padStart(2)} look ${String(counts.moves).padStart(2)} moves  ` +
        `pool look ${String(lookInPool.length).padStart(2)}` +
        `${firstLookRank ? `@${String(firstLookRank).padEnd(3)}` : "    "}  ` +
        `${verdict.padEnd(8)} ` +
        `taken ${span(pagesOf(described)).padEnd(10)} ` +
        `pool ${span(mentions.map((m) => m.page)).padEnd(10)} ` +
        `speaks ${span(character.pages)}`,
    );

    const showFull = options.full || options.role;
    if (showFull) {
      console.log(`\n--- evidence handed to the model for ${displayName(character.name)} ` +
        `(budget ${DESCRIPTION_BUDGET[tier]} chars of description) ---`);
      for (const line of described) {
        console.log(`  [${classify(line).padEnd(5)}] ${line}`);
      }
      const rest = evidence.text.split("\n\n").filter((b) => !b.startsWith("How the script describes them"));
      for (const block of rest) console.log(`\n  ${block.split("\n").join("\n  ")}`);
      console.log("--- end ---\n");
    }
  }

  const lines = totals.look + totals.moves;
  console.log(
    `\n${visible.size} roles, ${lines} description lines: ` +
      `${totals.look} carry a look, ${totals.moves} are blocking ` +
      `(${lines ? Math.round((totals.moves / lines) * 100) : 0}% blocking).\n` +
      `${totals.intro} roles whose introduction line is still in the evidence.\n` +
      `${noDescription} roles with no description evidence at all.\n` +
      `${bareEntrance} roles whose first action line says nothing about the person.\n` +
      `${truncated} roles with more mentions in the script than were taken.\n` +
      `${fixableByRanking} RANKING — taken lines are all blocking, but the script ` +
      `describes them somewhere in the pool. Content selection should have kept that line.\n` +
      `${starved} STARVED — no action line anywhere in the script says a word about ` +
      `them. Reselection cannot help; their description has to come from what ` +
      `other characters say, or it cannot be written.`,
  );

  if (options.fixture === "movement") {
    const failed = reportMovementFixture(rows);
    if (failed) process.exit(1);
  } else if (options.assert) {
    console.error("\n--assert checks the movement fixture. Pass --fixture movement.");
    process.exit(2);
  }
}

/**
 * The movement fixture is built so the old selector fails in a way we can
 * name. Calder's appearance line is past the sixth mention, so document order
 * keeps six blocking lines (look 0). Reading those six as introductions,
 * because each contains his name in caps, is the Inception result: look 0 and
 * moves 0 as well. Vess is introduced with a look on page 1; that line has to
 * stay.
 */
function reportMovementFixture(rows) {
  const calder = rows.find((row) => row.name === "CALDER");
  const vess = rows.find((row) => row.name === "VESS");
  const failures = [];
  const expect = (ok, message) => {
    if (!ok) failures.push(message);
  };

  console.log("\nmovement fixture, before and after selection:");
  for (const row of [calder, vess]) {
    if (!row) continue;
    const old = row.beforeIntroFirst;
    console.log(
      `  ${displayName(row.name).padEnd(8)} ` +
        `document-order + intro-first: ${old.intro} intro, ${old.look} look, ${old.moves} moves; ` +
        `document-order by vocabulary: ${row.beforeCounts.look} look, ${row.beforeCounts.moves} moves; ` +
        `taken now: intro ${row.keptIntro ? "yes" : "no"}, ${row.counts.look} look, ${row.counts.moves} moves`,
    );
  }

  expect(calder, "Calder was not parsed out of the movement fixture");
  expect(vess, "Vess was not parsed out of the movement fixture");
  if (calder) {
    expect(
      calder.beforeIntroFirst.intro > 0 &&
        calder.beforeIntroFirst.look === 0 &&
        calder.beforeIntroFirst.moves === 0,
      "before-state drifted: Calder's first six lines should read as all intro (look 0, moves 0)",
    );
    expect(
      calder.beforeCounts.look === 0 && calder.beforeCounts.moves > 0,
      "before-state drifted: document order should keep only blocking for Calder",
    );
    expect(calder.counts.look > 0, "Calder's appearance line was not extracted");
    expect(calder.counts.moves > 0, "Calder's blocking lines were not extracted");
    expect(calder.keptIntro, "Calder's introduction line was dropped");
  }
  if (vess) {
    expect(vess.counts.look > 0, "Vess's introduction no longer counts as a look");
    expect(vess.counts.moves > 0, "Vess's blocking lines were not extracted");
    expect(vess.keptIntro, "Vess's introduction line was dropped");
  }

  if (failures.length) {
    console.error(`\n${failures.length} movement-fixture check(s) failed:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return true;
  }
  console.log("\nmovement fixture checks passed: look and moves are both extracted, introductions kept.");
  return false;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
