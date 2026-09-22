import Link from "next/link";
import { GUARANTEES } from "./guarantees";
import { Shield, Laptop, Download, Terminal, ArrowRight, ExternalLink } from "lucide-react";

/**
 * Setup, written for someone who has never opened Terminal.
 *
 * The previous version said "clone the repo" and "npm install", and skipped
 * Node.js altogether — so on a Mac that did not already have it, following the
 * steps exactly could not work. Two double-click installers and one pasted
 * line is the smallest honest version of this.
 */
const SETUP_COMMAND = `cd ~ && git clone https://github.com/ryhicks1/scripttocast.git; cd ~/scripttocast && ollama pull llama3.1:8b && npm install && npm run dev`;

const STEPS = [
  {
    n: "1",
    title: "Install Ollama",
    body: (
      <>
        Go to{" "}
        <a
          href="https://ollama.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-900 underline underline-offset-2 hover:text-emerald-700"
        >
          ollama.com
        </a>{" "}
        and click Download. Open the file that downloads, and drag the Ollama icon into
        your Applications folder. Then open it from Applications. A small llama appears
        in the menu bar at the top of your screen — that means it&apos;s running.
        <span className="block mt-1.5 text-gray-400">
          This is the part that reads your script. It runs on your Mac, not online.
        </span>
      </>
    ),
  },
  {
    n: "2",
    title: "Install Node",
    body: (
      <>
        Go to{" "}
        <a
          href="https://nodejs.org"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-900 underline underline-offset-2 hover:text-emerald-700"
        >
          nodejs.org
        </a>{" "}
        and click the green button marked <strong>LTS</strong>. Open the file that
        downloads and click Continue until it finishes.
        <span className="block mt-1.5 text-gray-400">
          You never open this one. The app uses it behind the scenes.
        </span>
      </>
    ),
  },
  {
    n: "3",
    title: "Copy the line below into Terminal",
    body: (
      <>
        Hold down <strong>Command</strong> and press the <strong>space bar</strong>, type{" "}
        <strong>Terminal</strong>, and press Return. A plain window full of text opens —
        that&apos;s normal. Copy the line below, click into that window, paste it
        (<strong>Command</strong> and <strong>V</strong>), and press Return.
        <span className="block mt-1.5 text-gray-400">
          The first time takes ten minutes or so — it&apos;s downloading the model, which
          is a big file. Leave it alone until the text stops scrolling. If a box appears
          asking to install developer tools, click Install, wait for it, then paste the
          line again.
        </span>
      </>
    ),
  },
  {
    n: "4",
    title: "Open the tool",
    body: (
      <>
        When the Terminal window says <strong>Ready</strong>, open Safari or Chrome and go
        to{" "}
        <code className="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">
          localhost:3000/private
        </code>
        . That&apos;s the tool.
        <span className="block mt-1.5 text-gray-400">
          Leave the Terminal window open while you use it — closing it switches the app
          off. Next time, open your <strong>scripttocast</strong> folder in Finder and
          double-click <strong>Start ScriptToCast</strong> instead of doing any of this
          again.
        </span>
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

        <p className="text-center text-xs text-gray-400 uppercase tracking-wider mt-10 mb-3 font-medium">
          The line to copy, for step 3
        </p>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <Terminal size={16} className="text-gray-400 mt-0.5 shrink-0" />
            <pre className="text-[12px] text-gray-700 leading-relaxed overflow-x-auto font-mono">
{SETUP_COMMAND}
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

      <section className="max-w-3xl mx-auto px-6 pb-14">
        <p className="text-xs text-gray-400 leading-relaxed mb-4">
          The model needs about 6GB of free memory. If your Mac has 8GB or less, swap{" "}
          <code className="text-[11px] bg-gray-100 px-1 rounded">llama3.1:8b</code> for{" "}
          <code className="text-[11px] bg-gray-100 px-1 rounded">llama3.2</code> in the line
          above — it runs on less, and the descriptions come out shorter.
        </p>
        <div className="border-t border-gray-200 pt-6 flex gap-3 text-xs text-gray-400 leading-relaxed">
          <Shield size={14} className="shrink-0 mt-0.5" />
          <p>
            It only works locally — this hosted page cannot reach a model on your laptop,
            which is precisely the point. The guarantee above applies to the local tool{" "}
            <strong className="font-medium text-gray-500">only</strong>: the public tool on
            this site sends document text to a cloud AI service for analysis, described in{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-gray-600">
              Privacy
            </Link>
            .
          </p>
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
