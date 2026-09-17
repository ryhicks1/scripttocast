// Shared types and JSON schema for casting breakdowns.
//
// The shape here is driven by real Breakdown Services / Actors Access
// breakdowns: every role carries gender, age and ethnic background up front,
// then the prose, then the role tier. See prompts.ts for the rendered format.

export type BreakdownMode = "film_tv" | "commercial" | "auto";

/** Modes the model is actually asked to produce (never "auto"). */
export type ResolvedMode = Exclude<BreakdownMode, "auto">;

export const PROJECT_TYPES = [
  "feature_film",
  "short_film",
  "student_film",
  "episodic",
  "straight_to_series",
  "pilot",
  "digital_series",
  "web_series",
  "commercial",
  "music_video",
  "theatre",
  "industrial",
  "vertical_short",
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];

/** Project types that get the commercial treatment when mode is "auto". */
export const COMMERCIAL_TYPES: ReadonlySet<string> = new Set([
  "commercial",
  "industrial",
]);

export interface Role {
  name: string;
  /** Canonical breakdown text — see buildSystemPrompt for the exact shape. */
  description: string;
  ageRange: string | null;
  gender: string | null;
  /** e.g. "White", "Latino", "all ethnicities". Null when unspecified. */
  ethnicity: string | null;
  /** Tier as written in the trade: LEAD, SUPPORTING, DAY PLAYER, CO-STAR... */
  roleType: string | null;
  speaking: boolean;
  characteristics: string[];
  /** Nudity, sexual situations, intimacy, prosthetics — disclosed to talent. */
  contentAdvisories: string[];
  /** "LA LOCAL HIRES ONLY", "PLEASE INCLUDE SIZE CARDS", "SCALE"... */
  submissionNotes: string[];
  pageNumbers: number[];
}

export interface Project {
  name: string;
  brand: string;
  type: ProjectType | string;
  logline: string | null;
  synopsis: string | null;
  location: string | null;
  deadline: string | null;
  director: string | null;
  writer: string | null;
  producers: string | null;
  castingDirector: string | null;
  union: string | null;
  rate: string | null;
  auditionDates: string | null;
  callbackDates: string | null;
  shootDates: string | null;
  productionDates: string | null;
  contentAdvisories: string[];
  submissionNotes: string[];
}

export interface SelfTapeInstruction {
  roleName: string;
  videos: { label: string; description: string }[];
  photos: string[];
  filmingNotes: string[];
}

export interface FormQuestion {
  roleName: string;
  questions: {
    type: string;
    label: string;
    options: string[] | null;
    required: boolean;
  }[];
}

export interface AnalysisResult {
  mode: ResolvedMode;
  project: Project;
  roles: Role[];
  selfTapeInstructions: SelfTapeInstruction[];
  formQuestions: FormQuestion[];
  projectId?: string;
}

const nullableString = { type: ["string", "null"] } as const;
const stringArray = { type: "array", items: { type: "string" } } as const;

/**
 * JSON Schema passed to the Messages API as `output_config.format`. The API
 * constrains generation to this shape, so responses parse without repair.
 */
export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "project", "roles", "selfTapeInstructions", "formQuestions"],
  properties: {
    mode: { type: "string", enum: ["film_tv", "commercial"] },
    project: {
      type: "object",
      additionalProperties: false,
      required: [
        "name", "brand", "type", "logline", "synopsis", "location", "deadline",
        "director", "writer", "producers", "castingDirector", "union", "rate",
        "auditionDates", "callbackDates", "shootDates", "productionDates",
        "contentAdvisories", "submissionNotes",
      ],
      properties: {
        name: { type: "string" },
        brand: { type: "string" },
        type: { type: "string", enum: PROJECT_TYPES },
        logline: nullableString,
        synopsis: nullableString,
        location: nullableString,
        deadline: nullableString,
        director: nullableString,
        writer: nullableString,
        producers: nullableString,
        castingDirector: nullableString,
        union: nullableString,
        rate: nullableString,
        auditionDates: nullableString,
        callbackDates: nullableString,
        shootDates: nullableString,
        productionDates: nullableString,
        contentAdvisories: stringArray,
        submissionNotes: stringArray,
      },
    },
    roles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name", "description", "ageRange", "gender", "ethnicity", "roleType",
          "speaking", "characteristics", "contentAdvisories", "submissionNotes",
          "pageNumbers",
        ],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          ageRange: nullableString,
          gender: nullableString,
          ethnicity: nullableString,
          roleType: nullableString,
          speaking: { type: "boolean" },
          characteristics: stringArray,
          contentAdvisories: stringArray,
          submissionNotes: stringArray,
          pageNumbers: { type: "array", items: { type: "integer" } },
        },
      },
    },
    selfTapeInstructions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roleName", "videos", "photos", "filmingNotes"],
        properties: {
          roleName: { type: "string" },
          videos: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "description"],
              properties: {
                label: { type: "string" },
                description: { type: "string" },
              },
            },
          },
          photos: stringArray,
          filmingNotes: stringArray,
        },
      },
    },
    formQuestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roleName", "questions"],
        properties: {
          roleName: { type: "string" },
          questions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "label", "options", "required"],
              properties: {
                type: {
                  type: "string",
                  enum: ["text", "radio", "textarea", "checkbox"],
                },
                label: { type: "string" },
                options: { type: ["array", "null"], items: { type: "string" } },
                required: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
} as const;
