import { totalmem } from "os";
import { connection } from "next/server";
import SmartCreator from "@/components/SmartCreator";
import Link from "next/link";
import { Shield } from "lucide-react";
import { isVercelHosted } from "@/lib/runtime";
import { pickBestModel, resolveConfig } from "@/lib/local/ollama";
import PrivateSetupGuide from "./PrivateSetupGuide";

export const metadata = {
  title: "Private local setup — Script To Cast",
  description:
    "The private local-model path only runs on your Mac via localhost and Ollama — not on the hosted site.",
};

/**
 * On Vercel this is a setup guide. Locally (`npm run dev`) it is the real
 * private casting tool, which talks only to Ollama on 127.0.0.1.
 */
export default async function PrivatePage() {
  await connection();
  if (isVercelHosted()) return <PrivateSetupGuide />;
  // Read per request, like isVercelHosted above: the environment is one way
  // this gets set, and it must not be baked in at build time.
  const { model, reason } = await pickBestModel(resolveConfig(), totalmem());
  return <PrivateLocalTool model={model} reason={reason} />;
}

function PrivateLocalTool({ model, reason }: { model: string; reason: string }) {
  return (
    <div className="min-h-screen bg-[#fafafa]">
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-bold text-lg text-gray-900">Script To Cast</Link>
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded">
            Private · local model
          </span>
        </div>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">Public (Claude)</Link>
      </nav>

      <section className="bg-emerald-50 border-b border-emerald-100 px-6 py-3">
        <div className="max-w-3xl mx-auto flex gap-3 text-sm text-emerald-900">
          <Shield size={18} className="shrink-0 mt-0.5" />
          <div>
            <p>
              This page calls <code className="text-xs bg-white/80 px-1 rounded">/api/analyze-local</code>,
              which talks only to <strong>Ollama on this computer</strong> (<code className="text-xs">127.0.0.1</code>).
              It does not use the Anthropic / Claude API. Use <code className="text-xs">npm run dev</code> on your Mac.
            </p>
            {/* Which model is about to run, before a ten-minute analysis rather
                than after it. A wrong model here is invisible in the output —
                it produces plausible copy that is simply worse. */}
            <p className="mt-1.5 text-emerald-800/90">
              Model: <code className="text-xs bg-white/80 px-1 rounded">{model}</code>
              <span className="text-emerald-700/70"> · {reason}</span>
            </p>
          </div>
        </div>
      </section>

      <section id="tool" className="bg-white border-b border-gray-200 py-12">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Private casting setup</h2>
          <p className="text-gray-500 text-sm text-center mb-8">
            Same workflow. Local model only — analysis stays on this machine.
          </p>
          <SmartCreator isLoggedIn={false} analyzeEndpoint="/api/analyze-local" privateMode />
        </div>
      </section>
    </div>
  );
}
