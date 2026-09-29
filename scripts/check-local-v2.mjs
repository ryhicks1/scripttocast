/**
 * Model-free checks for the v2 cast filter and helpers. Run:
 *   node --no-warnings --experimental-transform-types scripts/check-local-v2.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(s, c, n) { if (s.startsWith(".") && !/\.[a-z]+$/.test(s)) { try { return n(`${s}.ts`, c); } catch {} } return n(s, c); } });
const { junkReason, baseCue, castKey, ageFromWords } = await import("../src/lib/local-v2/cast.ts");
const { validateReply, stripAgeClaims, estimateAge } = await import("../src/lib/local-v2/helpers.ts");
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

ok(validateReply({ gender: "Male", ageMin: 18, ageMax: 22, ethnicity: "", description: "A quiet young private, watchful and careful with people.", traits: [] }).ok, "valid reply passes");
ok(!validateReply({ gender: "Male", ageMin: 18, ageMax: 22, ethnicity: "", description: "Short.", traits: [] }).ok, "empty description rejected");
ok(!validateReply({ gender: "Man", ageMin: 18, ageMax: 22, ethnicity: "", description: "A quiet young private, watchful and careful.", traits: [] }).ok, "bad gender rejected");
ok(!validateReply({ gender: "Male", ageMin: 30, ageMax: 20, ethnicity: "", description: "A quiet young private, watchful and careful.", traits: [] }).ok, "inverted age range rejected");
ok(!validateReply({ gender: "Male", ageMin: 20, ageMax: 70, ethnicity: "", description: "A quiet young private, watchful and careful.", traits: [] }).ok, "age range over 30 years rejected");
ok(!validateReply({ gender: "Male", description: "A quiet young private, watchful and careful.", traits: [] }).ok, "missing age rejected (never omitted)");
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
