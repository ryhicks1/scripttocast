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

Checks (no model): `npm run check:ocr`.
