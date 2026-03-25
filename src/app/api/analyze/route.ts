import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are an expert casting director's assistant. Analyze casting documents and extract comprehensive project information.

Extract ALL of the following:

1. PROJECT: name, brand/client, type (commercial/film/tv_series/short_film/music_video/web_series/theatre/vertical_short), location, deadline (YYYY-MM-DD if available), director, castingDirector, productionDates (as written)

2. ROLES: Every character including non-speaking/background:
   - name: exact name as written
   - description: 2-3 detailed sentences for casting (age, traits, physicality, personality)
   - ageRange: e.g. "25-35" or null
   - gender: "Male"/"Female"/"Any" or null
   - speaking: boolean
   - characteristics: string array of key traits

3. SELF-TAPE INSTRUCTIONS per role (if documents contain audition instructions):
   - videos: [{label: "SLATE"/"SCENE 1"/etc, description: exact instructions}]
   - photos: ["1 x close-up", "1 x full body"] etc
   - filmingNotes: ["Landscape only", "Eyeline off-camera"] etc

4. FORM QUESTIONS per role (project-specific questions + industry-standard questions):
   - [{type: "text"/"radio"/"textarea"/"checkbox", label: question text, options: ["Yes","No"] if applicable, required: boolean}]

CRITICAL RULES:
- You MUST populate ALL 4 sections (project, roles, selfTapeInstructions, formQuestions) — never return empty arrays
- Include ALL roles including background/extras (mark non-speaking)
- selfTapeInstructions: Look for ANY mention of audition videos, slates, scenes to record, photo requirements, filming tips. Even if just one doc has these, extract them
- If a document contains step-by-step self-tape instructions, extract EVERY step with its full description
- ALWAYS include at least general self-tape instructions (slate + scene) for any project type
- formQuestions: Extract project-specific questions AND add standard industry questions

FOR COMMERCIALS, ALWAYS include these standard form questions:
- "Do you have any competitive commercials currently on air?" (radio: Yes/No, required)
- "Have you appeared in any competitive commercials in the last 2 years?" (radio: Yes/No, required)
- "Please list any current brand conflicts" (textarea, required)
- "Are you available for the fitting date?" (radio: Yes/No, required)
- "Are you available for all shoot dates?" (radio: Yes/No, required)
- "Do you have a valid passport?" (radio: Yes/No)
- "Are you a permanent resident or citizen?" (radio: Yes/No)
- "Do you have any visible tattoos?" (radio: Yes/No)
- "What is your clothing size?" (text)
Plus any product-specific questions (e.g. "Are you comfortable eating/drinking the product on camera?")

FOR FILM/TV, include:
- "Are you available for all production dates?" (radio: Yes/No, required)
- "Do you have any scheduling conflicts during the production period?" (textarea)
- "List any relevant experience" (textarea)
- "Do you have a valid driver's license?" (radio: Yes/No)

Return ONLY valid JSON matching this schema:
{
  "project": { "name": string, "brand": string, "type": string, "location": string|null, "deadline": string|null, "director": string|null, "castingDirector": string|null, "productionDates": string|null },
  "roles": [{ "name": string, "description": string, "ageRange": string|null, "gender": string|null, "speaking": boolean, "characteristics": string[] }],
  "selfTapeInstructions": [{ "roleName": string, "videos": [{"label": string, "description": string}], "photos": string[], "filmingNotes": string[] }],
  "formQuestions": [{ "roleName": string, "questions": [{"type": string, "label": string, "options": string[]|null, "required": boolean}] }]
}`;

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += (content.items as any[]).map(item => item.str || "").join(" ") + "\n\n";
  }
  return text;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (!files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const allTexts: string[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        const text = await extractPdfText(buffer);
        allTexts.push(`=== ${file.name} ===\n${text}`);
      } else {
        allTexts.push(`=== ${file.name} ===\n${buffer.toString("utf-8")}`);
      }
    }

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Analyze these casting documents:\n\n${allTexts.join("\n\n")}` }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Failed to parse AI response" }, { status: 500 });
    }

    return NextResponse.json(JSON.parse(jsonMatch[0]));
  } catch (error: any) {
    console.error("Analyze error:", error);
    return NextResponse.json({ error: error.message || "Analysis failed" }, { status: 500 });
  }
}
