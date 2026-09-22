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
        return json(200, { models: [{ name: "stub-model:latest" }] });
      }
      if (req.url === "/api/show") {
        return json(200, { model_info: { "llama.context_length": 131072 } });
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
  // Description. The trailing sentence is deliberately in narrative-summary
  // voice, to prove the quality gate drops it.
  const name = /Character: (.+)/.exec(user)?.[1] ?? "role";
  return {
    gender: "Woman",
    ageRange: "30 to 40 years old",
    ethnicity: "",
    description: `Blunt and unhurried, ${name} has stopped being impressed by emergencies. Dry with colleagues, unexpectedly gentle with patients. In the story she learns to trust someone again.`,
    traits: ["dry wit", "driving"],
  };
}
