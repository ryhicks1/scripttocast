import Link from "next/link";
import { GUARANTEES } from "./guarantees";
import { Shield, Laptop, Download, Terminal, ArrowRight, ExternalLink } from "lucide-react";

const STEPS = [
  {
    n: "1",
    title: "Install Ollama",
    body: (
      <>
        Download Ollama for macOS from{" "}
        <a
          href="https://ollama.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-900 underline underline-offset-2 hover:text-emerald-700"
        >
          ollama.com
        </a>
        . It listens on <code className="text-[11px] bg-gray-100 px-1 rounded">127.0.0.1:11434</code> on this computer only.
      </>
    ),
  },
  {
    n: "2",
    title: "Pull a model",
    body: (
      <>
        In Terminal:{" "}
        <code className="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">ollama pull llama3.1:8b</code>
        . It needs about 6GB of free memory. On a machine that cannot spare it,{" "}
        <code className="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">ollama pull llama3.2</code>
        {" "}works too — descriptions come out thinner.
      </>
    ),
  },
  {
    n: "3",
    title: "Run this app on your Mac",
    body: (
      <>
        Clone the repo, then{" "}
        <code className="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">npm install</code>
        {" "}and{" "}
        <code className="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">npm run dev</code>.
      </>
    ),
  },
  {
    n: "4",
    title: "Open the private tool",
    body: (
      <>
        Go to{" "}
        <code className="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">http://localhost:3000/private</code>
        . That localhost page talks to Ollama on your machine.
      </>
    ),
  },
];

export default function PrivateSetupGuide() {
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

      <section className="bg-white border-b border-gray-200 py-14">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto mb-5 text-emerald-700">
            <Laptop size={22} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            Run this on your Mac
          </h1>
          <p className="text-gray-600 text-sm max-w-xl mx-auto leading-relaxed">
            Set this up and <strong>your scripts never leave your computer</strong>. The
            private path reads a document in your browser, analyses it with a model running
            on your own machine, and never uploads it, stores it, or sends it to any online
            service.
          </p>
          <p className="text-gray-400 text-xs max-w-xl mx-auto leading-relaxed mt-3">
            It only works locally — this hosted page cannot reach a model on your laptop,
            which is precisely the point.
          </p>
        </div>
      </section>

      <section className="bg-amber-50 border-b border-amber-100 px-6 py-3">
        <div className="max-w-3xl mx-auto flex gap-3 text-sm text-amber-950">
          <Shield size={18} className="shrink-0 mt-0.5" />
          <p>
            This applies to the local tool <strong>only</strong>. The public tool on this
            site sends document text to a cloud AI service for analysis — see{" "}
            <Link href="/privacy" className="underline underline-offset-2">Privacy</Link>.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 pt-14">
        <p className="text-center text-xs text-gray-400 uppercase tracking-wider mb-8 font-medium">
          What that actually means
        </p>
        <ul className="grid sm:grid-cols-2 gap-3 text-sm">
          {GUARANTEES.map((item) => (
            <li key={item} className="bg-white border border-gray-200 rounded-xl p-4 text-gray-600 leading-relaxed">
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-14">
        <p className="text-center text-xs text-gray-400 uppercase tracking-wider mb-8 font-medium">
          Setup
        </p>
        <ol className="space-y-4">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex gap-4"
            >
              <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-sm font-semibold text-gray-700">
                {step.n}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900 mb-1">{step.title}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-8 bg-gray-50 border border-gray-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <Terminal size={16} className="text-gray-400 mt-0.5 shrink-0" />
            <pre className="text-[12px] text-gray-700 leading-relaxed overflow-x-auto font-mono">
{`git clone https://github.com/ryhicks1/scripttocast.git
cd scripttocast
npm install
npm run dev`}
            </pre>
          </div>
        </div>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-gray-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800"
          >
            Use the public Claude path
            <ArrowRight size={14} />
          </Link>
          <a
            href="https://ollama.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            <Download size={14} />
            Get Ollama
            <ExternalLink size={12} />
          </a>
        </div>
      </section>

      <footer className="text-center text-xs text-gray-400 py-6 space-x-4">
        <span>Script To Cast</span>
        <Link href="/privacy" className="hover:text-gray-600 transition">Privacy</Link>
        <Link href="/terms" className="hover:text-gray-600 transition">Terms</Link>
      </footer>
    </div>
  );
}
