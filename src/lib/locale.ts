/**
 * Regional variants of the breakdown.
 *
 * US terms are grounded in 310 real Breakdown Services / Actors Access entries.
 *
 * Australian terms follow MEAA Equity's screen agreements — the Actors Feature
 * Film Collective Agreement and the Actors Television Programs Agreement (ATPA),
 * negotiated with Screen Producers Australia — and Casting Guild of Australia
 * practice. Items marked REVIEW could not be read directly: this environment
 * blocks egress to meaa.org, accc.gov.au and castingguild.com.au, so they come
 * from secondary sources and want confirmation by someone with the agreements
 * in front of them.
 *
 * One distinction matters and is easy to get wrong. MEAA classifications
 * (Performer Class 1, Performer Class 2, Bit Player, Extra, Featured Extra,
 * Stand-in) are INDUSTRIAL categories describing how a performer is engaged and
 * paid. Breakdown role types (Lead, Supporting, Guest Role) describe how a role
 * is written up for submission. They overlap but are not the same vocabulary,
 * and the prompt keeps them in separate fields.
 */

export type Locale = "us" | "au";

export const LOCALES: Locale[] = ["us", "au"];

export function isLocale(value: unknown): value is Locale {
  return value === "us" || value === "au";
}

export interface LocaleTerms {
  /** Shown in the UI. */
  label: string;
  /** Path this locale is served from. */
  path: string;
  /** Where breakdowns in this market are published. */
  platforms: string;
  /** Spelling and usage instruction for all generated prose. */
  englishVariant: string;
  /** Examples for the `union` field, as they would appear on a real breakdown. */
  unionExamples: string;
  /** Role tiers, largest to smallest, used for both vocabulary and length. */
  roleTypes: { lead: string; mid: string; small: string; all: string; qualifiers: string };
  /** Examples for the `submissionNotes` field. */
  submissionNoteExamples: string;
  /** Standard questions added to every film/TV job form. */
  filmFormQuestions: string;
  /** Standard questions added to every commercial job form. */
  commercialFormQuestions: string;
  /** Signals that identify a project from this market. */
  marketSignals: string;
}

export const LOCALE_TERMS: Record<Locale, LocaleTerms> = {
  us: {
    label: "United States",
    path: "/",
    platforms: "Breakdown Services / Actors Access",
    englishVariant:
      "Write in US English.",
    unionExamples: '"SAG-AFTRA Micro Budget Agreement", "Non-Union"',
    roleTypes: {
      lead: "SERIES REGULAR or LEAD",
      mid: "GUEST STAR or SUPPORTING",
      small: "CO-STAR, DAY PLAYER or background",
      all: "SERIES REGULAR, GUEST STAR, CO-STAR, RECURRING, LEAD, SUPPORTING, DAY PLAYER",
      qualifiers: '"LARGE CO-STAR", "SUPPORTING (1 DAY)"',
    },
    submissionNoteExamples:
      '"LA LOCAL HIRES ONLY", "PLEASE INCLUDE SIZE CARDS", "MUST BE BASED IN LA", "SCALE", "ABOVE SCALE", demo clip requests',
    filmFormQuestions: `- "Are you available for all production dates?" (radio: Yes/No, required)
- "Do you have any scheduling conflicts during the production period?" (textarea)
- "List any relevant experience" (textarea)
- "Do you have a valid driver's license?" (radio: Yes/No)`,
    commercialFormQuestions: `- "Do you have any competitive commercials currently on air?" (radio: Yes/No, required)
- "Have you appeared in any competitive commercials in the last 2 years?" (radio: Yes/No, required)
- "Please list any current brand conflicts" (textarea, required)
- "Are you available for the fitting date?" (radio: Yes/No, required)
- "Are you available for all shoot dates?" (radio: Yes/No, required)
- "Do you have a valid passport?" (radio: Yes/No)
- "Are you a permanent resident or citizen?" (radio: Yes/No)
- "Do you have any visible tattoos?" (radio: Yes/No)
- "What is your clothing size?" (text)`,
    marketSignals:
      "a US union agreement such as SAG-AFTRA Micro Budget, US locations and cities",
  },

  au: {
    label: "Australia",
    path: "/au",
    platforms: "Showcast and Casting Networks Australia",
    englishVariant:
      `Write in Australian English throughout — descriptions, logline, synopsis and
form questions. Use -ise endings (realise, organise, specialise, recognise),
"licence" as a noun and "license" as a verb, and colour, centre, theatre,
defence, grey, ageing, traveller, practise (verb). Note that "program" rather
than "programme" is correct for television.`,
    // Agreement names confirmed via MEAA's published summaries. Rates and
    // engagement classes belong here, not in roleType.
    unionExamples:
      '"Actors Feature Film Collective Agreement", "Actors Television Programs Agreement (ATPA)", "MEAA Equity", "Non-Union". Where the documents name a MEAA engagement class — Performer Class 1, Performer Class 2, Bit Player, Extra, Featured Extra, Stand-in — record it here as written, not as the role type',
    // GUEST STAR -> GUEST ROLE, and CO-STAR -> BIT PLAYER, which MEAA defines as
    // a small role with direct interaction with principal cast, billed above an
    // extra and below a supporting role. FEATURED EXTRA is a real and distinct
    // category: a background performer who may be recognisable, but does not
    // speak and is not featured in individual shots.
    // REVIEW: Casting Networks models role type in two levels — Principal or
    // Background, then a sub-type ("Principal", "Supporting", "Featured
    // Background"). So CN says FEATURED BACKGROUND where MEAA says FEATURED
    // EXTRA. MEAA vocabulary is used here because that is what Australian
    // breakdowns read like; if the copy-to-Casting-Networks path needs to match
    // their dropdown exactly, map it at that boundary rather than changing this.
    // The full CN dropdown could not be read — their support site is blocked
    // from this environment.
    roleTypes: {
      lead: "SERIES REGULAR or LEAD",
      mid: "GUEST ROLE or SUPPORTING",
      small: "BIT PLAYER, FEATURED EXTRA or EXTRA",
      all: "SERIES REGULAR, RECURRING, GUEST ROLE, LEAD, SUPPORTING, BIT PLAYER, FEATURED EXTRA, EXTRA, STAND-IN",
      qualifiers: '"SUPPORTING (1 DAY)", "GUEST ROLE (2 EPISODES)"',
    },
    // REVIEW: state-based hiring is the Australian equivalent of the US
    // "local hire" note, since incentives and travel are organised by state.
    submissionNoteExamples:
      '"SYDNEY LOCAL HIRES ONLY", "MUST BE BASED IN MELBOURNE", "NSW RESIDENTS ONLY", "PLEASE INCLUDE SIZE CARDS", showreel requests',
    // REVIEW: working rights replaces the US citizen/resident question, and
    // state matters because casting and travel are organised by state.
    filmFormQuestions: `- "Are you available for all production dates?" (radio: Yes/No, required)
- "Do you have full Australian working rights?" (radio: Yes/No, required)
- "Which state or territory are you based in?" (text, required)
- "Do you have any scheduling conflicts during the production period?" (textarea)
- "List any relevant experience" (textarea)
- "Do you hold a current driver's licence?" (radio: Yes/No)`,
    commercialFormQuestions: `- "Do you have any competitive commercials currently on air?" (radio: Yes/No, required)
- "Have you appeared in any competitive commercials in the last 2 years?" (radio: Yes/No, required)
- "Please list any current brand conflicts" (textarea, required)
- "Are you available for the fitting date?" (radio: Yes/No, required)
- "Are you available for all shoot dates?" (radio: Yes/No, required)
- "Do you have full Australian working rights?" (radio: Yes/No, required)
- "Which state or territory are you based in?" (text, required)
- "Do you have a valid passport?" (radio: Yes/No)
- "Do you have any visible tattoos?" (radio: Yes/No)
- "What is your clothing size?" (text)`,
    marketSignals:
      "MEAA or Equity involvement, an Actors Feature Film Collective Agreement or Actors Television Programs Agreement, Australian locations and cities, a state screen agency such as Screen NSW, VicScreen or Screen Queensland",
  },
};

export function localeTerms(locale: Locale): LocaleTerms {
  return LOCALE_TERMS[locale];
}
