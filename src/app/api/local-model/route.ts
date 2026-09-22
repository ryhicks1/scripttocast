import { NextResponse } from "next/server";
import recommended from "../../../../recommended-model.json";
import { isVercelHosted } from "@/lib/runtime";
import { LocalAnalysisError } from "@/lib/local/errors";
import { resolveConfig } from "@/lib/local/ollama";

export const maxDuration = 300;
export const runtime = "nodejs";

/**
 * Install the recommended model, from the page.
 *
 * Getting a better model to someone used to mean a terminal command, or the
 * launcher offering it at startup — and anyone who starts the app another way
 * never heard about it at all. Ollama downloads models over the same local
 * connection this app already uses, so it can be a button instead.
 *
 * Only the model named in recommended-model.json can be requested. Ollama will
 * pull any name it is given, and this endpoint exists on a machine the user
 * trusts; it is not a general-purpose download hook.
 */
export async function POST(request: Request) {
  if (isVercelHosted()) {
    return NextResponse.json(
      { error: "Models install on your own Mac, not on the hosted site." },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { model?: string };
    if (body.model !== recommended.model) {
      return NextResponse.json(
        { error: `Only ${recommended.model} can be installed from here.` },
        { status: 400 },
      );
    }

    // resolveConfig enforces the loopback restriction, same as analysis.
    const config = resolveConfig();
    const res = await fetch(`${config.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: recommended.model, stream: true }),
    });

    if (!res.ok || !res.body) {
      return NextResponse.json(
        {
          error:
            "Ollama would not start the download. Check the Ollama app is running, then try again.",
          detail: (await res.text().catch(() => "")).slice(0, 300),
        },
        { status: 502 },
      );
    }

    // Ollama already streams newline-delimited progress; pass it straight
    // through rather than buffering a multi-gigabyte download to re-describe it.
    return new Response(res.body, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof LocalAnalysisError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Could not reach Ollama. Is the Ollama app running?" },
      { status: 503 },
    );
  }
}
