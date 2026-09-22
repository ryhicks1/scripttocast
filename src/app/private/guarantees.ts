/**
 * What the private path enforces, in one place so the two pages cannot drift.
 *
 * The hosted setup guide and the local tool both show this. Each line
 * corresponds to something the test suite checks — the loopback guard in
 * assertLocalOllama, the absence of any other outbound request on this path,
 * and the evidence dump being off by default. Anything added here that the
 * code does not enforce is a promise this product cannot keep.
 */
export const GUARANTEES = [
  "One outbound request, to 127.0.0.1. A non-local address is refused rather than used — the analysis stops instead.",
  "Your document is held in memory for the length of the request and then dropped. It is not written to disk.",
  "No account, no database, no upload. There is nowhere for a script to be stored.",
  "Sides and reports are generated on your machine too, from the file you already have.",
];
