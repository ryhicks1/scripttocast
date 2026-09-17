import { createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  COMMERCIAL_TYPES,
  normalizeResult,
  type AnalysisResult,
  type BreakdownMode,
} from "@/lib/breakdown";
import { extractUploadedDocumentText } from "@/lib/extract-document-text";
import { buildSystemPrompt } from "@/lib/prompts";

export const maxDuration = 300;

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1";
const MAX_SCRIPT_CHARS = 120_000;

const JSON_OUTPUT_RULES = `Return ONLY valid JSON. No markdown fences, no commentary.
Match this shape exactly:
{
  "mode": "film_tv" | "commercial",
  "project": {
    "name": string, "brand": string, "type": string,
    "logline": string, "synopsis": string, "location": string,
    "deadline": string, "director": string, "writer": string,
    "producers": string, "castingDirector": string, "union": string,
    "rate": string, "auditionDates": string, "callbackDates": string,
    "shootDates": string, "productionDates": string,
    "contentAdvisories": string[], "submissionNotes": string[]
  },
  "roles": [{
    "name": string, "description": string, "ageRange": string,
    "gender": string, "ethnicity": string, "roleType": string,
    "speaking": boolean, "characteristics": string[],
    "contentAdvisories": string[], "submissionNotes": string[],
    "pageNumbers": number[]
  }],
  "selfTapeInstructions": [{
    "roleName": string,
    "videos": [{"label": string, "description": string}],
    "photos": string[],
    "filmingNotes": string[]
  }],
  "formQuestions": [{
    "roleName": string,
    "questions": [{"type": "text"|"radio"|"textarea"|"checkbox", "label": string, "options": string[], "required": boolean}]
  }]
}
Use "" for unknown scalars and [] for empty lists. Include every role. Prefer accurate page numbers from the PAGE markers.`;

function assertLocalOllama(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid OLLAMA_BASE_URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OLLAMA_BASE_URL must be http(s) on localhost");
  }
  const host = parsed.hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("analyze-local only allows Ollama on 127.0.0.1/localhost");
  }
}

function parseModelJson(content: string): AnalysisResult {
  const trimmed = content.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(unfenced) as AnalysisResult;
}

export async function POST(request: Request) {
  try {
    assertLocalOllama(OLLAMA_BASE);

    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    if (!files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // Same FormData as /api/analyze: files + options + mode.
    void formData.get("options");
    const requestedMode = (formData.get("mode") as BreakdownMode) || "auto";
    const mode: BreakdownMode = ["film_tv", "commercial", "auto"].includes(requestedMode)
      ? requestedMode
      : "auto";

    const textParts: string[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      textParts.push(await extractUploadedDocumentText(file.name, file.type, buffer));
    }

    const scriptText = textParts.join("\n\n");
    const scriptSha = createHash("sha256").update(scriptText).digest("hex");

    const ollamaRes = await fetch(`${OLLAMA_BASE.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: "json",
        options: { temperature: 0.2 },
        messages: [
          {
            role: "system",
            content: `${buildSystemPrompt(mode)}\n\n${JSON_OUTPUT_RULES}`,
          },
          {
            role: "user",
            content:
              `Analyze these casting documents and produce the breakdown.\n\n${
                scriptText.slice(0, MAX_SCRIPT_CHARS)
              }`,
          },
        ],
      }),
    });

    if (!ollamaRes.ok) {
      const errText = await ollamaRes.text().catch(() => "");
      return NextResponse.json(
        {
          error: `Ollama error ${ollamaRes.status}. Is Ollama running? Try: ollama serve && ollama pull ${OLLAMA_MODEL}`,
          detail: errText.slice(0, 300),
        },
        { status: 502 },
      );
    }

    const data = (await ollamaRes.json()) as { message?: { content?: string } };
    const content = data?.message?.content || "";
    let parsed: AnalysisResult;
    try {
      parsed = parseModelJson(content);
    } catch {
      return NextResponse.json(
        { error: "Local model returned invalid JSON", raw: content.slice(0, 500) },
        { status: 502 },
      );
    }

    const result = normalizeResult(parsed);

    if (mode !== "auto") {
      result.mode = mode;
    } else if (COMMERCIAL_TYPES.has(result.project?.type)) {
      result.mode = "commercial";
    } else if (result.mode !== "film_tv" && result.mode !== "commercial") {
      result.mode = "film_tv";
    }

    console.log(JSON.stringify({
      type: "analyze_local",
      script_sha256: scriptSha,
      model: OLLAMA_MODEL,
      provider: "ollama",
      third_party_ai: false,
    }));

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
