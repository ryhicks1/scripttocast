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
  "Your script is read, used, and forgotten. It is never saved to your hard drive or anywhere else.",
  "No account, no sign-in, nothing uploaded. There is nowhere for a script to be kept.",
  "Sides and reports are made on your machine too, from the file you already have.",
];
