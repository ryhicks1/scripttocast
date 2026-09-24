# Script To Cast

Turns a screenplay into a casting breakdown: project details, a role list with
descriptions in the house breakdown format, self-tape instructions and
job-form questions.

It runs two ways, from the same code:

| | **Public** | **Private** |
|---|---|---|
| Where | [scripttocast.com](https://www.scripttocast.com) | On a Mac you control, at `http://localhost:3000/private` |
| Who reads the script | Claude, via the Anthropic API | An open-weight model running in [Ollama](https://ollama.com) on that Mac |
| Leaves the machine? | Yes: sent to Anthropic for analysis | **No.** Nothing is sent to any AI service |
| Speed | A minute or two | Tens of minutes to an hour, depending on the machine |
| Accounts, saved projects | Yes (Supabase) | No: nothing is stored |

The private version exists because casting material is confidential,
pre-release IP.

---

## Private: install on a Mac

**Needs:** a Mac with Apple silicon (M1 or later) and at least 16 GB of memory.
More memory runs a larger model and gives better breakdowns; see
[Choosing a machine](#choosing-a-machine).

1. **Install Ollama:** download it from [ollama.com](https://ollama.com), open
   it, and drag it into Applications. A llama appears in the menu bar.
2. **Install Node.js:** download the LTS installer from
   [nodejs.org](https://nodejs.org) and run it.
3. **Download Script To Cast**:
   [the latest version as a zip](https://github.com/ryhicks1/scripttocast/archive/refs/heads/main.zip).
   It opens into a `scripttocast-main` folder; move it somewhere permanent, such as
   Documents.
4. **Double-click `Start ScriptToCast.command`** in that folder. The first time,
   macOS may refuse to open it: go to **System Settings → Privacy & Security**,
   click **Open Anyway**, and double-click it again.

The launcher does the rest, every time:

- installs what the app needs;
- starts Ollama with the right settings (one request at a time, flash
  attention, a compact memory cache) and restarts it once if needed;
- offers to download the recommended model (about 5 GB, once);
- stops any older copy of the tool that is still running;
- prints the version and opens `http://localhost:3000/private` in your browser.

Leave the Terminal window it opens running while you use the tool. Close it to
stop. Upload as many scripts as you like in one session.

**Updates.** A downloaded folder cannot update itself, so the launcher checks
the published version each time it starts and tells you when a newer one is
available. If you'd rather updates install themselves, clone the repository
instead of downloading it. The launcher then pulls each new version on start:

```
cd ~ && git clone https://github.com/ryhicks1/scripttocast.git && cd ~/scripttocast && ./Start\ ScriptToCast.command
```

For a production machine, prefer the download and update deliberately.

### What happens to a script

1. The PDF is read into memory. It is never written to disk. (A debug dump
   exists for diagnosing bad runs; it is off unless `LOCAL_DEBUG_EVIDENCE=1` is
   set, and writes to the temp folder.)
2. The cast list, page numbers and role tiers come from the screenplay's own
   formatting, with no model involved. That is what stops roles going missing.
3. The model reads the **whole script once**, then writes one role at a time
   against it. The page shows which character it is on and how long is left.
4. Each description is checked: an age or ethnicity the script never states is
   removed, text copied from the instructions is rejected, and an empty answer
   is asked for again.
5. If the first roles come back empty, or the model is re-reading the script
   for every role (which would take hours), the run stops early and says why.

The private route talks to Ollama on `127.0.0.1` and nothing else. It refuses a
non-local Ollama address, contains no Anthropic code, and has no hosted
fallback: if Ollama is unavailable it fails with an error. On the hosted site,
`/private` is a setup guide and the private API returns 403.

### Choosing a machine

The model has to hold two things in memory at once: **itself**, and **the
entire script it is reading**. A feature script alone takes 6–8 GB.

| Memory | Model size | What to expect |
|---|---|---|
| 16 GB | 8B (the default, `llama3.1:8b`) | Fluent but generic; gets some plot facts wrong. About an hour for a 40-role feature on a MacBook Air |
| 32 GB | ~30B | Follows the story much better |
| 64 GB+ | ~70B | Closest to hand-written copy |

Desktop Pro and Max chips are also several times faster than a MacBook Air and
don't slow down under sustained load. Look for a model with **128K context**:
the whole script is read at once, and a model with a smaller window cannot hold
a feature. The model is set in `recommended-model.json`; the launcher offers to
download whatever it names.

Treat the output as a strong first draft. Have someone review it before it
reaches agents.

### Known limits

- Scanned PDFs with no text layer are refused; run them through OCR first.
- The commercial / non-screenplay path is untested.
- One script at a time per machine.

---

## Public: run the hosted version

Deployed on Vercel from `main`. Environment variables:

- `ANTHROPIC_API_KEY` for analysis
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` for accounts and
  saved projects (database schema in `supabase/`)

Locally: `npm install`, then `npm run dev`.

---

## For developers

```
npm run check:local           # the private route end to end, against a stub Ollama
npm run evidence:local -- f.pdf  # what the parser extracts from a script, no model needed
npm run eval:local -- f.pdf   # score a real run against reference breakdown statistics
```

`check:local` needs no model and runs the real route in a real dev server. Each
check reproduces something that has gone wrong on a real script, and the new
ones were each confirmed to fail with their fix removed.

Where things live:

- `src/lib/prompts.ts`: the house breakdown prompt, shared by both paths
- `src/app/api/analyze/`: public analysis (Claude)
- `src/app/api/analyze-local/`, `src/lib/local/`: private analysis (Ollama)
- `scripts/corpus/`: aggregate statistics from 310 professional breakdown
  entries, used as the scoring yardstick. The source text is copyright and is
  deliberately not included.

Optional environment variables for the private path: `OLLAMA_BASE_URL`
(loopback only), `OLLAMA_MODEL`, `OLLAMA_NUM_CTX`, `OLLAMA_MAX_ROLES`,
`LOCAL_DEBUG_EVIDENCE`.
