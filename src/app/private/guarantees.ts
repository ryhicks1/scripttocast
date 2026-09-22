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
  "Nothing is used to train an AI, and no one else's terms of service apply to your material.",
  "Your script is read (locally), then forgotten. It is never uploaded, and no copy is ever saved to your hard drive or anywhere else.",
  "No account, no sign-in, no database. There is nowhere for a script to be kept.",
  "Sides and reports are made on your machine too, from the file you already have.",
];
