import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are an expert casting director's assistant. Analyze casting documents and extract comprehensive project information.

Extract ALL of the following:

1. PROJECT: name, brand/client, type (commercial/film/tv_series/short_film/music_video/web_series/theatre/vertical_short), location, deadline (YYYY-MM-DD if available), director, castingDirector, productionDates (as written)

2. ROLES: Every character including non-speaking/background:
   - name: exact name as written (use the character name, not the actor)
   - description: Write as a PROFESSIONAL CASTING BREAKDOWN in exactly 3 concise sentences, written for agents and actors. Think like a casting director writing for Breakdown Services or Casting Networks.
     FOR FILM/TV: Focus on the character's role in the story, key personality traits and emotional qualities, and the type of actor being sought. Include accents, special skills, or physical requirements only if critical.
     FOR COMMERCIALS: Focus on physical traits, energy, look, and castable attributes (e.g. "warm and approachable", "edgy and confident", "wholesome family type"). Less about story relationships, more about the vibe and type.
     NEVER use generic words like "ordinary" or "normal". Be vivid and specific.
   - ageRange: e.g. "25-35" or null
   - gender: "Male"/"Female"/"Any"/"Non-binary" or null
   - speaking: boolean
   - characteristics: string array of castable traits (e.g. ["authoritative", "weathered", "imposing physical presence", "Italian-American accent", "capable of quiet menace and genuine warmth"])
   - pageNumbers: array of page numbers (1-indexed) where this character has dialogue or significant action. Be PRECISE — only include pages where the character actually speaks or is actively involved. Do NOT assign all pages to every character.

3. SELF-TAPE INSTRUCTIONS per role (if documents contain audition instructions):
   - videos: [{label: "SLATE"/"SCENE 1"/etc, description: exact instructions}]
   - photos: ["1 x close-up", "1 x full body"] etc
   - filmingNotes: ["Landscape only", "Eyeline off-camera"] etc

4. FORM QUESTIONS per role (project-specific questions + industry-standard questions):
   - [{type: "text"/"radio"/"textarea"/"checkbox", label: question text, options: ["Yes","No"] if applicable, required: boolean}]

CRITICAL RULES:
- You MUST populate ALL 4 sections (project, roles, selfTapeInstructions, formQuestions) — never return empty arrays
- Include ALL roles including background/extras (mark non-speaking)
- pageNumbers MUST be accurate — carefully track which pages each character appears on. Wrong page numbers make the output useless.
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
  "roles": [{ "name": string, "description": string, "ageRange": string|null, "gender": string|null, "speaking": boolean, "characteristics": string[], "pageNumbers": number[] }],
  "selfTapeInstructions": [{ "roleName": string, "videos": [{"label": string, "description": string}], "photos": string[], "filmingNotes": string[] }],
  "formQuestions": [{ "roleName": string, "questions": [{"type": string, "label": string, "options": string[]|null, "required": boolean}] }]
}`;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (!files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const MAX_PDF_PAGES = 95; // Stay under Claude's 100-page limit
    const anthropic = new Anthropic();

    // Split large PDFs into chunks, collect all file content
    interface PdfChunk {
      fileName: string;
      chunkIndex: number;
      totalChunks: number;
      pageOffset: number; // first page number in this chunk (1-indexed)
      base64: string;
    }
    const pdfChunks: PdfChunk[] = [];
    const textParts: string[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());

      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        const pdfDoc = await PDFDocument.load(buffer);
        const totalPages = pdfDoc.getPageCount();

        if (totalPages <= MAX_PDF_PAGES) {
          // Small enough — send as-is
          pdfChunks.push({
            fileName: file.name,
            chunkIndex: 0,
            totalChunks: 1,
            pageOffset: 1,
            base64: buffer.toString("base64"),
          });
        } else {
          // Split into chunks
          const numChunks = Math.ceil(totalPages / MAX_PDF_PAGES);
          for (let i = 0; i < numChunks; i++) {
            const startPage = i * MAX_PDF_PAGES;
            const endPage = Math.min(startPage + MAX_PDF_PAGES, totalPages);

            const chunkDoc = await PDFDocument.create();
            const pages = await chunkDoc.copyPages(
              pdfDoc,
              Array.from({ length: endPage - startPage }, (_, j) => startPage + j)
            );
            pages.forEach((p) => chunkDoc.addPage(p));

            const chunkBytes = await chunkDoc.save();
            pdfChunks.push({
              fileName: file.name,
              chunkIndex: i,
              totalChunks: numChunks,
              pageOffset: startPage + 1,
              base64: Buffer.from(chunkBytes).toString("base64"),
            });
          }
        }
      } else {
        textParts.push(`=== ${file.name} ===\n${buffer.toString("utf-8")}`);
      }
    }

    // If only one chunk (or no PDF), do a single request
    if (pdfChunks.length <= 1) {
      const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];
      if (pdfChunks.length === 1) {
        contentBlocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: pdfChunks[0].base64,
          },
        } as any);
        textParts.push(`=== ${pdfChunks[0].fileName} (PDF document attached above) ===`);
      }
      contentBlocks.push({
        type: "text",
        text: `Analyze these casting documents and return ONLY valid JSON (no markdown, no backticks, no explanation — just the JSON object):\n\n${textParts.join("\n\n")}`,
      });

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 20000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: contentBlocks }],
      });

      var text = response.content[0].type === "text" ? response.content[0].text : "";
    } else {
      // Multiple chunks — process in parallel, then merge
      const chunkPromises = pdfChunks.map((chunk) => {
        const chunkBlocks: Anthropic.Messages.ContentBlockParam[] = [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: chunk.base64,
            },
          } as any,
          {
            type: "text",
            text: `This is chunk ${chunk.chunkIndex + 1} of ${chunk.totalChunks} from "${chunk.fileName}".
Pages in this chunk start at page ${chunk.pageOffset} of the original document.
IMPORTANT: When listing pageNumbers for characters, use the ORIGINAL page numbers (starting from ${chunk.pageOffset}).

Analyze this section and return ONLY valid JSON (no markdown, no backticks):\n\n${textParts.join("\n\n")}`,
          },
        ];

        return anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 20000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: chunkBlocks }],
        });
      });

      const chunkResponses = await Promise.all(chunkPromises);
      const chunkResults = chunkResponses.map((r) => {
        const t = r.content[0].type === "text" ? r.content[0].text : "{}";
        const m = t.match(/\{[\s\S]*\}/);
        if (!m) return null;
        let s = m[0].replace(/,\s*([\]}])/g, "$1");
        s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
        try { return JSON.parse(s); } catch { return null; }
      }).filter(Boolean);

      if (!chunkResults.length) {
        return NextResponse.json({ error: "Failed to analyze any chunk" }, { status: 500 });
      }

      // Merge: take project from first chunk, merge roles by deduplicating on name
      const merged = chunkResults[0];
      const roleMap = new Map<string, any>();
      for (const result of chunkResults) {
        if (result.roles) {
          for (const role of result.roles) {
            const key = role.name?.toLowerCase()?.trim();
            if (!key) continue;
            if (roleMap.has(key)) {
              // Merge page numbers
              const existing = roleMap.get(key);
              const allPages = [...new Set([...(existing.pageNumbers || []), ...(role.pageNumbers || [])])].sort((a: number, b: number) => a - b);
              existing.pageNumbers = allPages;
              // Keep the longer description
              if ((role.description || "").length > (existing.description || "").length) {
                existing.description = role.description;
              }
              // Merge characteristics
              existing.characteristics = [...new Set([...(existing.characteristics || []), ...(role.characteristics || [])])];
            } else {
              roleMap.set(key, { ...role });
            }
          }
        }
      }
      merged.roles = Array.from(roleMap.values());

      // Merge selfTapeInstructions
      const stMap = new Map<string, any>();
      for (const result of chunkResults) {
        for (const st of result.selfTapeInstructions || []) {
          const key = st.roleName?.toLowerCase()?.trim();
          if (!key || stMap.has(key)) continue;
          stMap.set(key, st);
        }
      }
      merged.selfTapeInstructions = Array.from(stMap.values());

      // Merge formQuestions
      const fqMap = new Map<string, any>();
      for (const result of chunkResults) {
        for (const fq of result.formQuestions || []) {
          const key = fq.roleName?.toLowerCase()?.trim();
          if (!key || fqMap.has(key)) continue;
          fqMap.set(key, fq);
        }
      }
      merged.formQuestions = Array.from(fqMap.values());

      var text = JSON.stringify(merged);
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Failed to parse AI response" }, { status: 500 });
    }

    let jsonStr = jsonMatch[0];
    // Fix common JSON issues from LLM output
    jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");
    jsonStr = jsonStr.replace(/(?<=":.*)"([^"]*)\n([^"]*)"(?=\s*[,}\]])/g, '"$1\\n$2"');

    try {
      return NextResponse.json(JSON.parse(jsonStr));
    } catch (parseError: any) {
      console.error("JSON parse error:", parseError.message);
      console.error("JSON text (first 500):", jsonStr.slice(0, 500));
      try {
        const cleaned = jsonStr.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
        return NextResponse.json(JSON.parse(cleaned));
      } catch {
        return NextResponse.json({ error: "AI returned malformed JSON. Please try again." }, { status: 500 });
      }
    }
  } catch (error: any) {
    console.error("Analyze error:", error);
    return NextResponse.json({ error: error.message || "Analysis failed" }, { status: 500 });
  }
}
