import { totalmem } from "os";
import { connection } from "next/server";
import SmartCreator from "@/components/SmartCreator";
import Link from "next/link";
import { Shield } from "lucide-react";
import { isVercelHosted } from "@/lib/runtime";
import { pickBestModel, resolveConfig } from "@/lib/local/ollama";
import PrivateSetupGuide from "./PrivateSetupGuide";
import { GUARANTEES } from "./guarantees";
import { versionDetail, versionLabel } from "@/lib/version";
import ModelUpdate from "./ModelUpdate";
import recommended from "../../../recommended-model.json";

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
  const { model } = await pickBestModel(resolveConfig(), totalmem());
  // As recommendations move up, the next model may not fit an older Mac.
  // Offering a nine-gigabyte download that cannot then be run is worse than
  // saying so.
  const memoryGb = totalmem() / 1024 ** 3;
  const recommendedFits = recommended.approxMemoryGb <= memoryGb * 0.45;
  return <PrivateLocalTool model={model} recommendedFits={recommendedFits} />;
}

function PrivateLocalTool({
  model,
  recommendedFits,
}: {
  model: string;
  recommendedFits: boolean;
}) {
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
              Most AI tools send your document off to a company&apos;s computers to be read.
              This one doesn&apos;t. The AI sits on this Mac, so{" "}
              <strong>your script never leaves it</strong> — and this page will not run at
              all if the AI is anywhere but here. There is no second copy: nothing on a
              server to be leaked or handed over, and nothing used to train an AI.
            </p>
            <p className="mt-1.5 text-emerald-800/90">
              Model: <code className="text-xs bg-white/80 px-1 rounded">{model}</code>
            </p>

            {/* Folded away by default. The claim above is what matters day to
                day; the detail is for the conversation where someone asks how
                it is actually enforced. */}
            <details className="mt-2 group">
              <summary className="text-xs text-emerald-800/80 cursor-pointer hover:text-emerald-900 list-none">
                <span className="underline underline-offset-2">What that means exactly</span>
              </summary>
              <ul className="mt-2 space-y-1.5">
                {GUARANTEES.map((item) => (
                  <li key={item} className="text-xs text-emerald-900/80 leading-relaxed flex gap-2">
                    <span className="text-emerald-600 shrink-0">—</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      </section>

      <section id="tool" className="bg-white border-b border-gray-200 py-12">
        <div className="max-w-3xl mx-auto px-6">
          {model !== recommended.model && (
            <ModelUpdate
              recommended={recommended.model}
              current={model}
              approxGb={recommended.approxMemoryGb}
              fits={recommendedFits}
              alternative={recommended.smallerAlternative}
            />
          )}
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Private casting setup</h2>
          <p className="text-gray-500 text-sm text-center mb-8">
            Same workflow. Local model only — analysis stays on this machine.
          </p>
          <SmartCreator isLoggedIn={false} analyzeEndpoint="/api/analyze-local" privateMode />
        </div>
      </section>

      {/* Which build this is. Worth having in reach: a page that has not been
          updated looks exactly like one that has. */}
      <footer className="text-center text-[11px] text-gray-300 py-6">
        <span title={versionDetail()}>{versionLabel()}</span>
      </footer>
    </div>
  );
}
