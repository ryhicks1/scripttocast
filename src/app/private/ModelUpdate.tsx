"use client";
import { useState } from "react";
import { Download } from "lucide-react";

/**
 * One button to get the better model.
 *
 * Shown when the model that would run is not the one this version is built for.
 * The download is unavoidable — the model has to arrive on this machine — but
 * nothing else about it needs to be: no terminal, no launcher, no waiting for
 * the next restart.
 */
export default function ModelUpdate({
  recommended,
  current,
  approxGb,
  fits,
}: {
  recommended: string;
  current: string;
  approxGb: number;
  /** False when this Mac has too little memory to run the recommendation. */
  fits: boolean;
}) {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [detail, setDetail] = useState("");
  const [pct, setPct] = useState<number | null>(null);

  async function install() {
    setState("working");
    setDetail("Starting the download");
    setPct(null);

    try {
      const res = await fetch("/api/local-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: recommended }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "The download could not be started.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.error) throw new Error(event.error);
            if (event.status) setDetail(event.status);
            if (event.total > 0 && event.completed >= 0) {
              setPct(Math.round((event.completed / event.total) * 100));
            }
          } catch (parseError) {
            // A half-written line is not a failure; a reported one is.
            if (parseError instanceof Error && !/JSON/.test(parseError.message)) throw parseError;
          }
        }
      }

      setState("done");
    } catch (error) {
      setState("error");
      setDetail(error instanceof Error ? error.message : "The download failed.");
    }
  }

  // Downloading several gigabytes of a model this machine then cannot load is
  // worse than being told plainly.
  if (!fits) {
    return (
      <div className="border border-gray-300 bg-gray-50 rounded-xl p-4 mb-6">
        <p className="text-sm font-semibold text-gray-900">
          A newer model exists, but this Mac cannot run it
        </p>
        <p className="text-xs text-gray-600 mt-1 leading-relaxed">
          This version is built for <strong>{recommended}</strong>, which needs about{" "}
          {approxGb}GB of free memory. You&apos;re running <strong>{current}</strong>. Closing
          other apps may free enough to install it; on a Mac with less memory than this
          needs, the descriptions will stay thinner than they should be.
        </p>
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className="border border-emerald-300 bg-emerald-50 rounded-xl p-4 mb-6">
        <p className="text-sm font-semibold text-emerald-900">{recommended} is installed</p>
        <p className="text-xs text-emerald-800 mt-1">
          Reload this page to start using it.{" "}
          <button onClick={() => window.location.reload()} className="underline underline-offset-2">
            Reload now
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="border border-amber-300 bg-amber-50 rounded-xl p-4 mb-6">
      <p className="text-sm font-semibold text-amber-900">A better model is available</p>
      <p className="text-xs text-amber-800 mt-1 leading-relaxed">
        This version is built for <strong>{recommended}</strong>. You&apos;re running{" "}
        <strong>{current}</strong>, which writes thinner descriptions. The download is about{" "}
        {approxGb}GB and happens once, on this machine.
      </p>

      {state === "working" ? (
        <div className="mt-3">
          <div className="flex items-baseline justify-between mb-1.5">
            <p className="text-xs text-amber-900">{detail}</p>
            {pct !== null && <p className="text-xs text-amber-700 tabular-nums">{pct}%</p>}
          </div>
          <div className="h-1.5 bg-amber-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-700 transition-[width] duration-500"
              style={{ width: pct === null ? "10%" : `${pct}%` }}
            />
          </div>
          <p className="text-[11px] text-amber-700 mt-2">
            Leave this page open. It keeps going while you wait.
          </p>
        </div>
      ) : (
        <>
          <button
            onClick={install}
            className="mt-3 inline-flex items-center gap-2 bg-amber-900 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-amber-800"
          >
            <Download size={14} />
            Install it
          </button>
          {state === "error" && <p className="text-xs text-red-700 mt-2">{detail}</p>}
        </>
      )}
    </div>
  );
}
