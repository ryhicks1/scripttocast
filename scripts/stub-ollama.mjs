/**
 * A stand-in for Ollama, for testing the private path without a model.
 *
 * It answers /api/tags, /api/show and /api/chat the way Ollama does, so the
 * route, the parser and the assembly can be exercised end to end. What it
 * cannot tell you is whether a real 3B model writes a good description — only
 * running Ollama does that.
 *
 * Scenarios:
 *   ok    — schema-shaped replies, as a well-behaved model would give
 *   empty  — {} for every call, as a model that ignores the schema would
 */
import { createServer } from "node:http";

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
            { name: "stub-model", details: { parameter_size: scenario === "small-model" ? "3.2B" : "8.0B" } },
            // Larger than a 16GB machine should run: must not be chosen.
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

      return json(200, { message: { content: JSON.stringify(reply(system, user)) }, done_reason: "stop" });
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
  if (system.includes("pull out facts")) {
    return {
      title: "THE LONG WAY DOWN",
      productionType: "feature_film",
      director: "Ada Reyes",
      writer: "Ada Reyes",
      castingDirector: "",
      location: "Chicago",
    };
  }
  if (system.includes("logline")) {
    return {
      logline: "A night-shift paramedic drives a stolen ambulance across three counties.",
      synopsis: "Mara takes a call that goes wrong. Devlin follows her out of the city. By morning both of them have to answer for it.",
    };
  }
  if (system.includes("list the roles")) {
    return { roles: ["HERO DAD", "BARISTA"] };
  }
  // Description. Each of these is a failure seen in a real run, reproduced so
  // the harness proves the guard for it still works.
  const name = /Character: (.+)/.exec(user)?.[1] ?? "role";

  // A real run returned the prompt's own worked examples as two characters'
  // descriptions. Copy a phrase straight out of the instructions and the guard
  // must discard the whole thing.
  if (name === "Otis") {
    const phrase = /Write in this order:\n1\. (.+)/.exec(system)?.[1] ?? "what they are";
    return { gender: "Man", ageRange: "60s", ethnicity: "", description: phrase, traits: [] };
  }

  // A real run gave a lead the ethnicity of the character he shares scenes
  // with. Nothing in Devlin's evidence says Japanese, so it must be dropped.
  if (name === "Devlin") {
    return {
      gender: "Man",
      ageRange: "40 to 50 years old",
      ethnicity: "Japanese",
      description: "Hospital administrator who came up through the process and trusts it more than people.",
      traits: ["procedural"],
    };
  }

  return {
    gender: "Woman",
    ageRange: "30 to 40 years old",
    ethnicity: "",
    description: `Blunt and unhurried, ${name} has stopped being impressed by emergencies. Dry with colleagues, unexpectedly gentle with patients. In the story she learns to trust someone again. She carries herself with an air of quiet authority.`,
    traits: ["dry wit", "driving"],
  };
}
