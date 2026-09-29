# Improving the private tool against real breakdowns

Instructions for an agent (Claude Code on the Mac that runs Ollama) to improve
the private path's descriptions unattended, in the manner of Karpathy's
autoresearch: change one thing, measure it, keep it only if the score rises.

## Setup, once

1. The data folder sits **outside** this repository, one folder per project,
   each holding the script PDF and the client's breakdown (see
   `scripts/bench/references.mjs` for formats):

       ~/scripttocast-bench/<project>/script.pdf
       ~/scripttocast-bench/<project>/breakdown.txt

2. Run `npm run bench:inspect -- --data ~/scripttocast-bench` and check the
   parsed names, genders, ages and role types against a few of the real
   breakdowns. If parsing is wrong, fix `references.mjs` (and only that)
   before anything else. A misread reference poisons every score after it.

3. Start the tool (double-click Start ScriptToCast, or `npm run dev`), and
   leave it running. Keep Ollama on one request slot.

4. Baseline, and write the number down:

       npm run bench:run   -- --data ~/scripttocast-bench --label base
       npm run bench:score -- --data ~/scripttocast-bench --label base --judge claude

   Use the same `--judge` for every run you compare. Scores from different
   judges are not comparable.

## The loop

Work on a branch: `git checkout -b autotune/<date>`.

Repeat:

1. Read the last score's **weakest roles**: the contradictions and
   low-coverage descriptions printed at the end. Form one hypothesis about
   why they went wrong.
2. Make **one** change that tests it, in the files you may edit (below).
3. `npm run check:local && npm run check:sides`. If either fails, revert the
   change. A benchmark score never excuses a broken check.
4. The dev server reloads edited code on its own. If `npm start` is serving
   the tool instead, rebuild and restart it.
5. `bench:run` and `bench:score` with a new `--label` (e.g. `exp-07-...`).
6. **Keep** if the score rose by more than 1 point and no component fell by
   more than 5 points: commit with the label, the score, and one line on
   why it worked. **Otherwise** revert with `git checkout -- <files>`, and
   note the result in `results/notes.md` in the data folder so the idea is
   not tried twice.

Change one thing at a time. Two changes in one experiment cannot be told
apart.

## What you may change

- `src/lib/local/prompts.ts`: the per-role ask
- The prompt assembly and length hints in `src/lib/local/pipeline.ts`
  (`descriptionInstructions`, `lengthHint`, the retry corrections)
- `src/lib/local/style.ts`: the post-generation filters, measured with
  `scripts/check-style-filters.mjs` before any change
- `src/lib/local/screenplay.ts`: the evidence the gates check against

## What you must not change

- Anything that decides where data goes: `assertLocalOllama`, the loopback
  and hosted-site guards, the evidence-dump default, the bench guards.
- `src/lib/prompts.ts`, the public house prompt, or `/api/analyze`.
- The benchmark's scoring, weights, or judge prompt. Moving the goalposts is
  not an improvement.
- The model in `recommended-model.json`. Changing it is a decision for a
  person; say so if the evidence points that way.
- Tests, to make them pass.

## Rules that come from experience

- **Put nothing quotable in a prompt.** Every example phrase ever placed in
  quotation marks came back as some character's description.
- **Prompt changes are cheap to write and easy to fool yourself with.** If
  a change helps one project and hurts two, it is a loss.
- **Watch for scores that rise for the wrong reason:** shorter descriptions
  contradict less but cover less, so coverage should rise with factual.
- **Speed matters too.** Note the run time; a gain that doubles it is a
  trade-off for a person to decide.

## At the end

Run the **holdout** once, with `--split holdout`, on the final version and
on `base`, and report both. The holdout projects were never looked at while
tuning; if the gain does not appear there, it was fitted to the tune set.

Push the branch and summarise: baseline, final, holdout, what worked, what
did not. Do not merge. A person reviews it.
