import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { extractText } from "unpdf";
import {
  normalizeResult,
  type AnalysisResult,
  type Project,
  type Role,
  type SelfTapeInstruction,
  type FormQuestion,
} from "@/lib/breakdown";
import { isVercelHosted } from "@/lib/runtime";

export const maxDuration = 300;
export const runtime = "nodejs";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";

const SYSTEM_PROMPT = `You are an expert casting director's assistant. Analyze casting documents and extract project information.
Return ONLY valid JSON with this shape:
{
  "project": { "name": string, "brand": string, "type": string, "location": string|null, "deadline": string|null, "director": string|null, "castingDirector": string|null, "productionDates": string|null },
  "roles": [{ "name": string, "description": string, "ageRange": string|null, "gender": string|null, "speaking": boolean, "characteristics": string[], "pageNumbers": number[] }],
  "selfTapeInstructions": [{ "roleName": string, "videos": [{"label": string, "description": string}], "photos": string[], "filmingNotes": string[] }],
  "formQuestions": [{ "roleName": string, "questions": [{"type": string, "label": string, "options": string[]|null, "required": boolean}] }]
}
Include all roles. Prefer accurate page numbers. No markdown fences. Do not invent roles that are not in the text.`;


function emptyProject(partial?: Partial<Project> | null): Project {
  return {
    name: partial?.name || "Untitled",
    brand: partial?.brand || "",
    type: partial?.type || "commercial",
    logline: partial?.logline ?? null,
    synopsis: partial?.synopsis ?? null,
    location: partial?.location ?? null,
    deadline: partial?.deadline ?? null,
    director: partial?.director ?? null,
    writer: partial?.writer ?? null,
    producers: partial?.producers ?? null,
    castingDirector: partial?.castingDirector ?? null,
    union: partial?.union ?? null,
    rate: partial?.rate ?? null,
    auditionDates: partial?.auditionDates ?? null,
    callbackDates: partial?.callbackDates ?? null,
    shootDates: partial?.shootDates ?? null,
    productionDates: partial?.productionDates ?? null,
    contentAdvisories: partial?.contentAdvisories ?? [],
    submissionNotes: partial?.submissionNotes ?? [],
  };
}

/** Ollama often omits fields; coerce into AnalysisResult so the UI never crashes. */
function coerceLocalResult(raw: Record<string, unknown>): AnalysisResult {
  const projectRaw = (raw.project && typeof raw.project === "object"
    ? (raw.project as Partial<Project>)
    : null);

  const roles: Role[] = (Array.isArray(raw.roles) ? raw.roles : []).map((r) => {
    const role = (r && typeof r === "object" ? r : {}) as Partial<Role>;
    return {
      name: role.name || "Unnamed role",
      description: role.description || "",
      ageRange: role.ageRange ?? null,
      gender: role.gender ?? null,
      ethnicity: role.ethnicity ?? null,
      roleType: role.roleType ?? null,
      speaking: Boolean(role.speaking),
      characteristics: Array.isArray(role.characteristics) ? role.characteristics : [],
      contentAdvisories: Array.isArray(role.contentAdvisories) ? role.contentAdvisories : [],
      submissionNotes: Array.isArray(role.submissionNotes) ? role.submissionNotes : [],
      pageNumbers: Array.isArray(role.pageNumbers) ? role.pageNumbers : [],
    };
  });

  const selfTapeInstructions: SelfTapeInstruction[] = (
    Array.isArray(raw.selfTapeInstructions) ? raw.selfTapeInstructions : []
  ).map((st) => {
    const entry = (st && typeof st === "object" ? st : {}) as Partial<SelfTapeInstruction>;
    return {
      roleName: entry.roleName || "",
      videos: Array.isArray(entry.videos) ? entry.videos : [],
      photos: Array.isArray(entry.photos) ? entry.photos : [],
      filmingNotes: Array.isArray(entry.filmingNotes) ? entry.filmingNotes : [],
    };
  });

  const formQuestions: FormQuestion[] = (
    Array.isArray(raw.formQuestions) ? raw.formQuestions : []
  ).map((fq) => {
    const entry = (fq && typeof fq === "object" ? fq : {}) as Partial<FormQuestion>;
    return {
      roleName: entry.roleName || "",
      questions: Array.isArray(entry.questions) ? entry.questions : [],
    };
  });

  const mode =
    raw.mode === "film_tv" || raw.mode === "commercial" ? raw.mode : "commercial";

  return normalizeResult({
    mode,
    project: emptyProject(projectRaw),
    roles,
    selfTapeInstructions,
    formQuestions,
  });
}

function assertLocalOllama(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Invalid OLLAMA_BASE_URL");
  }
  const host = u.hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("analyze-local only allows Ollama on 127.0.0.1/localhost");
  }
}

async function pdfToText(buffer: Buffer, name: string): Promise<string> {
  try {
    const { text, totalPages } = await extractText(new Uint8Array(buffer), { mergePages: true });
    const body = (typeof text === "string" ? text : Array.isArray(text) ? text.join("\n") : "").trim();
    if (!body) {
      return `[PDF: ${name}, pages=${totalPages ?? "?"}. No extractable text layer.]`;
    }
    return `--- FILE: ${name} (PDF, ${totalPages ?? "?"} pages) ---\n${body.slice(0, 200000)}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "extract failed";
    return `[PDF unreadable: ${name} — ${msg}]`;
  }
}

export async function POST(request: Request) {
  if (isVercelHosted()) {
    return NextResponse.json(
      {
        error:
          "The private local-model path only runs on your Mac. This hosted site cannot reach Ollama on your laptop. Clone the repo, run npm run dev, and open http://localhost:3000/private.",
      },
      { status: 403 }
    );
  }

  try {
    assertLocalOllama(OLLAMA_BASE);

    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    if (!files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const textParts: string[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const isPdf =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        textParts.push(await pdfToText(buffer, file.name));
      } else {
        textParts.push(`--- FILE: ${file.name} ---\n${buffer.toString("utf8").slice(0, 200000)}`);
      }
    }

    const scriptText = textParts.join("\n\n");
    const scriptSha = createHash("sha256").update(scriptText).digest("hex");

    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: "json",
        options: { temperature: 0.2 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Produce a casting breakdown JSON for these materials:\n\n${scriptText.slice(0, 120000)}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        {
          error: `Ollama error ${res.status}. Is Ollama running? Try: ollama serve && ollama pull ${OLLAMA_MODEL}`,
          detail: errText.slice(0, 300),
        },
        { status: 502 }
      );
    }

    const data = await res.json();
    const content = data?.message?.content || "";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      return NextResponse.json(
        { error: "Local model returned invalid JSON", raw: content.slice(0, 500) },
        { status: 502 }
      );
    }

    console.log(
      JSON.stringify({
        type: "analyze_local",
        script_sha256: scriptSha,
        model: OLLAMA_MODEL,
        provider: "ollama",
        third_party_ai: false,
      })
    );

    const result = coerceLocalResult(parsed);
    return NextResponse.json({
      ...result,
      meta: {
        provider: "ollama",
        model: OLLAMA_MODEL,
        third_party_ai: false,
        script_sha256: scriptSha,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Local analysis failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
