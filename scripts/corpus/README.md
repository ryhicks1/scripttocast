# Reference corpus

`reference-metrics.json` is what 68 real Breakdown Services / Actors Access
breakdowns — 310 role entries — look like, measured. It is the yardstick
`scripts/eval-local.mjs` scores a generated breakdown against, which is how
"is the private version good enough to offer?" becomes a number instead of an
opinion.

## The text is not in this repository, on purpose

The source document carries an explicit notice: the descriptions are the
proprietary property of Breakdown Services, Ltd., are confidential and
copyright protected, and may not be published or shared. So only derived
statistics are committed here — distributions, rates, counts. No breakdown
text, no role names, no project names. Please keep it that way.

## Regenerating

Export the research doc as plain text or markdown, then:

```
node scripts/corpus/parse-corpus.mjs ~/Downloads/breakdowns.txt
```

That rewrites `reference-metrics.json` and prints the profile. The export is
badly escape-mangled — literal `&#10;` for newlines, runs of backslashes before
markdown punctuation, smart quotes — and the parser undoes all of that before
measuring. It refuses to write a file if it finds fewer than 50 role entries,
which is the signal that the export format has changed.

## What the numbers mean

Measured by `scripts/lib/breakdown-metrics.mjs`, which both the corpus parser
and the scorer use, so the two sides are always measured the same way.

| metric | corpus | what it tells you |
| --- | --- | --- |
| `demographicHeadRate` | 0.91 | opens with gender + age, the house format |
| `ethnicityStatedRate` | 0.97 | real breakdowns nearly always state one, usually "all ethnicities" |
| `roleTypeStatedRate` | 0.76 | a quarter of real entries never state a tier |
| `narrativeVoiceRate` | 0.065 | professional copy slips into summarising too — this is the floor, not zero |
| `sentences.median` | 5 | with a p90 of 12: long entries are normal |
| `words.median` | 59 | prose only (after the demographic line): 50 |

`scripts/check-style-filters.mjs` measures the style filters against the same
corpus, since a filter that drops sentences has to be checked against
professional copy or it quietly deletes good writing. Current false-positive
rates on real entries: narrative voice 6.5%, book voice 2.9%.

Two of these deserve care when reading a score:

- **Ethnicity is reported but never gated.** The corpus states an ethnic
  background 97% of the time; the local prompt is told never to guess one.
  Gating against the corpus here would reward inventing them.
- **`narrativeVoiceRate` is not scored against zero.** 6.5% of real
  professional entries trip the same check, which is why the gate is a multiple
  of the corpus rate rather than an absolute.
