/**
 * Model-free checks for the v2 cast filter and helpers. Run:
 *   node --no-warnings --experimental-transform-types scripts/check-local-v2.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(s, c, n) { if (s.startsWith(".") && !/\.[a-z]+$/.test(s)) { try { return n(`${s}.ts`, c); } catch {} } return n(s, c); } });
const { junkReason, baseCue, castKey, ageFromWords } = await import("../src/lib/local-v2/cast.ts");
const { statedDecade, clampByRank, validateFields, checkFields, applyProblems, assembleBody, sharedRun, stripAgeClaims, estimateAge, narrowRange, wordCount } = await import("../src/lib/local-v2/helpers.ts");
const { buildBank, retrieve, tokenize } = await import("../src/lib/local-v2/retrieval.ts");
const { ROLE_SYSTEM, PAIRS, PAIR_ANSWER_TEXTS } = await import("../src/lib/local-v2/prompt.ts");
let failed = 0;
const ok = (cond, what) => { if (!cond) { failed++; console.error("FAIL", what); } else console.log("ok  ", what); };
const ctx = { titleKey: "DUNKIRK", headings: ["EXT. DUNKIRK BEACH - DAY"] };
const junk = (cue, stats = { cues: 2, afterTitleLine: 0 }) => junkReason(cue, castKey(baseCue(cue)), stats, ctx);

for (const cue of ["MALE VOICE (O.S.)", "VOICES", "VOICE ON RADIO", "MUSIC", "SOUND OF GUNFIRE", "THE ENEMY HAVE DRIVEN", "INT. HOLD - DAY", "ALL", "SOLDIERS", "TOMMY & ALEX", "DUNKIRK", "CUT TO", "1 THE MOLE"]) {
  ok(junk(cue) !== null, `junk: ${cue}`);
}
for (const cue of ["TOMMY", "MR. DAWSON", "SAILOR", "SUB-LIEUTENANT", "HIGHLANDER 1", "COMMANDER BOLTON", "JOHN (V.O.)", "FORTIS LEADER"]) {
  ok(junk(cue) === null, `kept: ${cue}`);
}
ok(castKey(baseCue("JOHN (V.O.)")) === castKey(baseCue("JOHN (CONT'D)")) && castKey("JOHN") === castKey(baseCue("JOHN (O.S.)")), "JOHN / JOHN (V.O.) / (CONT'D) / (O.S.) merge");
ok(castKey("THE BOY") === castKey("BOY"), "THE BOY == BOY");
ok(junk("TITLE CARD LINE", { cues: 1, afterTitleLine: 1 }) === "title card / on-screen text", "cue right after a Title: line is a title card");
ok(ageFromWords("seventeen") === 17 && ageFromWords("fifty-nine") === 59 && ageFromWords("42") === 42, "ages from words");

const F = (o = {}) => ({ gender: "Male", ageMin: 30, ageMax: 40, occupation: "Squad sergeant", relationship: "", lookCues: [], type: "", traits: [], skills: [], requirements: [], storyNote: "", ethnicity: "", ...o });
ok(validateFields(F()).ok, "valid fields pass");
ok(!validateFields(F({ gender: "Man" })).ok, "bad gender rejected");
ok(!validateFields(F({ ageMin: 30, ageMax: 20 })).ok, "inverted age range rejected");
ok(!validateFields({ ...F(), ageMin: undefined }).ok, "missing age rejected (never omitted)");
ok(!validateFields(F({ occupation: "" })).ok, "empty occupation rejected");
const cctx = (o = {}) => ({ tier: "LEAD", identity: "farell (40's, texan, muscle and sinew) glares. dawson in his cheap suit", otherNames: ["Tommy", "Gibson"], examples: PAIR_ANSWER_TEXTS, ...o });
const why = (f, c) => checkFields(F(f), cctx(c)).map((p) => `${p.field}:${p.why}`).join("|");
ok(/filler/.test(why({ traits: ["introspective"] })), "introspective rejected");
ok(/filler/.test(why({ traits: ["self-critical"] })) && /filler/.test(why({ type: "natural leader" })), "self-critical / natural leader rejected");
ok(/filler/.test(why({ type: "calm under pressure" })), "calm under pressure rejected");
ok(/age or number/.test(why({ type: "young man, 19" })) && /age or number/.test(why({ traits: ["mid-30s"] })), "age in a text field rejected");
ok(/story wording/.test(why({ type: "who fights off an attacker after the sinking" })), "plot verbs rejected in type");
ok(/names another character/.test(why({ storyNote: "Carries Tommy and Gibson", })), "storyNote naming another character rejected");
ok(/situation/.test(why({ storyNote: "Helps with the evacuation" })), "storyNote must be a situation, not an action");
ok(why({ traits: ["stern"] }, { traitUse: new Map([["stern", 3]]) }).includes("stock filler"), "a trait already on 3 roles is stock filler");
ok(/setting/.test(why({ lookCues: ["black sludge"] })), "scenery is not a look");
ok(/age or number/.test(why({ lookCues: ["nineteen"] })), "number word in a text field rejected");
ok(assembleBody(F({ occupation: "Lieutenant", requirements: ["Speaking", "Brief appearance", "Day player, brief speaking role"] }), "DAY PLAYER", true) === "Lieutenant.", "stock non-notes are dropped from requirements");
ok(!/Non-speaking/.test(assembleBody(F({ occupation: "Nurse", requirements: ["non-speaking"] }), "DAY PLAYER", true)), "non-speaking is dropped when the role speaks");
ok(/does not support/.test(why({ requirements: ["Handles a plane"] })), "a requirement with no support in the lines is rejected");
ok(why({ requirements: ["stunt work in water"] }) === "" , "stock production notes are allowed");
ok(/leads only/.test(why({ storyNote: "Carries the squad" }, { tier: "SUPPORTING" })), "storyNote on a non-lead rejected");
ok(/does not give/.test(why({ lookCues: ["red beard"] })), "lookCue not in evidence rejected");
ok(why({ lookCues: ["muscle and sinew"] }) === "", "lookCue in evidence kept");
ok(/good-looks/.test(why({ type: "handsome hero" })), "good-looks claim not in evidence rejected");
ok(/more than 2 traits/.test(why({ traits: ["a", "b", "c"] }, { tier: "DAY PLAYER" })), "trait cap per tier");
ok(/copied/.test(why({ type: "loud, hard-driving sergeant" }) + why({ type: "loud hard driving sergeant" })), "wording copied from a worked example is flagged");
ok(!/copied/.test(why({ type: "hard-driving squad leader" })), "a partial overlap with an example is not a copy");
ok(sharedRun("one two three four five six seven", ["x one two three four five six y"], 6) === "one two three four five six", "6-word run detected");
ok(sharedRun("one two three four five", ["x one two three four five six y"], 6) === "", "5 shared words are not a 6-run");
{
  const bad = F({ traits: ["introspective", "dry"], type: "young man, 19", storyNote: "" });
  const p = checkFields(bad, cctx());
  const { fields, usable } = applyProblems(bad, p);
  ok(usable && !fields.traits.includes("introspective") && fields.traits.includes("dry") && fields.type === "", "applyProblems drops only the failing parts");
  const bad2 = F({ occupation: "Sergeant in his 30s" });
  ok(!applyProblems(bad2, checkFields(bad2, cctx())).usable, "a bad occupation makes the reply unusable (retry)");
}
{
  const lead = F({ occupation: "Squad drill sergeant", relationship: "Cage's commander", lookCues: ["muscle and sinew"], type: "loud sergeant", traits: ["blustering", "relentless", "harsh", "cold", "extra"], skills: ["Texan accent"], requirements: ["stunt work"], storyNote: "Holds the line" });
  const body = assembleBody(lead, "LEAD", true);
  ok(/^Squad drill sergeant, Cage's commander\. Muscle and sinew\. Loud sergeant\. Blustering, relentless, harsh, cold\. Texan accent\. Stunt work\. Holds the line\.$/.test(body), `assembled in breakdown order: ${body}`);
  ok(!/extra/.test(body), "lead capped at 4 traits");
  const dp = assembleBody(F({ occupation: "Nurse", traits: ["brisk", "kind", "third"], requirements: ["one line"], storyNote: "should not show" }), "DAY PLAYER", true);
  ok(dp === "Nurse. Brisk, kind. One line.", `day player stays short: ${dp}`);
  const long = assembleBody(F({ occupation: "Ship's captain", type: "a b c d e f", traits: ["x", "y", "z", "w"], lookCues: ["one two three four five six seven eight nine ten", "eleven twelve thirteen fourteen fifteen sixteen"], skills: ["s1 s2 s3 s4 s5 s6", "t1 t2 t3 t4 t5 t6", "u1 u2 u3 u4 u5 u6"], requirements: ["r1 r2 r3 r4 r5 r6 r7 r8 r9", "q1 q2 q3 q4 q5 q6 q7 q8 q9"], storyNote: "n1 n2 n3 n4 n5 n6 n7 n8 n9 n10 n11" }), "DAY PLAYER", true);
  ok(wordCount(long) <= 40 && /^Ship's captain\./.test(long), `day-player cap 40 words, identity kept (${wordCount(long)})`);
  ok(/Non-speaking\.$/.test(assembleBody(F({ occupation: "Medic" }), "DAY PLAYER", false)), "silent role says non-speaking");
}
ok(statedDecade(["Mr. Dawson", "Dawson"], ["Dawson (fifties, civilian dress) hands George a stack"])?.join() === "50,59", "decade from a parenthetical: fifties");
ok(statedDecade(["Farell"], ["FARELL (40’s, TEXAN, muscle and sinew) glares."])?.join() === "40,49", "decade from a parenthetical: 40's");
ok(statedDecade(["Cage"], ["CAGE (now late 30’s) stares"])?.join() === "36,39", "late 30's");
ok(statedDecade(["Tommy"], ["Tommy squints (three lines of men)"]) === null, "no decade, no range");
ok(clampByRank("Private", "Private", 33, 48).join() === "18,30" && clampByRank("Farrier", "Pilot", 33, 48).join() === "33,48", "rank clamp does not squash a range to two years");
ok(narrowRange(25, 55, 15).join() === "33,48" && narrowRange(30, 38, 15).join() === "30,38", "age range narrowed to 15 years");
// The exact v2.0 bug: "mid-to-" left behind after the decade was cut.
for (const [inp, bad] of [
  ["A young adult, in his mid-to-late 30s, who is a leader.", /mid|30|to-/],
  ["A young adult, in his mid-to-, who is a leader.", /mid|to-,/],
  ["Sergeant, early-to-mid 40s or so, hard.", /early|mid|40/],
  ["Pilot in her early 20s who flies.", /early|20/],
]) {
  const out = stripAgeClaims(inp);
  ok(!bad.test(out) && !/,\s*,|\s,|,\./.test(out), `no mid-to- debris: ${out}`);
}
// Retrieval: BM25 over a tiny synthetic bank, not the real one.
{
  const mk = (id, tier, text) => ({ id, name: "x", tier, text, words: text.split(" ").length + 12, headOk: true });
  const bank = buildBank([
    mk(1, "SUPPORTING", "Man; 40 to 50 years old; all ethnicities. Drill sergeant. Loud, hard-driving, relentless. Texan accent required. Physical action and stunts."),
    mk(2, "DAY PLAYER", "Woman; 25 to 35 years old; all ethnicities. Hospital nurse. Brisk, kind. One line."),
    mk(3, "LEAD", "Woman; 30 to 40 years old; Black. Concert pianist. Warm, resilient. Trained concert pianist, sight reader."),
    { ...mk(4, "LEAD", "Man; 20 to 30 years old; all ethnicities. Embodies the theme of hope throughout the film."), plotHeavy: true },
  ]);
  ok(bank.entries.length === 3, "bank drops plot-heavy entries");
  const r = retrieve(bank, { text: "Farell drill sergeant Texan muscle shouting", tier: "SUPPORTING", gender: "Male", age: 44 }, 2);
  ok(r[0]?.id === 1 && !r.some((e) => e.id === 2 || e.id === 3), "retrieval finds the sergeant and respects gender");
  ok(tokenize("The Nurse's brisk").includes("nurse"), "tokenizer");
}
// Static prompt: size, 8 pairs, banned list, no Dunkirk, no Breakdown Services text.
ok(PAIRS.length === 8, "eight worked pairs");
ok(ROLE_SYSTEM.length < 15000, `static prompt is ${ROLE_SYSTEM.length} chars`);
ok(/introspective/.test(ROLE_SYSTEM) && /calm under pressure/.test(ROLE_SYSTEM), "banned words are listed to the model");
ok(!/dunkirk|tommy|farrier|peter\b|dawson|collins|moonstone/i.test(ROLE_SYSTEM.replace(/Murph's grandfather/g, "")), "worked examples do not use the test script");
ok(!/mid-30s|35/.test(stripAgeClaims("Airline stewardess, mid-30s, professional and friendly.")), "age claim stripped from prose");
for (const [inp, bad] of [
  ["A rugged sailor, likely in his 30s or 40s, with a no-nonsense demeanor.", /likely|30s|40s|\bor,/],
  ["Young boy, around 12-15 years old, ragged and exhausted.", /around|12|years/],
  ["A man in his early 20s who leads the group.", /early|20s/],
  ["Airline stewardess, mid-30s, professional.", /mid|30s/],
  ["Young man, 19, in a leadership role.", /19/],
]) {
  const out = stripAgeClaims(inp);
  ok(!bad.test(out) && !/,\s*,|\s,|,\./.test(out), `age stripped cleanly: ${out}`);
}
ok(estimateAge("Boy")[1] <= 16 && estimateAge("Rear Admiral")[0] >= 40, "role-noun age estimates");
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all v2 checks passed");
