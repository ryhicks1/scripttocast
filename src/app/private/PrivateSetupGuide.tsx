import Link from "next/link";
import { GUARANTEES } from "./guarantees";
import { versionDetail, versionLabel } from "@/lib/version";
import { Shield, Laptop, Download, Terminal, ArrowRight, ExternalLink } from "lucide-react";

/**
 * Setup, written for someone who has never opened Terminal.
 *
 * The previous version said "clone the repo" and "npm install", and skipped
 * Node.js altogether — so on a Mac that did not already have it, following the
 * steps exactly could not work. Two double-click installers and one pasted
 * line is the smallest honest version of this.
 *
 * The pasted line is now optional: the tool itself is a download, and the
 * launcher inside it does everything the line used to.
 */
/**
 * Always the latest release: GitHub's own zip of main. No hosting to manage,
 * and .gitattributes keeps the notes for coding agents out of it.
 */
const DOWNLOAD_URL = "https://github.com/ryhicks1/scripttocast/archive/refs/heads/main.zip";

/**
 * For people who would rather have updates arrive by themselves: a git
 * checkout lets the launcher pull each time it starts, which a downloaded
 * folder cannot. It hands straight to the launcher, so the Ollama settings,
 * model download and browser opening are the same either way.
 */
const SETUP_COMMAND = `cd ~ && git clone https://github.com/ryhicks1/scripttocast.git && cd ~/scripttocast && ./Start\\ ScriptToCast.command`;

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
    title: "Download Script To Cast",
    body: (
      <>
        <a
          href={DOWNLOAD_URL}
          className="text-gray-900 underline underline-offset-2 hover:text-emerald-700 font-medium"
        >
          Download it here
        </a>
        . It&apos;s small, and opens into a folder called <strong>scripttocast-main</strong>{" "}
        in your Downloads. Move that folder somewhere it can stay — your Documents folder is
        fine.
        <span className="block mt-1.5 text-gray-400">
          If it downloads as a .zip instead of a folder, double-click the .zip to open it.
        </span>
      </>
    ),
  },
  {
    n: "4",
    title: "Start it",
    body: (
      <>
        Open the folder and double-click <strong>Start ScriptToCast</strong>. A Terminal
        window opens, sets everything up, and then opens the tool in your browser by itself.
        <span className="block mt-1.5 text-gray-400">
          The first time, macOS may refuse to open it because it didn&apos;t come from the App
          Store. Open <strong>System Settings → Privacy &amp; Security</strong>, scroll down,
          click <strong>Open Anyway</strong>, and double-click it again. The first start also
          downloads the AI model — about 5GB, ten minutes or so. After that, starting takes
          seconds.
        </span>
        <span className="block mt-1.5 text-gray-400">
          Leave the Terminal window open while you use the tool — closing it switches the app
          off. Next time, just double-click <strong>Start ScriptToCast</strong> again. It will
          tell you when a newer version is available to download.
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

      {/* First thing on the page, because most visits after the first one are
          someone looking for their tool rather than someone installing it. */}
      <section className="bg-gray-900 px-6 py-3">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-center gap-3 text-sm">
          <span className="font-medium text-white">Already set up?</span>
          <a
            href="http://localhost:3000/private"
            className="bg-white text-gray-900 px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide hover:bg-gray-100"
          >
            CLICK HERE
          </a>
        </div>
      </section>

      <section className="bg-white border-b border-gray-200 py-14">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto mb-5 text-emerald-700">
            <Laptop size={22} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            Setting this up for the first time
          </h1>
          <p className="text-gray-600 text-sm max-w-xl mx-auto leading-relaxed">
            Most AI tools send your document off to a company&apos;s computers to be read.
            This one doesn&apos;t. The AI sits on your Mac, so{" "}
            <strong>your script never leaves it</strong>.
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

        <details className="mt-8 bg-white border border-gray-200 rounded-xl p-5 text-sm text-gray-500">
          <summary className="cursor-pointer font-medium text-gray-700">
            Prefer updates to install themselves? Use Terminal instead of steps 3 and 4
          </summary>
          <p className="mt-3 leading-relaxed">
            Hold <strong>Command</strong> and press the <strong>space bar</strong>, type{" "}
            <strong>Terminal</strong>, press Return, paste this line and press Return. It puts
            the tool in a <strong>scripttocast</strong> folder in your home folder, and from
            then on <strong>Start ScriptToCast</strong> fetches each new version itself. If a
            box asks to install developer tools, click Install, wait, then paste the line again.
          </p>
          <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-4 flex items-start gap-3">
            <Terminal size={16} className="text-gray-400 mt-0.5 shrink-0" />
            <pre className="text-[12px] text-gray-700 leading-relaxed overflow-x-auto font-mono">
{SETUP_COMMAND}
            </pre>
          </div>
        </details>

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
          <a
            href={DOWNLOAD_URL}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            <Download size={14} />
            Download Script To Cast
          </a>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 pb-14">
        <p className="text-xs text-gray-400 leading-relaxed mb-4">
          Needs a Mac with Apple silicon (M1 or later) and at least 16GB of memory: the
          model and the whole script it is reading have to fit at once. A feature takes
          about an hour on a MacBook Air. More memory runs a larger model, which gives more
          accurate descriptions.
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
        <span className="text-gray-300" title={versionDetail()}>{versionLabel()}</span>
      </footer>
    </div>
  );
}
