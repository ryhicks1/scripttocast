# Private v2 (Ollama only)

A separate copy of the local analysis path, so v1 (`/api/analyze-local`) stays as the comparison point.
Branch `private-v2`. Nothing in `src/lib/local/` or `src/app/api/analyze-local/` was edited.

- Route: `POST /api/analyze-local-v2` (same request/response contract as v1: multipart `files`, `mode`, `locale`, NDJSON stream).
- Code: `src/lib/local-v2/cast.ts` (cast + junk filter), `pipeline.ts` (per-role calls), `helpers.ts` (validation, ages).
- No Anthropic or cloud call anywhere in v2. Ollama must be on loopback (same guard as v1).
- Model: `OLLAMA_V2_MODEL`, else `OLLAMA_MODEL`, else the default (llama3.1:8b). Window: `OLLAMA_NUM_CTX` (default 8192), capped at 16384.
- Each role is one small call (about 1 to 3 KB of evidence), not the whole script, so memory stays near the model size plus about 1 GB.
- Reply is schema-constrained (gender enum, integer ageMin/ageMax, description, traits), validated, retried once, then falls back to a deterministic entry.
- Checks with no model: `node --no-warnings --experimental-transform-types scripts/check-local-v2.mjs`

## v2.1: description step (form fields, checks, local retrieval)

The model no longer writes a paragraph. Per role it fills a form (`src/lib/local-v2/prompt.ts`): gender, ageMin/ageMax, occupation, relationship, lookCues, type, traits, skills, requirements, storyNote (leads only), ethnicity. Code checks every field (`helpers.ts` `checkFields`), drops what fails, retries once when most of the form is wrong, and assembles the line in the order real breakdowns use, capped at 90 / 65 / 40 words for lead / supporting / day player.

- Evidence (`evidence.ts`): INTRODUCTION, LOOK AND AGE, JOB AND TIES, PHYSICAL WORK, DIALOGUE. Only sentences whose subject is the character; the script's stated age or decade beats the model's.
- Ethnicity: `all ethnicities` unless the script itself says one. A nationality goes to an accent line, never to ethnicity.
- Post-checks: numbers/ages in text fields, banned filler and plot words, look cues not in the script lines, scenery as look, stock traits repeated across roles, copied wording from the worked examples or retrieved entries, storyNote must be a situation grounded in the lines.
- `stripAgeClaims` bug fixed: "in his mid-to-late 30s" left "in his mid-to-," behind.
- Prompt: rules, banned words, and 8 worked pairs written from Edge of Tomorrow / Shawshank / Interstellar (safe to commit; none from Dunkirk).

### Local retrieval of real breakdown entries (confidential)
`OLLAMA_V2_RETRIEVAL=1` (default on; `0` turns it off). For each role, BM25 (`retrieval.ts`, no model, no network) picks the 6 most similar real entries and puts their prose (not the age/ethnicity head) in that role's prompt to the local Ollama.

The bank is Breakdown Services text and is **not in this repository**. It is read from `S2C_FEWSHOT_BANK`, else `~/.scripttocast/fewshot-bank.LOCAL-CONFIDENTIAL.json`. `.gitignore` blocks `*LOCAL-CONFIDENTIAL*`, `fewshot-bank*` and `*.confidential.json` as a second lock. Missing bank = retrieval quietly off (the 8 worked pairs still apply). Never copy the bank into the tree, never bundle it in the app.

Diagnostics (`meta.diagnostics`): `promptTokens` (real, from Ollama's own counts), `perRole`, `descriptionRejects`, `gendersDefaulted`, `occupationsReplaced`, `retrieval`.


## Scans and watermarked scripts (local OCR)

A scanned script (image only, often with a name stamped across every page as a grey stipple, often stored upside down) used to fail with "has no text layer". v2 now reads it locally. Nothing leaves the Mac: `pdftoppm` (poppler) and `tesseract`, both from Homebrew, no new npm packages, no cloud.

**Env flags.** `LOCAL_OCR=0` (also `false`, `off`, `no`) turns OCR off; the error then says so. Default is on for `/api/analyze-local-v2`. `/api/select-sides` uses it only where it would otherwise refuse the file. v1 (`/api/analyze-local`) is unchanged: it never asks for OCR and still throws the same error. Users are told "about 30 seconds" in the progress stream (about 25 to 40 s for 38 pages on the Air; a 106-page scan took about 100 s). Missing tools give `brew install poppler tesseract`.

**When OCR runs** (`extractDocument(file, { ocr })`, `src/lib/local/extract.ts`): no text layer (under 200 characters), or, in `auto` mode (v2 only), a text layer where 150+ words are under 50% real English (`wordcheck.ts`, system dictionary, no bundled list). A garbled layer is only replaced if the scan reads at least 10 points better.

**How a page is cleaned** (`ocr-image.ts`, `ocr.ts`, pure JS, no Pillow):
1. Render at 300 dpi grey (pdftoppm applies /Rotate), blur (sigma 1.5): the fine stipple turns light grey, black type stays dark.
2. The cut is chosen per page from its own histogram: Otsu, a three-way split when the page has little ink, and a cap so a heavy watermark is never read as ink (type is a few percent of a page). No fixed 150.
3. OCR on stdin (`--psm 6`, spaces preserved). If under 75% real words: try other cuts and a heavier blur; if under 50%: flip 180, then `--psm 0` orientation. Best attempt by real words wins. Blank and stipple-only pages are skipped.
4. Pages run three at a time; the first page alone so orientation is known.

**Watermark and cue repair** (`watermark.ts`): repeated lines that wander the page, or identical long lines at one spot, and diagonal runs of weak fragments are dropped (a cue in its column is never dropped); a name stamped at an odd angle in a text layer is removed if it repeats on 40%+ of pages; leading and trailing stipple fragments on cue lines are trimmed; scene numbers are stripped and misread INT./EXT. repaired; cues are snapped to the cast list (repaired from names in capitals in the action, since the cast list is OCR too), so ISAAC, THORFINN and HETTY come out right.

**Word spacing.** OCR text layers hold one item per word with no space items, so lines came out glued. A gap of over 20% of text height becomes a space, only when the layer looks word-per-item (50+ items, nearly no space items). Normal PDFs are byte-identical.

**Files.** Upload written once to a `0700` temp dir, each page deleted as soon as it is read, dir removed in `finally` (also on error). `execFile` with argument arrays. Error messages never carry script text; only counts and timings are logged (`meta.ocr`).

**Decisions (boss, 30 Sep).** OCR is capped at **250 pages per script** (`MAX_PAGES` in `ocr.ts`; above it the run stops with "OCR is limited to 250 pages"). The **sides picker keeps OCR on scans**, only where it used to refuse (`select-sides` calls `extractDocument(..., { ocr: "empty" })`; a file with a text layer is never OCR'd there; off on Vercel). No cast-list confirmation step.

Checks (no model): `npm run check:ocr`.


## v2.2: the enlarged few-shot bank and real (script -> breakdown) pairs

**Bank.** The retrieval bank is now the old 308 entries plus 109 roles from CN's Scripts + Breakdowns (given to CN by the casting director for training), 417 in all. Every entry carries `source` (`old-bank` or `cn-scripts-breakdowns`), and the new ones carry `script`, `project`, `tierAsWritten`, `ageAsWritten`, `seriesRegular`, `trimmed`. None of it is in the repo: the bank, the OCR text, the cached page lines and the ground truth live in `~/scripttocast-data/` (0700, files 0600) and the bank is loaded by `S2C_FEWSHOT_BANK`. `.gitignore` also blocks `*LOCAL-CONFIDENTIAL*` and `fewshot-bank*`, which the file names match.

**How the 109 were turned into entries** (`~/scripttocast-tests/tools/bank/build-bank.py`, not in the repo):
- Tier map: series regular and fractional series regular -> LEAD; recurring, guest star, one-day guest star, principal -> SUPPORTING; co-star, large co-star, actor, non-speaking -> DAY PLAYER. Untiered: "no lines" or under 10 lines -> DAY PLAYER, 10+ lines or several episodes -> SUPPORTING.
- Ages: decades and OCR forms become ranges in the app's head, `Man; 30 to 39 years old; ...` ("30s" -> 30 to 39, "late 20s" -> 26 to 29, "30s - 50s" -> 30 to 59, "35" -> 33 to 37, "40ish" -> 37 to 43).
- Text: production lines, tier tags and OCR debris removed; trimmed to the style guide (identity, look, type; no backstory, no outcome, no plot verbs). Series-regular entries are cut to their first two sentences and rank lower as examples (-0.6), so guest / co-star / principal are the preferred targets. Entries with under 4 words left after trimming are flagged `plotHeavy` and dropped by `buildBank` (22 of 109), leaving 87.

**Real pairs (first choice).** For every role whose name is found in its script, `attach-evidence.mjs` runs the app's own `extractCast` + `buildEvidence` on the cached script and stores the evidence block on the entry (`evidence`). 50 of the 60 usable new entries in the dev bank have one. In the role prompt (`retrievePairs` in `retrieval.ts`, `pairExampleText` in `prompt.ts`) up to 2 pairs of the **same tier** with a BM25 score of 2.0 or more come first as "REAL PAIRS": the evidence (introduction, look, job; never dialogue, cut to about 700 characters) next to the written breakdown, with the age as a range and no ethnicity. Plain prose entries fill the rest of the 6 slots. Below the score floor there are no pairs and the prompt is the old one.

**Cast fix.** Production drafts number their scenes ("12.1 INT. KITCHEN"), and the shared classifier saw no scenes and no cast (Ghosts 112/113 and Beyond the Gates gave 0 roles). `stripSceneNumbers` (`cast.ts`, v2 only) removes the number in front of INT/EXT/I/E. The shared classifier and v1 are untouched.

**Eval hooks (loopback only, off by default).** `S2C_EVAL=1` on the server, and a request whose Host is loopback, lets a request carry `evalSkipScripts` (script slugs to leave out of retrieval) and `evalModel`. They can only remove examples or pick a local model. Without `S2C_EVAL=1` both fields are ignored.

**Models.** `OLLAMA_V2_MODEL` (or `evalModel`). For the `qwen3` family the request now sends `think: false` (otherwise the reasoning eats the output budget and the JSON comes back empty); other models never get the field.

**Eval.** `~/scripttocast-tests/tools/eval-breakdowns.mjs`: 20 scripts, 109 expected roles, 14 dev scripts (84 roles) and 6 held-out (25 roles, one per show, no show shared with dev). Leave-one-script-out: each call skips the script itself, the rest of its show, and all held-out scripts. Scores: recall (fuzzy name match), extra and junk roles, age-range overlap, gender agreement, tier agreement, description similarity to the written target, and style (word cap by tier, banned words, plot-recap wording, age in prose, head and tier tag). `--selftest` and `--plan` need no model. Held-out scripts need `--final`, once. `run-eval-overnight.sh` runs models one after another; it is not started by anything.

Checks (no model): `node --no-warnings --experimental-transform-types scripts/check-local-v2.mjs` (now covers pairs, leave-one-out, series rank, scene numbers, qwen3 flag).

### Could the public (Claude) path use the same bank? (proposal only; nothing changed)
The public prompt is `src/lib/prompts.ts` on main (worked examples inline, about line 64 and 118). It could take the same real pairs as few-shot, but the bank must not sit in the repo or the bundle:
1. Keep the bank as a private file outside git and outside `src/`/`public/`. Load it at request time on the server only: an encrypted object in private storage (a private Vercel Blob or an S3 bucket with no public access), or an encrypted env value for a small subset. Never import it in client code and never `NEXT_PUBLIC_`.
2. A small `src/lib/fewshot-server.ts` (`import "server-only"`) would return at most 2 to 3 trimmed pairs per request, picked by the same BM25 code by tier and type, and `prompts.ts` would append them under "REAL PAIRS". Only trimmed text goes out, never the whole bank, never ethnicity/age heads.
3. Use only the guest / co-star / principal pairs and only from scripts CN may use for training; drop the held-out scripts while measuring.
4. Security: this text would go to Anthropic with each public request, so it needs the boss's sign-off that CN's training licence covers sending it to a third-party API (it is a different use from local training). Log ids only, never the text; keep the storage token server-side; rotate if leaked. The reverse never happens: uploaded scripts and their breakdowns go to Anthropic only through the existing public path, and never through the private path (`analyze-local-v2` has no Anthropic import and no fallback).
5. Measure first: run the public path on the 14 dev scripts with and without the pairs and compare with `eval-breakdowns.mjs`-style scoring (it is model-agnostic once given a result JSON).
