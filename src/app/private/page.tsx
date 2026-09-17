import SmartCreator from "@/components/SmartCreator";
import Link from "next/link";
import { Shield } from "lucide-react";

/**
 * Local-only Script To Cast path.
 * Must be run via `npm run dev` on a machine with Ollama listening on
 * 127.0.0.1:11434. A Vercel deploy would not keep scripts on the user's
 * laptop — analyze-local would run on Vercel's servers, not this computer.
 */
export default function PrivatePage() {
  return (
    <div className="min-h-screen bg-[#fafafa]">
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-bold text-lg text-gray-900">Script To Cast</Link>
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded">
            Private · local model
          </span>
        </div>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">Public (Claude) →</Link>
      </nav>

      <section className="bg-emerald-50 border-b border-emerald-100 px-6 py-3">
        <div className="max-w-3xl mx-auto flex gap-3 text-sm text-emerald-900">
          <Shield size={18} className="shrink-0 mt-0.5" />
          <p>
            This page calls <code className="text-xs bg-white/80 px-1 rounded">/api/analyze-local</code>,
            which talks only to <strong>Ollama on this computer</strong> (<code className="text-xs">127.0.0.1</code>).
            It does not use the Anthropic / Claude API. Run via <code className="text-xs">npm run dev</code> on a
            machine with Ollama — not as a substitute for studio VPC hosting.
          </p>
        </div>
      </section>

      <section id="tool" className="bg-white border-b border-gray-200 py-12">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Private casting setup</h2>
          <p className="text-gray-500 text-sm text-center mb-8">
            Same workflow. Local model only — scripts stay on this machine for analysis.
          </p>
          <SmartCreator isLoggedIn={false} analyzeEndpoint="/api/analyze-local" />
        </div>
      </section>
    </div>
  );
}
