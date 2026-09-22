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
 *                     script, against the six describedIn() stops at. A lead
 *                     with 200 and a cap of 6 is being described from act one.
 *   entrance        — whether the FIRST action line naming them says anything
 *                     about the person. If it does not, nothing downstream can.
 *   taken / pool    — the page span the six came from, against the span they
 *                     were drawn from.
 */
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { basename } from "node:path";

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
const { parseScript, assignTiers, buildEvidence, displayName, DESCRIPTION_BUDGET } = await import(
  "../src/lib/local/screenplay.ts"
);

function parseArgs(argv) {
  const options = { full: false, role: null, limit: 0 };
  const inputs = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--full") options.full = true;
    else if (arg === "--role") options.role = argv[++i];
    else if (arg === "--limit") options.limit = Number(argv[++i]);
    else inputs.push(arg);
  }
  return { inputs, options };
}

/**
 * Words a screenplay uses when it is describing a person rather than moving
 * them around. Kept deliberately broad — this counts lines, it does not decide
 * what the model sees, so a false positive costs nothing but a number.
 */
const LOOK =
  /\b(\d{1,2}s?\b|teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|twenties|thirties|forties|fifties|sixties|seventies|eighties|young|old|elderly|middle[- ]aged|aged|boy|girl|kid|child|baby|man|woman|guy|lady|gentleman|tall|short|thin|thick|slim|slight|lean|heavy|stocky|broad|small|big|wiry|gaunt|weathered|handsome|beautiful|pretty|plain|grey|gray|greying|blonde?|brunette|red[- ]haired|bald|beard|moustache|mustache|stubble|hair|eyes|face|skin|scar|tattoo|limp|suit|uniform|dress|coat|jacket|boots|glasses|voice|accent|drawl|growl|whisper)\b/i;

/**
 * Does this line say anything about the person, or only move them around?
 *
 * The first version of this asked whether the character's name appeared in
 * caps, on the theory from the brief that caps marks a described entrance. It
 * cannot: describedIn() SELECTS lines by a case-sensitive match on the caps cue
 * name, so every line it returns carries the name in caps by construction. The
 * column read 100% intro on a synthetic fixture and 100% intro on a 147-page
 * feature, which is what a tautology looks like from the outside.
 *
 * What actually separates an introduction from blocking is the vocabulary: an
 * introduction says how old someone is, what they look like, what they are
 * wearing, how they sound. Blocking says where they walked.
 */
function classify(line) {
  return LOOK.test(line.replace(/^\(p\d+\)\s*/, "")) ? "look" : "moves";
}

/**
 * Every action line naming this character, not just the six that fit.
 *
 * describedIn() takes the first six in document order and stops. Whether that
 * is a reasonable sample or an act-one crop depends entirely on how many there
 * were, which is the number nobody has had.
 */
function allMentions(script, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const caps = new RegExp(`\\b${escaped}\\b`);
  return script.actionLines.filter((line) => caps.test(line.text) && /[a-z]/.test(line.text));
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

async function main() {
  const { inputs, options } = parseArgs(process.argv.slice(2));
  const path = inputs[0];
  if (!path) {
    console.error("usage: node scripts/inspect-evidence.mjs <script.pdf> [--role NAME] [--full] [--limit N]");
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

  const totals = { look: 0, moves: 0 };
  let noDescription = 0;
  let bareEntrance = 0;
  let truncated = 0;
  let fixableByRanking = 0;
  let starved = 0;

  for (const character of characters) {
    const tier = tiers.get(character.name) ?? "DAY PLAYER";
    const evidence = buildEvidence(script, character, 2400);
    const described = section(evidence.text, "How the script describes them");
    const counts = { look: 0, moves: 0 };
    for (const line of described) counts[classify(line)]++;
    totals.look += counts.look;
    totals.moves += counts.moves;

    // The whole pool, against the six that were taken from it.
    const mentions = allMentions(script, character.name);

    // The entrance is the first action line that names them, and it is the one
    // line a screenplay reliably spends on saying who somebody is. If it says
    // nothing about the person, nothing downstream can.
    const entrance = !mentions.length
      ? "none"
      : LOOK.test(mentions[0].text)
        ? "described"
        : "bare";

    // The decisive number, and the one the entrance column cannot give.
    //
    // A role whose taken lines are all blocking is in one of two situations
    // that need opposite fixes. Either the script DOES describe them somewhere
    // and document-order selection walked past it — in which case ranking the
    // pool fixes the role and nothing else has to change. Or no action line
    // anywhere in the script says a word about them, and no amount of
    // reselection will help: that role's description has to come from what
    // other characters say, or it cannot be written.
    const lookInPool = mentions.filter((line) => LOOK.test(line.text));
    const firstLookRank = mentions.findIndex((line) => LOOK.test(line.text)) + 1;

    const verdict = counts.look
      ? "ok"
      : lookInPool.length
        ? "RANKING"
        : "STARVED";

    if (!described.length) noDescription++;
    if (entrance === "bare") bareEntrance++;
    if (mentions.length > described.length) truncated++;
    if (verdict === "RANKING") fixableByRanking++;
    if (verdict === "STARVED" && described.length) starved++;

    console.log(
      `${displayName(character.name).padEnd(22)} ${tier.padEnd(11)} ` +
        `${String(character.cues).padStart(4)} cues  ` +
        `${String(described.length).padStart(2)} of ${String(mentions.length).padEnd(4)} mentions  ` +
        `entrance ${entrance.padEnd(10)} ` +
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
    `\n${characters.length} roles, ${lines} description lines: ` +
      `${totals.look} carry a look, ${totals.moves} are blocking ` +
      `(${lines ? Math.round((totals.moves / lines) * 100) : 0}% blocking).\n` +
      `${noDescription} roles with no description evidence at all.\n` +
      `${bareEntrance} roles whose first action line says nothing about the person.\n` +
      `${truncated} roles with more mentions in the script than were taken.\n` +
      `${fixableByRanking} RANKING — all six taken lines are blocking, but the script ` +
      `describes them somewhere in the pool. Selecting on content rather than ` +
      `document order fixes these.\n` +
      `${starved} STARVED — no action line anywhere in the script says a word about ` +
      `them. Reselection cannot help; their description has to come from what ` +
      `other characters say, or it cannot be written.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
