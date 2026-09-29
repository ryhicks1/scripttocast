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
