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
 * "How the script describes them" into:
 *
 *   intro   — the character's name in CAPS, which is the screenplay convention
 *             for a described entrance and the one line that reliably says who
 *             a person is;
 *   look    — carries appearance, age, build, dress or voice vocabulary;
 *   moves   — everything else: blocking. "He crosses to the window."
 *
 * A role whose evidence is all `moves` cannot produce a castable description,
 * no matter what the prompt says. That is the number to watch.
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
  /\b(\d{1,2}s?\b|teen|twenties|thirties|forties|fifties|sixties|seventies|eighties|young|old|elderly|middle[- ]aged|aged|boy|girl|kid|child|baby|man|woman|guy|lady|gentleman|tall|short|thin|thick|slim|slight|lean|heavy|stocky|broad|small|big|wiry|gaunt|weathered|handsome|beautiful|pretty|plain|grey|gray|greying|blonde?|brunette|red[- ]haired|bald|beard|moustache|mustache|stubble|hair|eyes|face|skin|scar|tattoo|limp|suit|uniform|dress|coat|jacket|boots|glasses|voice|accent|drawl|growl|whisper)\b/i;

function classify(line, name) {
  const body = line.replace(/^\(p\d+\)\s*/, "");
  const caps = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(body);
  if (caps) return "intro";
  if (LOOK.test(body)) return "look";
  return "moves";
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

function bar(counts) {
  return `${String(counts.intro).padStart(2)} intro  ${String(counts.look).padStart(2)} look  ${String(counts.moves).padStart(2)} moves`;
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

  const totals = { intro: 0, look: 0, moves: 0 };
  let noDescription = 0;
  let movesOnly = 0;

  for (const character of characters) {
    const tier = tiers.get(character.name) ?? "DAY PLAYER";
    const evidence = buildEvidence(script, character, 2400);
    const described = section(evidence.text, "How the script describes them");
    const counts = { intro: 0, look: 0, moves: 0 };
    for (const line of described) counts[classify(line, character.name)]++;
    totals.intro += counts.intro;
    totals.look += counts.look;
    totals.moves += counts.moves;
    if (!described.length) noDescription++;
    else if (!counts.intro && !counts.look) movesOnly++;

    const evidencePages = pagesOf(described);
    const span = evidencePages.length
      ? `p${Math.min(...evidencePages)}-${Math.max(...evidencePages)}`
      : "none";
    const appears = character.pages.length
      ? `p${Math.min(...character.pages)}-${Math.max(...character.pages)}`
      : "none";

    console.log(
      `${displayName(character.name).padEnd(24)} ${tier.padEnd(11)} ` +
        `${String(character.cues).padStart(4)} cues  ${bar(counts)}  ` +
        `describes ${span.padEnd(11)} speaks ${appears}`,
    );

    const showFull = options.full || options.role;
    if (showFull) {
      console.log(`\n--- evidence handed to the model for ${displayName(character.name)} ` +
        `(budget ${DESCRIPTION_BUDGET[tier]} chars of description) ---`);
      for (const line of described) {
        console.log(`  [${classify(line, character.name).padEnd(5)}] ${line}`);
      }
      const rest = evidence.text.split("\n\n").filter((b) => !b.startsWith("How the script describes them"));
      for (const block of rest) console.log(`\n  ${block.split("\n").join("\n  ")}`);
      console.log("--- end ---\n");
    }
  }

  const lines = totals.intro + totals.look + totals.moves;
  console.log(
    `\n${characters.length} roles, ${lines} description lines: ` +
      `${totals.intro} intro, ${totals.look} look, ${totals.moves} moves ` +
      `(${lines ? Math.round((totals.moves / lines) * 100) : 0}% blocking).\n` +
      `${noDescription} roles with no description evidence at all, ` +
      `${movesOnly} with nothing but blocking.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
