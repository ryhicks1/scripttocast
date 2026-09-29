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
