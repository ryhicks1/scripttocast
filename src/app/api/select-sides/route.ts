import { NextResponse } from "next/server";
import { extractDocument } from "@/lib/local/extract";
import { segmentScenes } from "@/lib/local/screenplay";
import { selectSides, sidesTierFor } from "@/lib/sides";

/**
 * Which scenes a role should read, and why.
 *
 * Rules over the screenplay's structure, no model: the same answer on the
 * public site and the private tool, and nothing here calls out anywhere. The
 * script is read into memory for the length of the request and not kept.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const script = form.get("script") as File | null;
    const roleName = String(form.get("roleName") ?? "");
    const roleType = String(form.get("roleType") ?? "");
    if (!script || !roleName) {
      return NextResponse.json({ error: "Missing script file or role name" }, { status: 400 });
    }

    const doc = await extractDocument(script);
    const scenes = segmentScenes(doc.pageLines);
    if (!scenes.length) {
      return NextResponse.json(
        { error: "No scene headings found, so scenes could not be picked. Is this a screenplay?" },
        { status: 422 },
      );
    }

    const tier = sidesTierFor(roleType);
    const selection = selectSides(scenes, roleName, tier, doc.pages.length);
    if (!selection.speaker) {
      return NextResponse.json(
        { error: `"${roleName}" never speaks in the script, so there is no scene to read.` },
        { status: 404 },
      );
    }
    return NextResponse.json({ tier, ...selection });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to pick sides";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
