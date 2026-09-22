/**
 * A stand-in for Ollama, for testing the private path without a model.
 *
 * It answers /api/tags, /api/show and /api/chat the way Ollama does, so the
 * route and the assembly can be exercised end to end. What it cannot tell you
 * is whether a real 8B model writes a good description — only running Ollama
 * does that.
 *
 * Scenarios:
 *   ok          — a full breakdown, as a well-behaved model would give
 *   empty       — {} for every call, as a model that ignores the schema would
 *   small-model — reports 3.2B parameters, to check the undersized warning
 *   slow        — pauses on the breakdown call, so a run outlives the heartbeat
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";

/** The stub answers as the model this version actually recommends. */
const RECOMMENDED = createRequire(import.meta.url)("../recommended-model.json").model;
export { RECOMMENDED };

export function startStubOllama({ scenario = "ok", port = 0 } = {}) {
  const calls = [];

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const json = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (req.url === "/api/tags") {
        return json(200, {
          models: [
            { name: "tiny-model", details: { parameter_size: "1.1B" } },
            { name: RECOMMENDED, details: { parameter_size: scenario === "small-model" ? "3.2B" : "8.0B" } },
            { name: "older-bigger-model", details: { parameter_size: "11B" } },
            { name: "huge-model", details: { parameter_size: "70B" } },
          ],
        });
      }
      if (req.url === "/api/show") {
        return json(200, {
          model_info: { "llama.context_length": 131072 },
          details: { parameter_size: scenario === "small-model" ? "3.2B" : "8.0B" },
        });
      }
      if (req.url !== "/api/chat") return json(404, { error: "not found" });

      const request = JSON.parse(body || "{}");
      const system = request.messages?.[0]?.content ?? "";
      const user = request.messages?.[1]?.content ?? "";
      calls.push({ system, user, options: request.options, format: request.format });

      if (scenario === "empty") {
        return json(200, { message: { content: "{}" }, done_reason: "stop" });
      }

      const send = () =>
        json(200, { message: { content: JSON.stringify(reply(system, user)) }, done_reason: "stop" });

      if (scenario === "slow" && /Analyze these casting documents/.test(user)) {
        setTimeout(send, 2500);
        return;
      }
      return send();
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        calls,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function reply(system, user) {
  // The private path now sends the public job: one breakdown call per chunk.
  if (/Analyze these casting documents/.test(user)) {
    return fullBreakdown(user);
  }

  // Older per-role calls should not happen, but keep a minimal answer so a
  // stray request does not crash the harness.
  return {
    mode: "film_tv",
    project: emptyProject("Untitled"),
    roles: [],
    selfTapeInstructions: [],
    formQuestions: [],
  };
}

function fullBreakdown(user) {
  const isCommercial = /HERO DAD|BARISTA|commercial board/i.test(user);
  if (isCommercial) {
    return {
      mode: "commercial",
      project: {
        ...emptyProject("Sunshine Spot"),
        type: "commercial",
        brand: "Sunshine Cola",
      },
      roles: [
        role("HERO DAD", "Male, 35-45. Warm, approachable everyman...PRINCIPAL.", "PRINCIPAL"),
        role("BARISTA", "Female, 20s. Quick smile, sure hands...FEATURED.", "FEATURED"),
      ],
      selfTapeInstructions: [
        selfTape("HERO DAD"),
        selfTape("BARISTA"),
      ],
      formQuestions: [
        formOf("HERO DAD"),
        formOf("BARISTA"),
      ],
    };
  }

  return {
    mode: "film_tv",
    project: {
      ...emptyProject("THE LONG WAY DOWN"),
      director: "Ada Reyes",
      writer: "Ada Reyes",
      location: "Chicago",
      logline: "A night-shift paramedic drives a stolen ambulance across three counties.",
      synopsis:
        "Mara takes a call that goes wrong. Devlin follows her out of the city. By morning both of them have to answer for it.",
    },
    roles: [
      role(
        "Mara",
        "Woman, 30 to 40 years old. Blunt and unhurried paramedic who has stopped being impressed by emergencies. Dry with colleagues, unexpectedly gentle with patients...LEAD.",
        "LEAD",
        { ageRange: "30 to 40 years old", gender: "Woman", pages: [1, 2, 3, 4, 5, 6] },
      ),
      role(
        "Devlin",
        "Man, 40 to 50 years old. Hospital administrator who came up through the process and trusts it more than people...SUPPORTING.",
        "SUPPORTING",
        { ageRange: "40 to 50 years old", gender: "Man", pages: [2, 4] },
      ),
      role(
        "Nurse Pell",
        "Woman, 20s. Smokes under a sign forbidding it. Says the quiet part out loud...DAY PLAYER.",
        "DAY PLAYER",
        { ageRange: "20s", gender: "Woman", pages: [3] },
      ),
      role(
        "Otis",
        "Man, 60s. Dispatch veteran who eats a sandwich with total focus and has a shortcut for everything...SUPPORTING.",
        "SUPPORTING",
        { ageRange: "60s", gender: "Man", pages: [4, 6] },
      ),
    ],
    selfTapeInstructions: ["Mara", "Devlin", "Nurse Pell", "Otis"].map(selfTape),
    formQuestions: ["Mara", "Devlin", "Nurse Pell", "Otis"].map(formOf),
  };
}

function emptyProject(name) {
  return {
    name,
    brand: "",
    type: "feature_film",
    logline: null,
    synopsis: null,
    location: null,
    deadline: null,
    director: null,
    writer: null,
    producers: null,
    castingDirector: null,
    union: null,
    rate: null,
    auditionDates: null,
    callbackDates: null,
    shootDates: null,
    productionDates: null,
    contentAdvisories: [],
    submissionNotes: [],
  };
}

function role(name, description, roleType, extra = {}) {
  return {
    name,
    description,
    ageRange: extra.ageRange ?? null,
    gender: extra.gender ?? null,
    ethnicity: extra.ethnicity ?? null,
    roleType,
    speaking: true,
    characteristics: [],
    contentAdvisories: [],
    submissionNotes: [],
    pageNumbers: extra.pages ?? [1],
  };
}

function selfTape(roleName) {
  return {
    roleName,
    videos: [{ label: "SLATE", description: "Name, height, location, agency." }],
    photos: ["1 x close-up"],
    filmingNotes: ["Landscape only"],
  };
}

function formOf(roleName) {
  return {
    roleName,
    questions: [
      {
        type: "text",
        label: "Are you available on the shoot dates listed?",
        options: [],
        required: true,
      },
    ],
  };
}
