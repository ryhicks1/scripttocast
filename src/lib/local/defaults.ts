/**
 * Self-tape instructions and job-form questions, generated in code.
 *
 * On the public path the model writes these. Locally they are boilerplate with
 * one variable in them — the role name — and a 3B model spends its context
 * badly by re-deriving a fixed list. Where the uploaded documents state their
 * own self-tape or form requirements, that is a model job; where they state
 * none (a bare screenplay, which is the normal case here), these standards are
 * what the public prompt tells the model to fall back to anyway.
 */
import type { FormQuestion, ResolvedMode, SelfTapeInstruction } from "../breakdown";

export function defaultSelfTape(roleName: string): SelfTapeInstruction {
  return {
    roleName,
    videos: [
      {
        label: "SLATE",
        description: "Name, height, location and representation, facing camera.",
      },
      {
        label: "SCENE 1",
        description: `Perform the provided sides for ${roleName}. Eyeline just off camera.`,
      },
    ],
    photos: ["1 x current headshot", "1 x full-length, natural light"],
    filmingNotes: [
      "Landscape orientation",
      "Quiet room, even front light, plain background",
      "Slate and scene in one file unless asked otherwise",
    ],
  };
}

const FILM_TV_QUESTIONS: FormQuestion["questions"] = [
  { type: "radio", label: "Are you available for all production dates?", options: ["Yes", "No"], required: true },
  { type: "textarea", label: "Do you have any scheduling conflicts during the production period?", options: null, required: false },
  { type: "textarea", label: "List any relevant experience", options: null, required: false },
  { type: "radio", label: "Do you have a valid driver's license?", options: ["Yes", "No"], required: false },
];

const COMMERCIAL_QUESTIONS: FormQuestion["questions"] = [
  { type: "radio", label: "Do you have any competitive commercials currently on air?", options: ["Yes", "No"], required: true },
  { type: "radio", label: "Have you appeared in any competitive commercials in the last 2 years?", options: ["Yes", "No"], required: true },
  { type: "textarea", label: "Please list any current brand conflicts", options: null, required: true },
  { type: "radio", label: "Are you available for the fitting date?", options: ["Yes", "No"], required: true },
  { type: "radio", label: "Are you available for all shoot dates?", options: ["Yes", "No"], required: true },
  { type: "radio", label: "Do you have a valid passport?", options: ["Yes", "No"], required: false },
  { type: "radio", label: "Are you a permanent resident or citizen?", options: ["Yes", "No"], required: false },
  { type: "radio", label: "Do you have any visible tattoos?", options: ["Yes", "No"], required: false },
  { type: "text", label: "What is your clothing size?", options: null, required: false },
];

export function defaultFormQuestions(
  roleName: string,
  mode: ResolvedMode,
  contentAdvisories: string[],
): FormQuestion {
  const base = mode === "commercial" ? COMMERCIAL_QUESTIONS : FILM_TV_QUESTIONS;
  const questions = base.map((q) => ({ ...q }));
  for (const advisory of contentAdvisories) {
    questions.push({
      type: "radio",
      label: `Are you comfortable with the following: ${advisory}?`,
      options: ["Yes", "No"],
      required: true,
    });
  }
  return { roleName, questions };
}
